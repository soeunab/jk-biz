import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { getBrand, accountBrand, type Persona } from "../brand";
import { enqueue, type JobContext } from "../jobs/queue";
import { buildPostImages } from "../images/pipeline";
import { asObject, ymd } from "../util";
import { generateManuscript } from "./generate";
import { imageSize } from "../images/size";
import { manuscriptText, renderBlogger, renderNaverPreview, renderNaverSegments, type RenderImage, type RenderOptions } from "./render";
import { auditManuscript } from "./seo";
import { similarity, SIMILARITY_WARN } from "./similarity";
import { ManuscriptSchema, type Manuscript, type Platform } from "./types";
import { normalizeKeyword } from "../topics/scoring";
import { ensureKeywordInTitle, expandKeyword, relatedOf } from "../topics/longtail";
import { detectRisk, manuscriptRiskText } from "./risk";
import { ManualPendingError } from "../llm/manual";

export type AccountSettings = {
  adsenseClientId?: string;
  adsenseSlotId?: string;
  ga4PropertyId?: string;
  gscSiteUrl?: string;
  /** 네이버: private(비공개 발행) | draft(임시저장) */
  publishMode?: "private" | "draft";
  naverCategory?: string;
  /** 네이버: 애드포스트 수익이 합산 정산되는 정산(대표) 계정 ID. 비우면 자기 자신 */
  adpostMasterId?: string;
  /** 크로스플랫폼 재발행 짝 계정 — 의도적으로 같은 주제를 공유 (콘셉트 겹침 경고 예외) */
  republishPartnerIds?: string[];
  demo?: boolean;
};

export function accountSettings(v: unknown): AccountSettings {
  return asObject<AccountSettings>(v, {});
}

/** 저장된 조사 메모 텍스트 (없으면 null) */
export function researchNotesOf(v: unknown): string | null {
  const notes = (v as { notes?: unknown } | null)?.notes;
  return typeof notes === "string" && notes.trim() ? notes : null;
}

export function readManuscript(v: unknown): Manuscript | null {
  const parsed = ManuscriptSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}

/** 같은 계정에 (정규화 기준) 같은 키워드 원고가 이미 있으면 그 원고 */
async function findDuplicate(accountId: string, norm: string) {
  return db.post.findFirst({
    where: { accountId, normalizedKeyword: norm, status: { notIn: ["FAILED", "REJECTED"] } },
    include: { account: { select: { name: true } } },
  });
}

