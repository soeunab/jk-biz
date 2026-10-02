import { readFile } from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../../db";
import { getBrand, PERSONAS } from "../../brand";
import { getBrowser } from "../../browser";
import { generateJson, routeFor } from "../../llm";
import type { JobContext } from "../../jobs/queue";
import { detectIntent, monetizationScore, normalizeKeyword, trendScore } from "../scoring";
import { adVolumes, ensureKeywordInTitle, expandKeyword, isHeadKeyword, momentumOf, pickLongtail, volumeOf, type LongtailCandidate, type LongtailResult, type RelatedKeyword } from "../longtail";
import type { AdKeyword } from "../sources";
import { COLLECTORS } from "./collectors";
import { defaultDebugDir, firstLine } from "./collectors/common";
import { DAUM_TREND_SOURCE } from "./collectors/daum";
import { NATE_KEYWORD_SOURCE } from "./collectors/nate";
import { DEFAULT_CHANNEL_CONFIG, type ChannelConfig } from "./config";
import { buildGroups, type Group } from "./crossref";
import { CATEGORY_LIST, matchesFocus, NO_RESTRICTION, UNCLASSIFIED } from "./filters";
import { CHANNEL_LABEL, scoreGroup } from "./scoring";
import { comma, fmtAgo, fmtCount, norm, stripJosa, stripPressSuffix, tokens } from "./text";
import { CHANNEL_IDS, type ChannelId, type ChannelItem, type ChannelResult } from "./types";

/**
 * 실시간 트렌드 발굴 (contents-finder 포팅) — 기존 자동완성 발굴(topics/discover.ts)과 나란히 쓰는 두 번째 방식.
 * 6개 채널에서 지금 화제인 소재를 모아 → 같은 사건끼리 묶고(crossref) → 근거와 함께 점수화(scoring) →
 * 부정 사건·정치는 제외, 고른 카테고리 밖은 따로 빼고 → 상위 소재만 AI 로 제목·구성안을 붙여 Topic 으로 저장합니다.
 *
 * 저장 전에 소재의 대표어를 롱테일로 확장(자동완성·"함께 많이 찾는"·검색광고)해 AI 가 그중에서 제목 키워드를 고르게 하고,
 * 네이버에 검색량이 잡힌 문구면 그 공식 수치를 붙입니다. 막 터진 이슈라 아직 데이터가 없으면 null(미확인).
 * 점수 근거 문장(rationale)은 AI 가 아니라 규칙이 수집 값으로 만든 사실 문장입니다.
 */

export type ChannelDiscoverOptions = {
  /** 네이버 블로그 32개 카테고리 중 하나, 또는 "주제 선택 보류"(거르지 않음) */
  category?: string;
  /** 저장할 추천 소재 수 */
  limit?: number;
  /** 이 발굴 묶음의 블로그 주제 설명 (비우면 카테고리 → 브랜드 미션 순) */
  domain?: string;
  /** 수집할 채널 (기본: 6개 전부) */
  channels?: ChannelId[];
  /**
   * 관심 주제 단어 (예: AI 관련 — filters.ts AI_FOCUS_TERMS). 주면 소재 제목에 이 중 하나라도 있는 소재만 추천하고,
   * 분류가 고른 카테고리와 달라도(예: '오픈AI 상장'이 경제로 분류) 이 블로그 소재로 봅니다.
   */
  focusTerms?: string[];
};

export const ChannelCategorySchema = z.object({
  items: z.array(
    z.object({
      groupId: z.number().int().describe("소재 번호 (입력의 [소재 #번호] 그대로)"),
      category: z.enum([UNCLASSIFIED, ...CATEGORY_LIST] as [string, ...string[]]).describe("네이버 블로그 카테고리 하나 (판단 불가면 미분류)"),
    }),
  ),
});

export const ChannelIdeaSchema = z.object({
  ideas: z.array(
    z.object({
      groupId: z.number().int().describe("소재 번호 (입력의 [소재 #번호] 그대로)"),
      keyword: z.string().describe("제목 핵심 키워드 — 소재의 '롱테일 후보'가 있으면 그중 하나를 글자 그대로, 없으면 수집 근거 제목에 실제로 나온 단어(2~20자)"),
      titles: z.array(z.string()).min(1).max(3).describe("추천 제목 1~3개 (keyword 를 형태 변형 없이 맨 앞에, 25~40자, 과장·낚시·부정 표현 금지)"),
      angle: z.string().describe("차별화 관점 한 줄"),
      outline: z.array(z.string()).describe("글 구성안 (도입~마무리, 5~8단계)"),
      caution: z.string().describe("작성 시 주의점 한 줄"),
      persona: z.enum(["SOLO", "FREELANCER", "OFFICE", "GENERAL"]).describe("주 독자. 특정 독자가 없으면 GENERAL"),
      tool: z.string().describe("글이 실제로 다루는 AI 도구 이름. AI 도구와 무관하면 빈 문자열(\"\") — 억지로 끼워 넣지 마세요"),
    }),
  ),
});
export type ChannelIdea = z.infer<typeof ChannelIdeaSchema>["ideas"][number];

export type Analysis = { groups: Group[]; ranked: Group[]; excluded: Group[]; offTopic: Group[] };

/** 키워드형 항목(구글 트렌드·네이트/다음 실시간 키워드)의 제목 */
export function isKeywordItem(i: ChannelItem) {
  return i.channel === "google_trends" || i.source === NATE_KEYWORD_SOURCE || i.source === DAUM_TREND_SOURCE;
}

