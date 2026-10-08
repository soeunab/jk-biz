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
import { ManuscriptSchema, type Manuscript, type Platform, type PostFormat } from "./types";
import { normalizeKeyword } from "../topics/scoring";
import { ensureKeywordInTitle, expandKeyword, relatedOf } from "../topics/longtail";
import { rankInternalLinks } from "./internalLinks";
import { detectRisk, manuscriptRiskText } from "./risk";
import { ManualPendingError } from "../llm/manual";
import { publicUrlOf, STALE_EDIT_MSG } from "./postStatus";
import type { StoryContext, UserSources } from "./prompts";
import {
  findTimeForms,
  fixYearOrder,
  isChosenTitle,
  lifespanOf,
  pickSecondaryKeywords,
  stripTitleNoise,
  titleChecks,
  titleRulesText,
  type TimeForm,
  type TitlePlan,
} from "../topics/titleRules";
import type { AnswerType } from "../topics/scoring";

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

/**
 * 작업 시작 때 읽은 원고가 그대로일 때만 저장 (낙관적 잠금) — 몇 분 걸리는 AI 작업이 그 사이 사람이 저장한 수정을 덮어쓰지 않게 합니다.
 * 바뀌었으면 저장하지 않고 예외를 던져 작업을 실패로 끝냅니다.
 */
export async function saveIfUnchanged(postId: string, startedAt: Date, data: Prisma.PostUpdateManyMutationInput) {
  const r = await db.post.updateMany({ where: { id: postId, updatedAt: startedAt }, data });
  if (r.count !== 1) throw new Error(STALE_EDIT_MSG);
}

/** 사용자가 📎 내 자료로 다시 쓰기로 저장한 자료 (Post.research.user) */
export type StoredUserSources = UserSources & { at: string };

export function userSourcesOf(v: unknown): StoredUserSources | null {
  const u = (v as { user?: unknown } | null)?.user as Partial<StoredUserSources> | undefined;
  if (!u || typeof u !== "object") return null;
  const notes = typeof u.notes === "string" ? u.notes : "";
  const urls = Array.isArray(u.urls) ? u.urls.filter((x): x is string => typeof x === "string") : [];
  if (!notes.trim() && !urls.length) return null;
  return { notes, urls, mode: u.mode === "only" ? "only" : "prefer", at: typeof u.at === "string" ? u.at : "" };
}

/**
 * 저장된 조사 메모 텍스트 (없으면 null). 사용자 제공 자료가 있으면 앞에 붙여,
 * AI 사실 검수·시제 점검·승인 전 확인이 이 자료도 근거로 쓰게 합니다.
 */
export function researchNotesOf(v: unknown): string | null {
  const notes = (v as { notes?: unknown } | null)?.notes;
  const web = typeof notes === "string" && notes.trim() ? notes : null;
  const u = userSourcesOf(v);
  if (!u) return web;
  const userBlock = `[사용자 제공 자료]\n${u.notes.trim()}${u.urls.length ? `\n참고 URL: ${u.urls.join(" ")}` : ""}`.trim();
  return web ? `${userBlock}\n\n[웹 조사 메모]\n${web}` : userBlock;
}

