import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { getBrand, type Persona } from "../brand";
import { enqueue, type JobContext } from "../jobs/queue";
import { buildPostImages } from "../images/pipeline";
import { asObject } from "../util";
import { generateManuscript } from "./generate";
import { manuscriptText, renderBlogger, renderNaverPreview, renderNaverSegments, type RenderImage, type RenderOptions } from "./render";
import { auditManuscript } from "./seo";
import { similarity, SIMILARITY_WARN } from "./similarity";
import { ManuscriptSchema, type Manuscript, type Platform } from "./types";
import { normalizeKeyword } from "../topics/scoring";
import { detectRisk, manuscriptRiskText } from "./risk";

export type AccountSettings = {
  adsenseClientId?: string;
  adsenseSlotId?: string;
  ga4PropertyId?: string;
  gscSiteUrl?: string;
  /** 네이버: private(비공개 발행) | draft(임시저장) */
  publishMode?: "private" | "draft";
  naverCategory?: string;
};

export function accountSettings(v: unknown): AccountSettings {
  return asObject<AccountSettings>(v, {});
}

export function readManuscript(v: unknown): Manuscript | null {
  const parsed = ManuscriptSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}

/**
 * 주제 하나로 플랫폼·계정별 원고 작업을 만듭니다.
 * 같은 계정에 (정규화 기준) 같은 키워드 원고가 이미 있으면 만들지 않고 건너뜁니다 — 발굴을 여러 번 돌려도 중복 원고가 쌓이지 않게.
 */
export async function createPostsFromTopic(topicId: string, targets: { platform: Platform; accountId?: string | null }[]) {
  const topic = await db.topic.findUniqueOrThrow({ where: { id: topicId } });
  const norm = topic.normalizedKeyword || normalizeKeyword(topic.keyword);
  const posts = [];
  const skipped: string[] = [];
  for (const t of targets) {
    if (t.accountId) {
      const dup = await db.post.findFirst({
        where: { accountId: t.accountId, normalizedKeyword: norm, status: { notIn: ["FAILED", "REJECTED"] } },
        include: { account: { select: { name: true } } },
      });
      if (dup) {
        skipped.push(`${dup.account?.name ?? "계정"}: 이미 "${dup.title || dup.focusKeyword}" 원고가 있어요`);
        continue;
      }
    }
    const post = await db.post.create({
      data: { topicId, platform: t.platform, accountId: t.accountId ?? null, title: topic.title, focusKeyword: topic.keyword, normalizedKeyword: norm, status: "GENERATING" },
    });
    await enqueue("post.generate", { postId: post.id });
    posts.push(post);
  }
  if (posts.length) await db.topic.update({ where: { id: topicId }, data: { status: "USED" } });
  return { posts, skipped };
}

/** 워커: 원고 생성 → 이미지 → 렌더링 → SEO 점검 */
export async function runGeneratePost(postId: string, ctx?: JobContext) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { topic: true, account: true } });
  const platform = post.platform as Platform;
  const log = (m: string) => ctx?.log(m);
  await db.post.update({ where: { id: postId }, data: { status: "GENERATING", error: null } });

  try {
    const products = await db.affiliateProduct.findMany({
      where: { active: true, platform: { in: [platform, "BOTH"] } },
      take: 30,
    });
    const internal = post.accountId
      ? await db.post.findMany({
          where: { accountId: post.accountId, status: "PUBLISHED", remoteUrl: { not: null }, id: { not: postId } },
          select: { title: true, remoteUrl: true },
          orderBy: { publishedAt: "desc" },
          take: 10,
        })
      : [];
    const siblings = await db.post.findMany({
      where: { topicId: post.topicId ?? "__none__", id: { not: postId } },
      select: { title: true },
    });

    const manuscript = await generateManuscript(
      {
        platform,
        keyword: post.topic?.keyword ?? post.focusKeyword,
        title: post.topic?.title ?? post.title,
        angle: post.topic?.angle,
        persona: (post.topic?.persona ?? "GENERAL") as Persona,
        tool: post.topic?.tool,
        intent: post.topic?.intent,
        accountConcept: post.account?.concept,
        internalLinks: internal.map((p) => ({ title: p.title, url: p.remoteUrl! })),
        affiliateProducts: products.map((p) => ({ id: p.id, name: p.name, program: p.program, tags: p.tags })),
        avoidTitles: siblings.map((s) => s.title).filter(Boolean),
      },
      { log },
    );
    await ctx?.progress(50, `원고 완성: ${manuscript.title}`);

    await db.post.update({
      where: { id: postId },
      data: {
        content: manuscript as unknown as Prisma.InputJsonValue,
        title: manuscript.title,
        slug: manuscript.slug,
        focusKeyword: manuscript.focusKeyword,
        normalizedKeyword: post.normalizedKeyword || normalizeKeyword(post.topic?.keyword ?? manuscript.focusKeyword),
        metaDescription: manuscript.metaDescription,
        tags: manuscript.tags,
      },
    });

    await buildPostImages(postId, manuscript, platform, log);
    await ctx?.progress(85, "이미지 준비 완료");
    const report = await rerenderPost(postId);
    await db.post.update({ where: { id: postId }, data: { status: "DRAFT" } });
    await ctx?.progress(100, `SEO 점수 ${report.score}점`);
    return { postId, seoScore: report.score };
  } catch (e) {
    await db.post.update({ where: { id: postId }, data: { status: "FAILED", error: (e as Error).message } });
    throw e;
  }
}