/** 롱테일 확장의 출발점: 실시간 검색어(키워드형 항목) → 짧은 소재명 → 핵심 토큰 2개 순 */
export function groupBase(g: Group): string {
  const kw = g.items.find((i) => isKeywordItem(i) && i.title.trim().length <= 20)?.title.trim();
  if (kw) return kw;
  const label = g.label.trim();
  if (label.length <= 15 && !/[“”"‘’'…·,!?]/.test(label)) return label;
  return [...g.core].slice(0, 2).join(" ") || label.slice(0, 15);
}

/**
 * 제목 → 구절별 조사 뗀 낱말 (2~3단어 조각을 만들 때 '여행객이' 대신 '여행객').
 * '·'·','·'…' 는 구절 경계 — '신한·국민·하나·우리·농협' 에서 '우리 농협' 같은 조각이 나오지 않게.
 */
function titlePhrases(title: string): string[][] {
  return stripPressSuffix(title)
    .replace(/(\d),(\d)/g, "$1$2") // '7,000선' 이 '7 000선' 으로 쪼개지지 않게
    .replace(/\[[^\]]{1,14}\]|【[^】]{1,14}】/g, " ")
    .split(/[…·,!?|/~]|\.{2,}/)
    .map((seg) =>
      seg
        .replace(/[“”"‘’'()[\]<>]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => (/[가-힣]/.test(w) ? stripJosa(w) : w)),
    )
    .filter((ws) => ws.length);
}
const titleWords = (title: string) => titlePhrases(title).flat();

/**
 * 확장 출발점 고르기 — "사람들이 실제로 치는, 이 사건에 맞는 말"을 네이버 월검색량으로 고릅니다.
 *  - 실시간 검색어가 있는 소재: 그 검색어("베트남")만으로 확장하면 사건과 무관한 문구('베트남 이심')가 후보가 되므로,
 *    기사 제목에서 그 검색어를 포함한 2~3단어 조각('베트남 여행', '베트남 비자')을 만들어 검색량이 있는 것 중 가장 큰 것을 씀.
 *    그런 조각이 없으면 검색어 그대로.
 *  - 기사만 있는 소재: 헤드라인·상위 기사 제목의 2~3단어 조각(및 긴 단어) 중 검색량이 가장 큰 것.
 */
export async function chooseBase(g: Group, network: boolean): Promise<string> {
  return (await chooseBases(g, network))[0];
}

/** chooseBase 의 후보 순서 (최대 3개) — 첫 출발점에서 사건과 관련된 롱테일이 안 나오면 다음 것으로 다시 확장 */
export async function chooseBases(g: Group, network: boolean): Promise<string[]> {
  const fallback = groupBase(g);
  if (!network) return [fallback];
  const kwItem = g.items.find((i) => isKeywordItem(i) && i.title.trim().length <= 20)?.title.trim();
  const articles = g.items.filter((i) => !isKeywordItem(i)).map((i) => i.title);
  if (kwItem && !articles.length) return [kwItem];
  const titles = kwItem ? articles.slice(0, 5) : [g.label, ...articles.slice(0, 3)];
  const grams = new Set<string>();
  for (const t of titles) {
    for (const words of titlePhrases(t)) {
      for (let n = 2; n <= 3; n++) for (let i = 0; i + n <= words.length; i++) grams.add(words.slice(i, i + n).join(" "));
      for (const w of words) if (normalizeKeyword(w).length >= 5) grams.add(w);
    }
  }
  let hints = [...grams].filter((x) => normalizeKeyword(x).length >= 4 && !/^[\d\s]+$/.test(x));
  if (kwItem) {
    const k = normalizeKeyword(kwItem);
    hints = hints.filter((h) => normalizeKeyword(h).includes(k) && normalizeKeyword(h) !== k);
  }
  // 여러 기사 제목에 공통으로 나오는 조각일수록 사건의 핵심 — 그것부터 검색량을 잼
  const allTitles = g.items.filter((i) => !isKeywordItem(i)).map((i) => normalizeKeyword(titleWords(i.title).join(" ")));
  const freq = (h: string) => allTitles.filter((t) => t.includes(normalizeKeyword(h))).length;
  const ordered = hints.map((h) => ({ h, f: freq(h) })).sort((a, b) => b.f - a.f);
  hints = [fallback, ...ordered.map((x) => x.h)].slice(0, 20);
  const ad = await adVolumes(hints).catch(() => new Map<string, AdKeyword>());
  const measured = hints.map((h) => ({ h, v: volumeOf(ad.get(normalizeKeyword(h))), f: freq(h) })).filter((x) => x.v != null && x.v >= 10);
  // 사건에 맞는 구체적인 문구(헤드 키워드 아님)를 우선 — 기사가 3건 이상이면 2건 이상에 나온 핵심 조각 중에서 검색량 최대.
  // 없으면 검색량이 잡힌 것 중 최대, 그것도 없으면 대표어
  const specifics = measured.filter((x) => !isHeadKeyword(x.h) && x.h !== fallback);
  const central = allTitles.length >= 3 ? specifics.filter((x) => x.f >= 2) : [];
  const byVol = (xs: typeof measured) => [...xs].sort((a, b) => (b.v ?? 0) - (a.v ?? 0)).map((x) => x.h);
  const order = [...byVol(central), ...byVol(specifics)];
  if (!kwItem && !order.length) order.push(...byVol(measured));
  return [...new Set([...order, fallback])].slice(0, 3);
}

/** 소재의 수집 제목(+ 구글 트렌드 연관 검색어)을 이어 붙인 비교용 문자열 */
function storyText(g: Group): string {
  return g.items.map((i) => `${i.title} ${(((i.extra?.related as string[] | undefined) ?? []) as string[]).join(" ")}`).join(" ");
}

/** 정보 탐색형 꼬리말 — 사건 기사에 없어도 그 사건을 찾는 사람이 붙여 치는 말 ('베트남 여행 추천', '코스피 전망') */
const INFO_MODIFIERS = ["추천", "방법", "정리", "총정리", "뜻", "이유", "전망", "일정", "현황", "시세", "가격", "비용", "신청", "조건", "대상", "기간", "후기", "비교", "순위", "주가", "예약", "할인", "혜택", "정보", "날짜", "결과", "확인", "조회", "대처", "피해", "보상"];

/**
 * 롱테일 후보가 이 사건과 관련 있는지. 확장 출발점(base)이 '베트남'처럼 넓거나 '삼성 반도체'처럼 여러 사건에 걸치면
 * '베트남 이심'·'평택 삼성반도체'처럼 기사와 무관한 문구가 후보에 섞입니다 — base 에 덧붙은 말이 수집 제목에 실제로 나오거나
 * 정보 탐색형 꼬리말(추천·전망·일정…)일 때만 관련 있다고 봅니다.
 */
export function storyRelevant(candidate: string, base: string, g: Group, modifiers = true): boolean {
  const c = normalizeKeyword(candidate);
  const b = normalizeKeyword(base);
  const story = normalizeKeyword(storyText(g));
  const rest = c.replace(b, "");
  if (!rest || story.includes(rest)) return true;
  const isMod = (t: string) => modifiers && INFO_MODIFIERS.some((m) => t === m || (t.endsWith(m) && story.includes(t.slice(0, -m.length))));
  const extra = [...tokens(candidate)].map(normalizeKeyword).filter((t) => t && !b.includes(t));
  if (extra.length && extra.every((t) => story.includes(t) || isMod(t))) return true;
  return modifiers && INFO_MODIFIERS.includes(rest);
}

/**
 * 이 소재와 관련 있는 롱테일 후보만.
 * 출발점 문구의 검색량이 '다른 뜻'에서 나온 경우('중국어 AI 침투' 기사의 '중국어 AI' — 실제 검색은 중국어 학습)를 걸러내려고,
 * 검색량이 잡힌 확장이 3개 이상인데 그중 사건과 관련 있는 게 30% 미만이면 출발점 자체의 검색량도 이 사건 몫이 아니라고 보고 뺍니다.
 */
export function relevantCandidates(lt: LongtailResult | undefined, g: Group): LongtailCandidate[] {
  if (!lt) return [];
  const base = normalizeKeyword(lt.base);
  const rel = lt.candidates.filter((c) => storyRelevant(c.keyword, lt.base, g));
  const measuredExt = lt.candidates.filter((c) => c.volume != null && normalizeKeyword(c.keyword) !== base);
  const relExt = measuredExt.filter((c) => rel.includes(c));
  // 출발점이 다른 뜻이면 '중국어ai추천'처럼 꼬리말만 붙은 확장도 그 다른 뜻의 검색 — 기사에 나온 말이 붙은 것만 남김
  if (measuredExt.length >= 3 && relExt.length / measuredExt.length < 0.3)
    return rel.filter((c) => normalizeKeyword(c.keyword) !== base && storyRelevant(c.keyword, lt.base, g, false));
  return rel;
}

function longtailLine(lt: LongtailResult | undefined, g: Group): string {
  const measured = relevantCandidates(lt, g).filter((c) => c.volume != null && !isHeadKeyword(c.keyword)).slice(0, 8);
  if (!measured.length) return "롱테일 후보: 네이버 검색량이 아직 잡힌 문구 없음 — 수집 근거 제목의 단어로 keyword 를 정하세요";
  return `롱테일 후보(네이버 실제 월검색량 — keyword 는 이 중 하나를 글자 그대로): ${measured
    .map((c) => `${c.keyword}(월 ${c.volume!.toLocaleString("ko-KR")}${c.competitionScore != null ? `, 경쟁점수 ${Math.round(c.competitionScore)}` : ""})`)
    .join(", ")}`;
}

/**
 * 순수 분석: 항목 → 그룹 → 점수 → 추천/제외/주제 밖 분리 (네트워크·DB 없음)
 * 원본 main.py 는 참고 자료에 없어, 리포트 구조(TOP·제외된 이슈·주제 밖 이슈)에 맞춰 다음처럼 정했습니다:
 *  - ignore_keywords: 방송사·포털 이름 그 자체인 키워드형 항목만 뺌 (기사 제목에 들어간 경우는 유지)
 *  - 제외 사유가 있으면 제외 → 나머지 중 카테고리가 맞으면 추천, 아니면 주제 밖
 *  - 추천은 점수 내림차순, 같으면 참여 채널이 많은 순
 *  - focusTerms 가 있으면 그 단어가 제목에 있는 소재만 추천 (카테고리가 달라도 고른 카테고리로 봄)
 */
export function analyzeItems(items: ChannelItem[], include: string[], cfg: ChannelConfig = DEFAULT_CHANNEL_CONFIG, focusTerms: string[] = []): Analysis {
  const ignore = new Set(cfg.filters.ignoreKeywords.map((k) => norm(k)));
  const pool = items.filter((i) => !(isKeywordItem(i) && ignore.has(norm(i.title))));
  const groups = buildGroups(pool, 1.6, !!cfg.tuning?.strictArticleGrouping);
  return rescore(groups, include, cfg, focusTerms);
}

/** 그룹 점수·분류를 다시 계산하고 분리 (AI 재분류로 categoryOverride 를 붙인 뒤에도 씀) */
export function rescore(groups: Group[], include: string[], cfg: ChannelConfig = DEFAULT_CHANNEL_CONFIG, focusTerms: string[] = []): Analysis {
  const restricted = !include.includes(NO_RESTRICTION);
  const focusOk = (g: Group) => !focusTerms.length || matchesFocus(storyText(g), focusTerms);
  for (const g of groups) {
    g.excludedReason = "";
    // 관심 주제 소재는 키워드 분류가 달라도 이 블로그의 소재 — 주제 밖 감점 없이 고른 카테고리로
    if (restricted && focusTerms.length && !g.categoryOverride && focusOk(g)) g.categoryOverride = include[0];
    scoreGroup(g, cfg, include);
  }
  const excluded = groups.filter((g) => g.excludedReason);
  const rest = groups.filter((g) => !g.excludedReason);
  const onTopic = (g: Group) => (!restricted || include.includes(g.category)) && focusOk(g);
  const ranked = rest.filter(onTopic).sort((a, b) => b.score - a.score || b.metrics!.channels.length - a.metrics!.channels.length || a.id - b.id);
  const offTopic = rest.filter((g) => !onTopic(g)).sort((a, b) => b.score - a.score || a.id - b.id);
  return { groups, ranked, excluded, offTopic };
}

/**
 * 키워드로 분류가 애매한 소재(동점·공통어뿐·미분류)를 AI 가 32개 카테고리 중 하나로 다시 분류합니다 (가벼운 작업 1회).
 * 원 채널이 카테고리를 알려 주는 출처가 일부뿐이라, 생활·문화 소재는 대부분 키워드 추측이었고 미분류는 항상 버려졌습니다.
 * 수동 모드(복사·붙여넣기)에서는 사람 손을 한 번 더 타게 되므로 건너뜁니다.
 */
export async function reclassifyAmbiguous(groups: Group[], log: (m: string) => unknown, max = 30): Promise<number> {
  const unsure = groups.filter((g) => !g.excludedReason && g.categoryAmbiguous && !g.categoryOverride).sort((a, b) => b.score - a.score).slice(0, max);
  if (!unsure.length) return 0;
  const route = await routeFor("light");
  if (route === "manual") {
    await log(`분류가 애매한 소재 ${unsure.length}개 — 수동 모드라 AI 재분류는 건너뜀 (키워드 분류 그대로)`);
    return 0;
  }
  try {
    const { items } = await generateJson({
      name: "channelCategories",
      task: "light",
      title: `실시간 소재 카테고리 분류 (${unsure.length}개)`,
      system: "당신은 뉴스 소재를 네이버 블로그 카테고리로 분류하는 편집자입니다. 소재의 핵심 내용(누가·무엇을)으로 판단하고, 등장하는 단어 하나에 끌려가지 마세요.",
      prompt: `다음 소재들을 네이버 블로그 카테고리 중 하나로 분류하세요. 이 소재로 글을 쓴다면 어느 카테고리 블로그에 맞는지를 기준으로 합니다.
카테고리: ${CATEGORY_LIST.join(", ")} (어느 것도 아니면 ${UNCLASSIFIED})

${unsure.map((g) => `[소재 #${g.id}] ${g.label}\n${g.items.slice(0, 3).map((i) => `- ${i.title}`).join("\n")}`).join("\n\n")}`,
      schema: ChannelCategorySchema,
      effort: "low",
      maxTokens: 3000,
      mock: () => ({ items: [] }),
    });
    const byId = new Map(unsure.map((g) => [g.id, g]));
    let changed = 0;
    for (const it of items) {
      const g = byId.get(it.groupId);
      if (!g || it.category === UNCLASSIFIED) continue;
      if (it.category !== g.category) changed++;
      g.categoryOverride = it.category;
    }
    await log(`분류가 애매한 소재 ${unsure.length}개를 AI 로 재분류 — ${changed}개 카테고리 변경`);
    return changed;
  } catch (e) {
    await log(`⚠️ AI 재분류 실패 — 키워드 분류 그대로 진행: ${firstLine(e)}`);
    return 0;
  }
}

/** 최근 저장한 실시간 소재의 근거 기사 (URL·제목) — 같은 사건이 다른 대표어로 다시 저장되는 것 방지 */
export type SeenStories = { urls: Set<string>; titles: Set<string> };

export function seenStories(rows: { signals?: unknown }[]): SeenStories {
  const out: SeenStories = { urls: new Set(), titles: new Set() };
  for (const r of rows) {
    const ev = (r.signals as { evidence?: { channel?: string; title?: string; url?: string | null }[] } | null)?.evidence;
    for (const e of Array.isArray(ev) ? ev : []) {
      if (e.channel === "google_trends") continue; // 키워드형 근거는 사건이 아니라 검색어
      if (e.url) out.urls.add(e.url);
      if (e.title && e.title.length >= 10) out.titles.add(norm(e.title));
    }
  }
  return out;
}

/** 이미 저장한 사건인지 — 시드 기사가 겹치거나, 기사 2건 이상 또는 절반 이상이 겹치면 같은 사건 */
export function isSeenStory(g: Group, seen: SeenStories): boolean {
  const arts = g.items.filter((i) => !isKeywordItem(i));
  if (!arts.length) return false;
  const hit = (i: ChannelItem) => (!!i.url && seen.urls.has(i.url)) || (i.title.length >= 10 && seen.titles.has(norm(i.title)));
  const hits = arts.filter(hit).length;
  return hit(arts[0]) || hits >= 2 || hits / arts.length >= 0.5;
}

/** AI 에게 줄 수집 근거 줄 (원본 llm.py _evidence 와 같은 형식) */
export function evidenceLines(g: Group, max = 8): string {
  return g.items
    .slice(0, max)
    .map((it) => {
      const extra: string[] = [];
      if (it.growthPct) extra.push(`검색량 ${comma(it.growthPct)}%↑`);
      if (it.views) extra.push(`조회수 ${fmtCount(it.views)}`);
      if (it.ageMinutes != null) extra.push(fmtAgo(it.ageMinutes));
      if (it.clusterSize && it.clusterSize > 1) extra.push(`같은 사건 기사 ${it.clusterSize}건`);
      return `- ${[CHANNEL_LABEL[it.channel] ?? it.channel, it.source, it.title].join(" / ")}${extra.length ? ` (${extra.join(", ")})` : ""}`;
    })
    .join("\n");
}

/** Topic.signals 에 저장할 근거 (원본 수집 값 그대로) */
export function groupSignals(
  g: Group,
  category: string,
  status: ChannelStatus[],
  idea: ChannelIdea | undefined,
  longtail: { base: string; usedKeyword: string; best: string | null; candidates: LongtailResult["candidates"] } | null,
  related: RelatedKeyword[],
) {
  return {
    origin: "channels",
    category,
    score: g.score,
    reasons: g.reasons,
    metrics: g.metrics,
    preempt: !!g.metrics?.preempt,
    flags: g.flags,
    evidence: g.items.slice(0, 8).map((i) => ({
      channel: i.channel,
      channelLabel: CHANNEL_LABEL[i.channel] ?? i.channel,
      source: i.source,
      title: i.title,
      url: i.url || null,
      rank: i.rank ?? null,
      press: i.press || null,
      ageMinutes: i.ageMinutes ?? null,
      views: i.views ?? null,
      growthPct: i.growthPct ?? null,
      clusterSize: i.clusterSize ?? null,
    })),
    ai: idea ? { titles: idea.titles, outline: idea.outline, caution: idea.caution } : null,
    collectedAt: new Date().toISOString(),
    channelStatus: status,
    // 실제로 고른 키워드와, 그 대신 고를 수 있었던 롱테일 후보들 — "왜 경쟁점수가 이런지" UI 리포트용
    longtail,
    related,
  };
}

/** Topic.signals (origin=channels) 의 모양 */
export type ChannelTopicSignals = ReturnType<typeof groupSignals>;

export type ChannelStatus = { channel: ChannelId; label: string; ok: boolean; count: number; seconds: number; error: string; notes: string[] };

const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * 채널 수집. CHANNELS_FIXTURE 환경변수에 JSON 파일(항목 배열)을 주면 실제 사이트 대신 그 파일을 씁니다
 * — 오프라인 개발·화면 점검용이며, 작업 로그에 "픽스처 모드"로 표시됩니다.
 */
export async function collectChannels(channels: ChannelId[], log: (m: string) => unknown, cfg: ChannelConfig = DEFAULT_CHANNEL_CONFIG): Promise<ChannelResult[]> {
  const fixture = process.env.CHANNELS_FIXTURE?.trim();
  if (fixture) {
    const raw = JSON.parse(await readFile(fixture, "utf8")) as Record<string, unknown>[];
    const items = raw.map((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [camel(k), v])) as ChannelItem);
    await log(`⚠️ 픽스처 모드 (CHANNELS_FIXTURE=${fixture}) — 실제 사이트를 수집하지 않았습니다`);
    return channels.map((c) => {
      const mine = items.filter((i) => i.channel === c);
      return { channel: c, label: COLLECTORS[c].label, ok: mine.length > 0, items: mine, error: mine.length ? "" : "픽스처에 항목 없음", seconds: 0, notes: [] };
    });
  }
  const ctxBase = { cfg, debugDir: defaultDebugDir(), log };
  const results: ChannelResult[] = [];
  for (const c of channels) {
    const col = COLLECTORS[c];
    try {
      const browser = col.browser ? await getBrowser() : (null as never);
      results.push(await col.collect({ ...ctxBase, browser }));
    } catch (e) {
      results.push({ channel: c, label: col.label, ok: false, items: [], error: firstLine(e), seconds: 0, notes: [] });
    }
    const r = results.at(-1)!;
    await log(`${r.ok ? "✅" : "❌"} ${r.label}: ${r.items.length}건 (${r.seconds.toFixed(0)}초)${r.error ? ` — ${r.error}` : ""}${r.notes.length ? ` · ${r.notes.slice(0, 2).join(" / ")}` : ""}`);
  }
  return results;
}

function mockIdea(g: Group): ChannelIdea {
  const keyword = g.label.length <= 20 ? g.label : [...tokens(g.label)].slice(0, 2).join(" ") || g.label.slice(0, 20);
  return {
    groupId: g.id,
    keyword,
    titles: [`${keyword} — 지금 확인된 소식 정리`],
    angle: `여러 채널에서 확인된 "${keyword}" 소식을 수집된 사실 위주로 정리`,
    outline: ["도입: 어떤 소식인지", "확인된 사실 정리", "독자가 확인할 점", "마무리"],
    caution: "수집된 기사에 없는 사실·수치는 쓰지 않기",
    persona: "GENERAL",
    tool: "",
  };
}

export async function discoverFromChannels(opts: ChannelDiscoverOptions = {}, ctx?: JobContext) {
  const log = (m: string) => ctx?.log(m);
  const category = opts.category?.trim() || NO_RESTRICTION;
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 30);
  const channels = (opts.channels?.length ? opts.channels : CHANNEL_IDS).filter((c) => CHANNEL_IDS.includes(c));
  const focusTerms = (opts.focusTerms ?? []).map((t) => t.trim()).filter(Boolean);
  await log(`실시간 트렌드 발굴 시작 — 카테고리: ${category} · 채널 ${channels.length}개${focusTerms.length ? ` · 관심 주제: ${focusTerms.slice(0, 6).join(", ")}${focusTerms.length > 6 ? " 등" : ""}` : ""}`);

  // 1) 수집
  const results = await collectChannels(channels, log);
  const status: ChannelStatus[] = results.map((r) => ({ channel: r.channel, label: r.label, ok: r.ok, count: r.items.length, seconds: Math.round(r.seconds), error: r.error, notes: r.notes }));
  const collected = results.flatMap((r) => r.items);
  await ctx?.progress(50, `수집 완료 — ${results.filter((r) => r.ok).length}/${results.length}개 채널, 항목 ${collected.length}개`);
  if (!collected.length) throw new Error("모든 채널에서 항목을 가져오지 못했어요. 네트워크 또는 화면 구조 변경을 확인하세요 (npm run channels:check).");

  // 1-1) 신선도 필터 — 지금(발굴 실행 시점) 기준 6시간 넘은 개별 자료는 교차검증에 들어가기 전에 뺌.
  // 나이 정보가 없는 항목(네이트 실시간 검색어처럼 타임스탬프가 아예 없는 것)은 "오래됐다"고 단정할 근거가 없어 그대로 둠.
  // 구글 트렌드의 나이는 '검색 급증이 시작된 시각'이라, 아직 '활성'(지금도 급증 중)이면 시작이 6시간 전이어도 지금 화제 — 유지.
  const FRESH_WINDOW_MIN = 360;
  const stillTrending = (i: ChannelItem) => i.channel === "google_trends" && i.extra?.status === "활성";
  const items = collected.filter((i) => i.ageMinutes == null || i.ageMinutes <= FRESH_WINDOW_MIN || stillTrending(i));
  if (collected.length !== items.length) await log(`6시간 넘은 자료 ${collected.length - items.length}건 제외`);

  // 2) 교차검증·점수화 → 분류가 애매한 소재는 AI 재분류 후 다시 점수화
  let analysis = analyzeItems(items, [category], DEFAULT_CHANNEL_CONFIG, focusTerms);
  if (category !== NO_RESTRICTION && (await reclassifyAmbiguous(analysis.groups, log))) analysis = rescore(analysis.groups, [category], DEFAULT_CHANNEL_CONFIG, focusTerms);
  const { groups, ranked, excluded, offTopic } = analysis;
  await log(`소재 그룹 ${groups.length}개 → 추천 후보 ${ranked.length} · 제외 ${excluded.length} · 주제 밖 ${offTopic.length}`);
  if (excluded.length) await log(`제외(부정 사건·정치): ${excluded.slice(0, 3).map((g) => `${g.label} — ${g.excludedReason}`).join(" / ")}`);
  if (offTopic.length) await log(`주제 밖이지만 화제: ${offTopic.slice(0, 3).map((g) => `${g.label}(${g.category}, ${g.score}점)`).join(" / ")}`);

  // 중복 제외 — ① 이미 저장된 키워드(소재명·대표어)  ② 최근 7일 안에 저장한 실시간 소재와 같은 사건(근거 기사 겹침).
  // 자르기 전에 걸러야 요청한 개수만큼 저장됩니다. 저장 단계에서도 키워드가 겹쳐 빠질 수 있어 예비 소재를 조금 더 기획.
  const existing = new Set((await db.topic.findMany({ select: { normalizedKeyword: true, keyword: true } })).map((t) => t.normalizedKeyword || normalizeKeyword(t.keyword)));
  const recent = seenStories(
    await db.topic.findMany({ where: { origin: "channels", createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, select: { signals: true } }),
  );
  const fresh = ranked.filter((g) => !existing.has(normalizeKeyword(g.label)) && !existing.has(normalizeKeyword(groupBase(g))) && !isSeenStory(g, recent));
  if (ranked.length !== fresh.length) await log(`이미 저장한 소재·같은 사건 ${ranked.length - fresh.length}개 제외`);
  const top = fresh.slice(0, limit + Math.min(Math.ceil(limit * 0.3), 3));
  await ctx?.progress(65, `추천 소재 ${Math.min(top.length, limit)}개 선정${top.length > limit ? ` (+예비 ${top.length - limit})` : ""}`);
  if (!top.length) {
    await log("저장할 새 추천 소재가 없어요 (이미 저장된 소재이거나 고른 카테고리에 맞는 소재가 없음).");
    return { created: 0, excluded: excluded.length, offTopic: offTopic.length, channels: status };
  }

  // 3) 롱테일 확장 — 소재의 대표어를 실제 검색 문구(자동완성·"함께 많이 찾는")로 넓히고 문구마다 네이버 공식 검색량 확인
  //    (픽스처·오프라인 모드에서는 네트워크를 쓰지 않음)
  const network = !process.env.CHANNELS_FIXTURE?.trim();
  const longtails = new Map<number, LongtailResult>();
  const usable = (lt: LongtailResult, g: Group) => relevantCandidates(lt, g).some((c) => c.volume != null && c.volume >= 10 && !isHeadKeyword(c.keyword));
  for (const g of top) {
    const bases = await chooseBases(g, network);
    let lt = await expandKeyword(bases[0], { network, docs: 6 });
    // 첫 출발점에서 사건과 관련된 롱테일이 하나도 안 나오면(다른 뜻·너무 넓음) 다음 출발점으로 (최대 2번 더)
    for (const b of network ? bases.slice(1) : []) {
      if (usable(lt, g)) break;
      const next = await expandKeyword(b, { network, docs: 6 });
      if (usable(next, g)) lt = next;
    }
    longtails.set(g.id, lt);
  }
  const withVolume = [...longtails.values()].filter((lt) => lt.candidates.some((c) => c.volume != null && !isHeadKeyword(c.keyword))).length;
  if (network) await log(`롱테일 확장: 소재 ${top.length}개 중 ${withVolume}개에서 네이버 검색량이 잡힌 롱테일 문구 확인`);
  await ctx?.progress(75, "롱테일 확장 완료");

  // 4) AI 기획 — 기존 라우팅(구독 Claude Code / 로컬 Ollama / 수동)을 그대로 사용
  const brand = await getBrand();
  const today = new Date().toISOString().slice(0, 10);
  const blogTopic =
    (opts.domain?.trim() || (category !== NO_RESTRICTION ? `네이버 블로그 '${category}' 분야 정보 블로그` : `${brand.name} — ${brand.mission}`)) +
    (focusTerms.length ? ` (관심 주제: ${focusTerms.slice(0, 8).join(", ")})` : "");
  const { ideas } = await generateJson({
    name: "channelIdeas",
    task: "light",
    title: `실시간 트렌드 소재 기획 (${top.length}개)`,
    system: `당신은 한국어 블로그 콘텐츠 기획자입니다. 주어진 '실제 수집 데이터'만 근거로 삼고, 데이터에 없는 사실·수치는 지어내지 않습니다.
부정적·선정적·추측성 표현, 특정인 비하, 사건사고 자극 표현은 쓰지 않습니다.
이번 기획 대상 블로그의 주제: ${blogTopic}
독자 페르소나:
${Object.entries(PERSONAS).map(([k, p]) => `- ${k} (${p.label}): ${p.description}`).join("\n")}`,
    prompt: `다음은 오늘 여러 채널에서 교차 확인된 블로그 소재 후보입니다. 소재마다 글 기획을 하나씩 만들어 주세요.
오늘 날짜: ${today}
- groupId 는 [소재 #번호] 그대로 쓰세요. 모든 소재에 대해 하나씩 답하세요.
- keyword: 소재에 "롱테일 후보"가 있으면 그중 이 사건 내용에 맞는 것 하나를 글자 그대로 고르세요. 검색량이 적당하고 경쟁점수가 높은 구체적인 문구(2단어 이상)가 상위 노출에 유리합니다. 후보가 없으면 수집 근거 제목에 실제로 나온 단어로 정하세요.
- 제목은 keyword 를 형태 변형 없이(띄어쓰기·조사 붙이지 말고) 맨 앞에 두세요. 뒤쪽에 다른 후보 문구를 1개 자연스럽게 섞어도 됩니다.
- 이 블로그 주제가 AI 도구와 무관하면 tool 은 빈 문자열로 두고, 소재를 억지로 AI 도구 활용법으로 비틀지 마세요.
- 제목·구성안에 수집 근거에 없는 날짜·금액·수치를 넣지 마세요. 연도를 쓰려면 오늘 기준 연도만 쓰세요. 필요하면 "공식 발표로 확인" 같은 단계를 구성안에 넣으세요.

${top.map((g) => `[소재 #${g.id}] ${g.label}\n분류: ${g.category}\n점수 근거: ${g.reasons.slice(0, 4).join("; ")}\n${longtailLine(longtails.get(g.id), g)}\n수집 근거:\n${evidenceLines(g)}`).join("\n\n")}`,
    schema: ChannelIdeaSchema,
    effort: "medium",
    maxTokens: 8000,
    mock: () => ({ ideas: top.map(mockIdea) }),
  });
  await ctx?.progress(85, "AI 기획 완료");

  // 5) 저장 (추천 소재만)
  // 소재 번호로 매칭하되, 작은 로컬 모델이 번호를 1·2·3 으로 다시 매기는 경우가 있어 키워드·순서로도 매칭
  const byId = new Map(ideas.map((i) => [i.groupId, i]));
  const used = new Set<ChannelIdea>();
  const ideaFor = (g: Group, idx: number): ChannelIdea | undefined => {
    const direct = byId.get(g.id);
    if (direct && !used.has(direct)) return direct;
    const lt = longtails.get(g.id);
    const names = [g.label, groupBase(g), ...(lt?.candidates.map((c) => c.keyword) ?? [])].map(normalizeKeyword);
    const byKeyword = ideas.find((i) => {
      const k = normalizeKeyword(i.keyword);
      return !used.has(i) && k.length >= 2 && names.some((n) => n.includes(k) || k.includes(n));
    });
    if (byKeyword) return byKeyword;
    return ideas.length === top.length && !used.has(ideas[idx]) ? ideas[idx] : undefined;
  };
  const affiliateTags = (await db.affiliateProduct.findMany({ where: { active: true }, select: { tags: true } }))
    .flatMap((p) => p.tags.split(","))
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set(existing);
  let created = 0;
  let longtailUsed = 0;
  let unmatched = 0;
  for (const [idx, g] of top.entries()) {
    if (created >= limit) break; // 예비 소재는 앞에서 키워드 중복으로 빠진 자리만 채움
    const idea = ideaFor(g, idx);
    if (idea) used.add(idea);
    else unmatched++;
    const lt = longtails.get(g.id);
    // 이 사건과 관련 있는 후보만 — '베트남'으로 확장한 '베트남 이심'이 베트남 여행 기사 소재의 키워드가 되지 않도록
    const relevant = relevantCandidates(lt, g);
    const bestRelevant = pickLongtail(relevant);
    const kw = idea?.keyword.trim();
    // AI 기획이 없으면 헤드라인 통째가 아니라 관련 롱테일(없으면 소재 대표어)을 키워드로
    let keyword = kw && kw.length <= 40 ? kw : (bestRelevant?.keyword ?? groupBase(g));
    let metric = lt?.candidates.find((c) => normalizeKeyword(c.keyword) === normalizeKeyword(keyword));
    // 헤드 키워드·검색량 미확인·사건과 무관한 후보를 골랐고, 검색량이 확인된 관련 롱테일이 있으면 그것으로 — 상위 노출이 목적.
    // 관련 롱테일이 없으면 AI 가 기사에서 고른 키워드를 그대로 둠 (무관한 고검색량 문구로 바꾸면 제목이 엉뚱해짐)
    const offStory = metric != null && lt != null && !storyRelevant(metric.keyword, lt.base, g);
    let swapped = false;
    if (bestRelevant && normalizeKeyword(bestRelevant.keyword) !== normalizeKeyword(keyword) && (isHeadKeyword(keyword) || metric?.volume == null || offStory)) {
      keyword = bestRelevant.keyword;
      metric = bestRelevant;
      swapped = true;
    }
    const nk = normalizeKeyword(keyword);
    if (!nk || seen.has(nk)) continue;
    seen.add(nk);
    if (metric?.volume != null) longtailUsed++;
    // 롱테일 키워드에 실제 검색량이 있으면 데이터랩 트렌드·광고경쟁도 기반 수익성도 실제 값으로 계산
    const momentum = network && metric?.volume != null ? await momentumOf(metric.keyword) : null;
    const monetization = metric ? monetizationScore({ keyword, monthlySearch: metric.volume, documentCount: metric.documentCount, compIdx: metric.compIdx, adDepth: metric.adDepth, sources: [] }, affiliateTags) : 0;
    const channelCount = g.metrics?.channels.length ?? 0;
    // 원고 소제목·FAQ 에 쓰이는 연관 문구 — 사건과 무관한 문구는 빼야 원고가 엉뚱해지지 않음
    const related = relevant
      .filter((c) => normalizeKeyword(c.keyword) !== nk)
      .slice(0, 12)
      .map((c) => ({ keyword: c.keyword, volume: c.volume }));
    await db.topic.create({
      data: {
        origin: "channels",
        category: g.category,
        keyword,
        normalizedKeyword: nk,
        // 키워드를 바꿨으면 AI 제목 중 그 키워드가 들어간 것을 우선 (없으면 앞에 붙임)
        title: idea ? ensureKeywordInTitle((swapped && idea.titles.find((t) => normalizeKeyword(t).includes(nk))) || idea.titles[0]?.trim() || keyword, keyword) : keyword,
        angle: idea?.angle ?? "",
        persona: idea?.persona ?? "GENERAL",
        tool: idea?.tool?.trim() ?? "",
        // 실시간 소재는 네이버(빠른 노출), 에버그린은 블로거 — 사용자와 합의한 운영 방식
        targetPlatform: "NAVER",
        intent: detectIntent(keyword),
        // 고른 키워드가 네이버에 검색량이 잡힌 롱테일이면 그 공식 수치, 아니면 미확인(null)
        searchVolume: metric?.volume ?? null,
        documentCount: metric?.documentCount ?? null,
        trendScore: trendScore(momentum),
        competitionScore: metric?.competitionScore ?? null,
        monetizationScore: monetization,
        totalScore: g.score,
        confidence: Math.min(3, channelCount),
        verification: channelCount >= 2 ? "VERIFIED" : "SUGGESTED",
        rationale: g.reasons.join(" · "),
        signals: groupSignals(
          g,
          g.category,
          status,
          idea,
          lt ? { base: lt.base, usedKeyword: keyword, best: bestRelevant?.keyword ?? null, candidates: relevant.slice(0, 10) } : null,
          related,
        ) as unknown as Prisma.InputJsonValue,
      },
    });
    created++;
  }
  if (unmatched) await log(`⚠️ AI 기획과 매칭되지 않은 소재 ${unmatched}개는 롱테일 키워드만 붙여 저장 (제목·구성안은 원고 생성 때 작성)`);
  if (network) await log(`저장한 ${created}개 중 ${longtailUsed}개는 네이버 검색량이 확인된 롱테일을 제목 키워드로 사용`);
  await ctx?.progress(100, `추천 소재 ${created}개 저장`);
  return { created, excluded: excluded.length, offTopic: offTopic.length, channels: status };
}