/** 원고 생성 전에 알려줄 경고 (콘셉트 미설정 등) — 생성을 막지는 않습니다. */
export async function generationWarnings(accountIds: string[]) {
  const accounts = await db.account.findMany({ where: { id: { in: accountIds } }, select: { name: true, concept: true } });
  return accounts
    .filter((a) => !a.concept.trim())
    .map((a) => `"${a.name}" 계정은 콘셉트가 비어 있어요. 다른 계정과 제목·관점이 비슷하게 나올 수 있으니 [계정 관리]에서 콘셉트를 적어 주세요.`);
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
      const dup = await findDuplicate(t.accountId, norm);
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

/**
 * 크로스플랫폼 재발행: 다른 계정·플랫폼의 글을 원본으로 지정해 새 원고를 만듭니다.
 * 원본의 주제·키워드를 이어받되, 생성 시 "복사 금지·관점/구성/예시 새로 쓰기" 규칙과 원본 백링크가 적용됩니다.
 */
export async function createRepublish(sourceId: string, accountId: string) {
  const source = await db.post.findUniqueOrThrow({ where: { id: sourceId }, include: { topic: true } });
  if (!readManuscript(source.content)) throw new Error("원본 원고가 아직 완성되지 않았어요.");
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  if (!["BLOGGER", "NAVER"].includes(account.platform)) throw new Error("블로그 계정만 재발행 대상이 될 수 있어요.");
  if (account.id === source.accountId) throw new Error("원본과 같은 계정에는 재발행할 수 없어요.");
  const norm = source.normalizedKeyword || normalizeKeyword(source.focusKeyword);
  const dup = await findDuplicate(account.id, norm);
  if (dup) throw new Error(`${dup.account?.name ?? "계정"}: 이미 "${dup.title || dup.focusKeyword}" 원고가 있어요`);
  const post = await db.post.create({
    data: {
      topicId: source.topicId,
      sourcePostId: source.id,
      platform: account.platform,
      accountId: account.id,
      title: source.topic?.title ?? source.title,
      focusKeyword: source.topic?.keyword ?? source.focusKeyword,
      normalizedKeyword: norm,
      status: "GENERATING",
    },
  });
  await enqueue("post.generate", { postId: post.id });
  return { post, warnings: await generationWarnings([account.id]) };
}

/** 원본 링크 표시용 정보 (URL 은 원본이 발행된 뒤에 생김) */
async function sourceLinkOf(sourcePostId: string | null) {
  if (!sourcePostId) return null;
  const src = await db.post.findUnique({ where: { id: sourcePostId }, include: { account: { select: { name: true } } } });
  return src ? { id: src.id, title: src.title, url: src.remoteUrl ?? undefined, platform: src.platform, accountName: src.account?.name ?? "", content: src.content } : null;
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
    const source = await sourceLinkOf(post.sourcePostId);
    const sourceM = source ? readManuscript(source.content) : null;
    const keyword = post.topic?.keyword ?? post.focusKeyword;

    // 함께 검색되는 롱테일 문구 — 발굴 때 저장된 것이 없으면(연관 키워드 확장으로 추가한 주제 등) 지금 조회해 주제에 저장
    let relatedKeywords = relatedOf(post.topic?.signals);
    if (!relatedKeywords && keyword) {
      const lt = await expandKeyword(keyword, { docs: 0 }).catch(() => null);
      relatedKeywords = lt?.candidates.filter((c) => normalizeKeyword(c.keyword) !== normalizeKeyword(keyword)).slice(0, 12).map((c) => ({ keyword: c.keyword, volume: c.volume })) ?? null;
      if (relatedKeywords?.length && post.topic) {
        await db.topic.update({
          where: { id: post.topic.id },
          data: { signals: { ...asObject<Record<string, unknown>>(post.topic.signals, {}), related: relatedKeywords } as Prisma.InputJsonValue },
        });
      }
    }
    if (relatedKeywords?.length) await log(`함께 검색되는 롱테일 ${relatedKeywords.length}개를 소제목·FAQ 에 반영하도록 전달`);

    const { manuscript, research } = await generateManuscript(
      {
        platform,
        keyword,
        relatedKeywords: relatedKeywords ?? undefined,
        title: post.topic?.title ?? post.title,
        angle: post.topic?.angle,
        persona: (post.topic?.persona ?? "GENERAL") as Persona,
        tool: post.topic?.tool,
        intent: post.topic?.intent,
        accountName: post.account?.name,
        accountConcept: post.account?.concept,
        internalLinks: internal.map((p) => ({ title: p.title, url: p.remoteUrl! })),
        affiliateProducts: products.map((p) => ({ id: p.id, name: p.name, program: p.program, tags: p.tags })),
        avoidTitles: siblings.map((s) => s.title).filter(Boolean),
        republishOf:
          source && sourceM
            ? {
                platform: source.platform as Platform,
                accountName: source.accountName,
                title: sourceM.title,
                // 본문 전문은 주지 않습니다 — 구조·핵심만 알려 복사 여지를 줄임
                headings: sourceM.sections.map((s) => s.heading),
                keyPoints: [sourceM.directAnswer, ...sourceM.tldr],
              }
            : undefined,
      },
      { log },
    );
    await ctx?.progress(50, `원고 완성: ${manuscript.title}`);
    // 검증된 롱테일 키워드가 제목 맨 앞·focusKeyword 에 그대로 남도록 (AI 가 바꿔 쓴 경우 되돌림)
    if (keyword) {
      manuscript.focusKeyword = keyword;
      const fixed = ensureKeywordInTitle(manuscript.title, keyword);
      if (fixed !== manuscript.title) {
        await log(`제목에 핵심 키워드 "${keyword}"가 그대로 없어 앞에 붙였습니다`);
        manuscript.title = fixed;
      }
    }

    await db.post.update({
      where: { id: postId },
      data: {
        content: manuscript as unknown as Prisma.InputJsonValue,
        research: research as unknown as Prisma.InputJsonValue,
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
    if (e instanceof ManualPendingError) {
      await db.post.update({ where: { id: postId }, data: { status: "WAITING_MANUAL", error: null } });
      throw e;
    }
    await db.post.update({ where: { id: postId }, data: { status: "FAILED", error: (e as Error).message } });
    throw e;
  }
}

/** 원고/이미지/설정이 바뀌면 HTML 과 SEO 리포트를 다시 계산합니다. */
export async function rerenderPost(postId: string, opts: { forPublish?: boolean; imageUrl?: (a: { localPath: string; publicUrl: string | null }) => Promise<string> } = {}) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { assets: { orderBy: { order: "asc" } }, account: true } });
  const m = readManuscript(post.content);
  if (!m) throw new Error("원고 데이터가 없습니다.");
  const brand = accountBrand(await getBrand(), post.account);
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
      // 블로거 '아주 크게' 형식에 원본 비율이 필요 — 저장된 값이 없으면 파일 머리말에서 읽음
      ...(a.width && a.height ? { width: a.width, height: a.height } : ((await imageSize(a.localPath)) ?? {})),
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
    sourceLink: undefined,
  };
  const source = await sourceLinkOf(post.sourcePostId);
  if (source) ro.sourceLink = { title: source.title, url: source.url };

  const platform = post.platform as Platform;
  const html = platform === "BLOGGER" ? renderBlogger(m, ro) : renderNaverPreview(renderNaverSegments(m, ro));
  const report = auditManuscript(m, platform, {
    imageCount: images.length,
    bannedPhrases: brand.bannedPhrases,
    disclosureText: brand.disclosure.affiliate,
    renderedHtml: html,
    today: ymd(new Date()),
    researchNotes: researchNotesOf(post.research),
  });

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

  // 재발행 원고는 플랫폼이 달라도 원본과 직접 비교 — 구글은 블로거·네이버 글을 모두 색인하므로 거의 같은 글은 중복 콘텐츠 위험
  const sourceM = source ? readManuscript(source.content) : null;
  const republish =
    source && sourceM
      ? (() => {
          const s = similarity(text, manuscriptText(sourceM));
          return { sourceId: source.id, sourceTitle: source.title, sourceUrl: source.url ?? null, similarity: Math.round(s * 100) / 100, warn: s >= SIMILARITY_WARN };
        })()
      : null;

  const seoReport = { ...report, similarity: { max: Math.round(maxSim * 100) / 100, with: simWith, warn: maxSim >= SIMILARITY_WARN }, republish };
  if (!opts.forPublish) {
    await db.post.update({ where: { id: postId }, data: { html, seoScore: report.score, seoReport: seoReport as unknown as Prisma.InputJsonValue } });
  }
  return { ...report, html, manuscript: m, renderOptions: ro, post };
}