/** 원고/이미지/설정이 바뀌면 HTML 과 SEO 리포트를 다시 계산합니다. */
export async function rerenderPost(postId: string, opts: { forPublish?: boolean; imageUrl?: (a: { localPath: string; publicUrl: string | null }) => Promise<string> } = {}) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { assets: { orderBy: { order: "asc" } }, account: true } });
  const m = readManuscript(post.content);
  if (!m) throw new Error("원고 데이터가 없습니다.");
  const brand = await getBrand();
  const settings = accountSettings(post.account?.settings);
  const products = await db.affiliateProduct.findMany({ where: { id: { in: m.affiliate.map((a) => a.productId) } } });

  const images: RenderImage[] = [];
  for (const a of post.assets.filter((a) => a.kind !== "CARD_SLIDE")) {
    const slotInfo = m.sections.find((s) => s.image?.slot === a.slot)?.image;
    images.push({
      slot: a.slot,
      src: opts.imageUrl ? await opts.imageUrl(a) : (a.publicUrl ?? ""),
      localPath: a.localPath,
      alt: a.alt,
      caption: slotInfo?.caption ?? "",
      credit: a.credit,
    });
  }
  const ro: RenderOptions = {
    brand,
    images,
    products: products.map((p) => ({ id: p.id, name: p.name, url: p.url, program: p.program, price: p.price })),
    adsense: { client: settings.adsenseClientId, slot: settings.adsenseSlotId },
    canonicalUrl: post.remoteUrl ?? undefined,
    placeholders: opts.forPublish ? "strip" : "highlight",
    riskDisclaimers: detectRisk(manuscriptRiskText(m))?.disclaimers,
  };

  const platform = post.platform as Platform;
  const html = platform === "BLOGGER" ? renderBlogger(m, ro) : renderNaverPreview(renderNaverSegments(m, ro));
  const report = auditManuscript(m, platform, { imageCount: images.length, bannedPhrases: brand.bannedPhrases, disclosureText: brand.disclosure.affiliate });

  // 유사문서 검사 — 같은 플랫폼 안에서만 비교합니다.
  // (같은 주제를 블로거·네이버용으로 각각 다시 쓴 것은 의도된 정상 동작이라 플랫폼 간 비교는 오탐이 됩니다)
  const text = manuscriptText(m);
  const others = await db.post.findMany({
    where: { id: { not: postId }, platform: post.platform, status: { notIn: ["FAILED", "REJECTED"] } },
    select: { id: true, title: true, content: true, accountId: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  let maxSim = 0;
  let simWith: { id: string; title: string } | null = null;
  for (const o of others) {
    const om = readManuscript(o.content);
    if (!om) continue;
    const s = similarity(text, manuscriptText(om));
    if (s > maxSim) [maxSim, simWith] = [s, { id: o.id, title: o.title }];
  }

  const seoReport = { ...report, similarity: { max: Math.round(maxSim * 100) / 100, with: simWith, warn: maxSim >= SIMILARITY_WARN } };
  if (!opts.forPublish) {
    await db.post.update({ where: { id: postId }, data: { html, seoScore: report.score, seoReport: seoReport as unknown as Prisma.InputJsonValue } });
  }
  return { ...report, html, manuscript: m, renderOptions: ro, post };
}