/** 실시간 발굴 소재(origin=channels)의 사건 요약·실제 수집 기사 — 원고가 이 사건 중심으로 쓰이게 전달 */
export function storyContextOf(signals: unknown): StoryContext | undefined {
  const sg = (signals ?? {}) as {
    origin?: string;
    longtail?: { story?: { summary?: unknown } } | null;
    evidence?: { title?: unknown; url?: unknown; press?: unknown; source?: unknown }[];
    context?: { title?: unknown; url?: unknown; press?: unknown; source?: unknown }[];
  };
  if (sg.origin !== "channels") return undefined;
  const summary = typeof sg.longtail?.story?.summary === "string" ? sg.longtail.story.summary : "";
  const seen = new Set<string>();
  const articles = [...(sg.evidence ?? []), ...(sg.context ?? [])]
    .filter((a) => typeof a?.title === "string" && a.title.trim())
    .filter((a) => (seen.has(String(a.title)) ? false : (seen.add(String(a.title)), true)))
    .slice(0, 8)
    .map((a) => ({
      title: String(a.title),
      url: typeof a.url === "string" && a.url ? a.url : null,
      source: [a.press, a.source].find((x): x is string => typeof x === "string" && !!x.trim()) ?? "",
    }));
  if (!summary.trim() && !articles.length) return undefined;
  return { summary, articles };
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
export async function createPostsFromTopic(topicId: string, targets: { platform: Platform; accountId?: string | null }[], naverFormat?: PostFormat) {
  const topic = await db.topic.findUniqueOrThrow({ where: { id: topicId } });
  const norm = topic.normalizedKeyword || normalizeKeyword(topic.keyword);
  const posts = [];
  const skipped: string[] = [];
  // 제목: 고른 제목은 첫 원고에 확정, 같은 주제의 다른 계정 원고는 서로 다른 보조 검색어로 구별 (독자층 단어 대신)
  const sig = asObject<{ titleOptions?: { title: string }[]; titleLocked?: boolean; related?: { keyword: string; volume: number | null }[] }>(topic.signals, {});
  const existing = await db.post.findMany({ where: { topicId }, select: { title: true, titlePlan: true } });
  let lockFree = isChosenTitle(topic.title, sig) && !existing.some((p) => asObject<Partial<TitlePlan>>(p.titlePlan, {}).locked);
  const taken = [topic.title, ...existing.map((p) => asObject<Partial<TitlePlan>>(p.titlePlan, {}).secondaryKeyword ?? "")].filter(Boolean);
  const secondaries = pickSecondaryKeywords(topic.keyword, sig.related ?? [], targets.length, taken);
  let si = 0;
  for (const t of targets) {
    if (t.accountId) {
      const dup = await findDuplicate(t.accountId, norm);
      if (dup) {
        skipped.push(`${dup.account?.name ?? "계정"}: 이미 "${dup.title || dup.focusKeyword}" 원고가 있어요`);
        continue;
      }
    }
    // 홈피드는 네이버에만 있는 노출 지면 — 블로거는 항상 검색형. 지정이 없으면 실시간 트렌드 주제는 홈판형, 검색어 기반은 검색형
    const format: PostFormat = t.platform === "NAVER" ? (naverFormat ?? (topic.origin === "channels" ? "HOMEFEED" : "SEARCH")) : "SEARCH";
    const locked = lockFree;
    lockFree = false;
    const titlePlan: Partial<TitlePlan> = { locked, secondaryKeyword: locked ? null : (secondaries[si++] ?? null) };
    const post = await db.post.create({
      data: {
        topicId,
        platform: t.platform,
        format,
        accountId: t.accountId ?? null,
        title: topic.title,
        focusKeyword: topic.keyword,
        normalizedKeyword: norm,
        status: "GENERATING",
        titlePlan: titlePlan as Prisma.InputJsonValue,
      },
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

/** 원본 링크 표시용 정보 (URL 은 원본이 공개 발행된 뒤에만 씀) */
async function sourceLinkOf(sourcePostId: string | null) {
  if (!sourcePostId) return null;
  const src = await db.post.findUnique({ where: { id: sourcePostId }, include: { account: { select: { name: true } } } });
  return src ? { id: src.id, title: src.title, url: publicUrlOf(src), platform: src.platform, accountName: src.account?.name ?? "", content: src.content } : null;
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
    // 내부링크 후보: 같은 계정의 발행 글 중 같은 주제 묶음(메인 키워드·태그)을 먼저 — 필러 글은 반드시 연결
    const published = post.accountId
      ? await db.post.findMany({
          where: { accountId: post.accountId, status: "PUBLISHED", remoteUrl: { not: null }, id: { not: postId } },
          select: { title: true, remoteUrl: true, focusKeyword: true, tags: true, publishedAt: true, topic: { select: { signals: true } } },
          orderBy: { publishedAt: "desc" },
          take: 60,
        })
      : [];
    const topicMain = asObject<{ mainKeyword?: string }>(post.topic?.signals, {}).mainKeyword;
    const siblings = await db.post.findMany({
      where: { topicId: post.topicId ?? "__none__", id: { not: postId } },
      select: { title: true },
    });
    const source = await sourceLinkOf(post.sourcePostId);
    const sourceM = source ? readManuscript(source.content) : null;
    const keyword = post.topic?.keyword ?? post.focusKeyword;

    // 함께 검색되는 롱테일 문구 — 발굴 때 저장된 것이 없으면(실시간 메인 키워드 등) 지금 조회해 주제에 저장
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
    if (relatedKeywords?.length) await log(`함께 검색되는 문구 ${relatedKeywords.length}개를 참고용으로 전달 (같은 이야기인 것만 골라 쓰도록)`);
    const storyContext = storyContextOf(post.topic?.signals);
    if (storyContext) await log(`실시간 소재의 실제 수집 기사 ${storyContext.articles.length}개·사건 요약을 전달 (이 사건 중심으로 쓰도록)`);
    const userSources = userSourcesOf(post.research);
    if (userSources) {
      await log(`사용자 자료 ${userSources.notes.trim().length.toLocaleString("ko-KR")}자·URL ${userSources.urls.length}개 반영(방식: ${userSources.mode === "only" ? "내 자료만" : "내 자료 우선"})`);
    }

    // 제목 전략 — 수명(상시/반복/이슈)과 시간 표현 검색량(검색광고, 블로그 검색 API 한도와 별개)으로 날짜를 넣을지 판단
    const sig = asObject<{ seasonality?: string | null; timeForms?: TimeForm[]; titleOptions?: { title: string }[]; titleLocked?: boolean; answerType?: AnswerType | null }>(post.topic?.signals, {});
    const prevPlan = asObject<Partial<TitlePlan>>(post.titlePlan, {});
    const timeForms = sig.timeForms ?? (keyword ? await findTimeForms(keyword).catch(() => []) : []);
    const lifespan = lifespanOf({ origin: post.topic?.origin, seasonality: sig.seasonality, timeForms });
    // 예전 원고(titlePlan 없음)는 고른 제목이면 확정으로 봄. 재발행은 원본과 다른 제목이어야 하므로 확정하지 않음
    const locked = !post.sourcePostId && (prevPlan.locked ?? isChosenTitle(post.topic?.title ?? post.title, sig));
    const lockedTitle = locked ? (post.topic?.title ?? post.title) : null;
    const secondaryKeyword = prevPlan.secondaryKeyword ?? null;
    const titleRules = titleRulesText({ keyword, lifespan, timeForms, secondaryKeyword, today: ymd(new Date()) });
    await log(
      `제목: ${locked ? `확정 제목 "${lockedTitle}" 사용` : "원고 AI 가 제목 규칙으로 작성"} · ${lifespan === "issue" ? "이슈형" : lifespan === "recurring" ? "해마다 반복" : "상시형"}${timeForms.length ? ` · 검색되는 시간 표현 ${timeForms.map((f) => f.form).join(", ")}` : ""}${secondaryKeyword ? ` · 보조 검색어 "${secondaryKeyword}"` : ""}`,
    );

    const { manuscript, research } = await generateManuscript(
      {
        platform,
        keyword,
        mainKeyword: topicMain,
        relatedKeywords: relatedKeywords ?? undefined,
        storyContext,
        userSources: userSources ? { notes: userSources.notes, urls: userSources.urls, mode: userSources.mode } : undefined,
        title: post.topic?.title ?? post.title,
        titlePlan: { locked, rules: titleRules },
        angle: post.topic?.angle,
        persona: (post.topic?.persona ?? "GENERAL") as Persona,
        tool: post.topic?.tool,
        intent: post.topic?.intent,
        format: post.format as PostFormat,
        accountName: post.account?.name,
        accountConcept: post.account?.concept,
        internalLinks: rankInternalLinks(
          { keyword, mainKeyword: topicMain, terms: relatedKeywords?.map((r) => r.keyword) },
          published.map((p) => ({
            title: p.title,
            url: p.remoteUrl!,
            focusKeyword: p.focusKeyword,
            mainKeyword: asObject<{ mainKeyword?: string }>(p.topic?.signals, {}).mainKeyword,
            tags: Array.isArray(p.tags) ? (p.tags as string[]) : [],
            publishedAt: p.publishedAt,
          })),
        ),
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
    // 확정 제목: 원고 AI 가 이유 없이 바꿨으면 되돌림 (사실과 어긋나 바꾼 경우만 이유와 함께 남김)
    const changeReason = manuscript.titleChangeReason?.trim() || null;
    if (lockedTitle && manuscript.title.trim() !== lockedTitle.trim()) {
      if (changeReason) await log(`확정 제목을 바꿨습니다 — 이유: ${changeReason}`);
      else {
        await log(`원고 AI 가 확정 제목을 이유 없이 바꿔 되돌렸습니다 ("${manuscript.title}" → "${lockedTitle}")`);
        manuscript.title = lockedTitle;
      }
    } else if (!lockedTitle && keyword) manuscript.title = fixYearOrder(stripTitleNoise(manuscript.title, keyword), keyword, timeForms);
    manuscript.titleChangeReason = lockedTitle && manuscript.title !== lockedTitle ? (changeReason ?? "") : "";
    if (keyword) {
      manuscript.focusKeyword = keyword;
      const fixed = ensureKeywordInTitle(manuscript.title, keyword);
      if (fixed !== manuscript.title) {
        await log(`제목에 핵심 키워드 "${keyword}"가 그대로 없어 앞에 붙였습니다`);
        manuscript.title = fixed;
      }
    }
    const checks = titleChecks(manuscript.title, { keyword, lifespan, timeForms, answerType: sig.answerType, intent: post.topic?.intent, related: relatedKeywords?.map((r) => r.keyword) });
    const failed = checks.filter((c) => c.pass === false);
    if (failed.length) await log(`제목 점검 ✖ ${failed.map((c) => `${c.label}(${c.note})`).join(" · ")}`);
    const titlePlan: TitlePlan = {
      lifespan,
      timeForms,
      locked,
      lockedTitle,
      changeReason: manuscript.titleChangeReason || null,
      secondaryKeyword,
      timeInTitle: /(20\d\d|\d+차|\d분기|상반기|하반기)/.test(manuscript.title),
      failed: failed.map((c) => c.id),
      decidedAt: new Date().toISOString(),
    };

    await db.post.update({
      where: { id: postId },
      data: {
        content: manuscript as unknown as Prisma.InputJsonValue,
        // 사용자 제공 자료(user)는 다시 생성해도 지우지 않음 — 다음 재생성·검수에도 근거로 쓰임
        research: { ...research, ...(userSources ? { user: userSources } : {}) } as unknown as Prisma.InputJsonValue,
        title: manuscript.title,
        slug: manuscript.slug,
        focusKeyword: manuscript.focusKeyword,
        normalizedKeyword: post.normalizedKeyword || normalizeKeyword(post.topic?.keyword ?? manuscript.focusKeyword),
        metaDescription: manuscript.metaDescription,
        tags: manuscript.tags,
        titlePlan: titlePlan as unknown as Prisma.InputJsonValue,
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

/**
 * 유사문서 검사 — 같은 플랫폼 안에서만 비교합니다.
 * (같은 주제를 블로거·네이버용으로 각각 다시 쓴 것은 의도된 정상 동작이라 플랫폼 간 비교는 오탐이 됩니다)
 */
export async function similarityAgainstOthers(postId: string, platform: string, text: string) {
  const others = await db.post.findMany({
    where: { id: { not: postId }, platform, status: { notIn: ["FAILED", "REJECTED"] } },
    select: { id: true, title: true, content: true, accountId: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  let max = 0;
  let withPost: { id: string; title: string } | null = null;
  for (const o of others) {
    const om = readManuscript(o.content);
    if (!om) continue;
    const s = similarity(text, manuscriptText(om));
    if (s > max) [max, withPost] = [s, { id: o.id, title: o.title }];
  }
  return { max, with: withPost };
}

/** 승인 직전에 다시 계산한 유사도 (같은 주제를 두 계정에 만들면 먼저 끝난 글은 저장값이 0% 로 남기 때문) */
export async function currentSimilarity(postId: string, platform: string, m: Manuscript) {
  const { max, with: withPost } = await similarityAgainstOthers(postId, platform, manuscriptText(m));
  return { max: Math.round(max * 100) / 100, with: withPost, warn: max >= SIMILARITY_WARN };
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
    // 공개된 글의 주소만 캐노니컬로 — 초안 편집 주소·비공개 주소는 쓰지 않음
    canonicalUrl: publicUrlOf(post),
    placeholders: opts.forPublish ? "strip" : "highlight",
    riskDisclaimers: detectRisk(manuscriptRiskText(m))?.disclaimers,
    sourceLink: undefined,
  };
  const source = await sourceLinkOf(post.sourcePostId);
  if (source) ro.sourceLink = { title: source.title, url: source.url };

  const platform = post.platform as Platform;
  const html = platform === "BLOGGER" ? renderBlogger(m, ro) : renderNaverPreview(renderNaverSegments(m, ro));
  const internalUrls = post.accountId
    ? (await db.post.findMany({ where: { accountId: post.accountId, status: "PUBLISHED", remoteUrl: { not: null }, id: { not: postId } }, select: { remoteUrl: true }, take: 200 })).map((p) => p.remoteUrl!)
    : [];
  const report = auditManuscript(m, platform, {
    internalUrls,
    imageCount: images.length,
    bannedPhrases: brand.bannedPhrases,
    disclosureText: brand.disclosure.affiliate,
    renderedHtml: html,
    today: ymd(new Date()),
    researchNotes: researchNotesOf(post.research),
  });

  const text = manuscriptText(m);
  const { max: maxSim, with: simWith } = await similarityAgainstOthers(postId, post.platform, text);

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
