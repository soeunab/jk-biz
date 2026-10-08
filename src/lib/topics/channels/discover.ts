import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../../db";
import { getBrowser } from "../../browser";
import { generateJson, routeFor } from "../../llm";
import type { JobContext } from "../../jobs/queue";
import { detectIntent, monetizationScore, normalizeKeyword, trendScore } from "../scoring";
import { momentumOf, type LongtailCandidate } from "../longtail";
import { COLLECTORS } from "./collectors";
import { defaultDebugDir, firstLine } from "./collectors/common";
import { DEFAULT_CHANNEL_CONFIG, type ChannelConfig } from "./config";
import { buildGroups, type Group } from "./crossref";
import { CATEGORY_LIST, NO_RESTRICTION, UNCLASSIFIED } from "./filters";
import { chooseMain, contextFor, groupBase, interpretStories, isKeywordItem, type Story } from "./keywords";
import { CHANNEL_LABEL, scoreGroup } from "./scoring";
import { comma, fmtAgo, fmtCount, norm } from "./text";
import { CHANNEL_IDS, type ChannelId, type ChannelItem, type ChannelResult } from "./types";

export { groupBase, isKeywordItem } from "./keywords";

/**
 * 실시간 트렌드 발굴 (contents-finder 포팅) — 기존 자동완성 발굴(topics/discover.ts)과 나란히 쓰는 두 번째 방식.
 *  1) 6개 채널 수집 → 6시간 넘은 자료 제외
 *  2) 같은 사건끼리 묶고(crossref) 근거와 함께 점수화(scoring) → 부정 사건·정치 제외, 고른 카테고리 밖 분리, 애매한 분류는 AI 재분류
 *  3) 이미 저장한 소재·같은 사건 제외
 *  4) 소재 해석(AI) → 메인 키워드(씨드) 1개를 네이버 검색량·문서수로 확인 (keywords.ts)
 *  5) 메인 키워드만 Topic 으로 저장 — 주제 화면에서 골라 바로 원고를 생성합니다 (메인 키워드가 제목 맨 앞, 사건 요약이 관점)
 * 점수 근거 문장(rationale)은 AI 가 아니라 규칙이 수집 값으로 만든 사실 문장입니다.
 * 매 실행의 수집 원본은 storage/channels/runs/ 에 남아 `npm run channels:eval` 로 같은 데이터에서 결과를 다시 평가할 수 있습니다.
 */

export type ChannelDiscoverOptions = {
  /** 네이버 블로그 32개 카테고리 중 하나, 또는 "주제 선택 보류"(거르지 않음) */
  category?: string;
  /** 저장할 추천 소재 수 */
  limit?: number;
  /** 수집할 채널 (기본: 6개 전부) */
  channels?: ChannelId[];
};

export const ChannelCategorySchema = z.object({
  items: z.array(
    z.object({
      groupId: z.number().int().describe("소재 번호 (입력의 [소재 #번호] 그대로)"),
      category: z.enum([UNCLASSIFIED, ...CATEGORY_LIST] as [string, ...string[]]).describe("네이버 블로그 카테고리 하나 (판단 불가면 미분류)"),
    }),
  ),
});

export type Analysis = { groups: Group[]; ranked: Group[]; excluded: Group[]; offTopic: Group[] };

/** 발굴 실행 시점 기준 신선도 기준 (6시간) */
export const FRESH_WINDOW_MIN = 360;

/**
 * 신선도 필터 — 6시간 넘은 개별 자료는 교차검증에 들어가기 전에 뺌.
 * 나이 정보가 없는 항목(네이트 실시간 검색어처럼 타임스탬프가 아예 없는 것)은 "오래됐다"고 단정할 근거가 없어 그대로 둠.
 * 구글 트렌드의 나이는 '검색 급증이 시작된 시각'이라, 아직 '활성'(지금도 급증 중)이면 시작이 6시간 전이어도 지금 화제 — 유지.
 */
export function freshItems(collected: ChannelItem[]): ChannelItem[] {
  const stillTrending = (i: ChannelItem) => i.channel === "google_trends" && i.extra?.status === "활성";
  return collected.filter((i) => i.ageMinutes == null || i.ageMinutes <= FRESH_WINDOW_MIN || stillTrending(i));
}

/**
 * 순수 분석: 항목 → 그룹 → 점수 → 추천/제외/주제 밖 분리 (네트워크·DB 없음)
 * 원본 main.py 는 참고 자료에 없어, 리포트 구조(TOP·제외된 이슈·주제 밖 이슈)에 맞춰 다음처럼 정했습니다:
 *  - ignore_keywords: 방송사·포털 이름 그 자체인 키워드형 항목만 뺌 (기사 제목에 들어간 경우는 유지)
 *  - 제외 사유가 있으면 제외 → 나머지 중 카테고리가 맞으면 추천, 아니면 주제 밖
 *  - 추천은 점수 내림차순, 같으면 참여 채널이 많은 순
 */
export function analyzeItems(items: ChannelItem[], include: string[], cfg: ChannelConfig = DEFAULT_CHANNEL_CONFIG): Analysis {
  const ignore = new Set(cfg.filters.ignoreKeywords.map((k) => norm(k)));
  const pool = items.filter((i) => !(isKeywordItem(i) && ignore.has(norm(i.title))));
  const groups = buildGroups(pool, 1.6, !!cfg.tuning?.strictArticleGrouping);
  return rescore(groups, include, cfg);
}

/** 그룹 점수·분류를 다시 계산하고 분리 (AI 재분류로 categoryOverride 를 붙인 뒤에도 씀) */
export function rescore(groups: Group[], include: string[], cfg: ChannelConfig = DEFAULT_CHANNEL_CONFIG): Analysis {
  const restricted = !include.includes(NO_RESTRICTION);
  for (const g of groups) {
    g.excludedReason = "";
    scoreGroup(g, cfg, include);
  }
  const excluded = groups.filter((g) => g.excludedReason);
  const rest = groups.filter((g) => !g.excludedReason);
  const onTopic = (g: Group) => !restricted || include.includes(g.category);
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

const evidenceOf = (i: ChannelItem) => ({
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
});

/** 키워드 리포트 (UI '채널 수집 근거' 아래 키워드 분석) — 메인 키워드와 측정한 대안 검색어 */
export type KeywordReport = {
  /** 측정 출발점이 된 검색어 (AI 제안 또는 대표어) */
  base: string;
  /** 이전 방식으로 저장된 기록에는 없음 */
  seeds?: string[];
  usedKeyword: string;
  best: string | null;
  candidates: LongtailCandidate[];
  story?: { summary: string; by: "ai" | "fallback" } | null;
};

/** Topic.signals 에 저장할 근거 (원본 수집 값 그대로) */
export function groupSignals(
  g: Group,
  category: string,
  status: ChannelStatus[],
  longtail: KeywordReport | null,
  related: { keyword: string; volume: number | null }[],
  context: ChannelItem[] = [],
) {
  return {
    origin: "channels",
    category,
    score: g.score,
    reasons: g.reasons,
    metrics: g.metrics,
    preempt: !!g.metrics?.preempt,
    flags: g.flags,
    evidence: g.items.slice(0, 8).map(evidenceOf),
    /** 기사 없는 키워드형 소재에 맥락으로 붙인 '같은 단어가 나온 기사' (이전 기록에는 없음) */
    context: context.map(evidenceOf) as ReturnType<typeof evidenceOf>[] | undefined,
    /** 이전 방식(실시간 발굴에서 제목·구성안까지 만들던 때)의 기록에만 있음 */
    ai: null as { titles: string[]; outline: string[]; caution: string } | null,
    /** 메인 키워드(씨드) — 롱테일·제목은 확장에서 만듦 */
    stage: "seed" as "seed" | undefined,
    collectedAt: new Date().toISOString(),
    channelStatus: status,
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

/** 수집 원본을 남김 (최근 30회) — channels:eval 이 같은 데이터로 결과를 다시 평가 */
export const RUNS_DIR = path.join(process.cwd(), "storage", "channels", "runs");
async function saveRunSnapshot(meta: Record<string, unknown>, items: ChannelItem[]): Promise<string | null> {
  try {
    await mkdir(RUNS_DIR, { recursive: true });
    const file = path.join(RUNS_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(file, JSON.stringify({ ...meta, at: new Date().toISOString(), items }));
    const old = (await readdir(RUNS_DIR)).filter((f) => f.endsWith(".json")).sort().slice(0, -30);
    await Promise.all(old.map((f) => unlink(path.join(RUNS_DIR, f)).catch(() => undefined)));
    return file;
  } catch {
    return null;
  }
}

/** 메인 키워드까지 정해진 저장 예정 소재 */
export type PlannedTopic = {
  g: Group;
  story: Story;
  context: ChannelItem[];
  /** 메인 키워드 (검색량·문서수 측정값 포함) */
  main: LongtailCandidate;
  /** 측정한 대안 검색어 */
  alternates: LongtailCandidate[];
  /** 메인 키워드에 네이버 검색량(월 10회 이상)이 잡혔는지 — false 면 막 터진 이슈라 데이터가 아직 없음 */
  measured: boolean;
};

/**
 * 추천 후보(점수순) → 저장할 소재 limit 개. 해석(AI 1회) → 메인 키워드 확정(검색량·문서수) → 키워드 중복 제외.
 * 무슨 일인지 알 수 없는 소재(기사·맥락 없는 키워드 한 단어 등)는 빼고, 빠지는 자리는 다음 순위로 채웁니다.
 */
export async function planTopics(
  ranked: Group[],
  pool: ChannelItem[],
  opts: { limit: number; existingKeywords: Set<string>; network: boolean; log: (m: string) => unknown },
): Promise<{ planned: PlannedTopic[]; noStory: Group[]; sameEvent: Group[]; dupKeyword: number }> {
  const { limit, network, log } = opts;
  // 해석은 점수순으로 묶음 단위(limit+5개)로 — 근거 부족·같은 사건으로 빠진 만큼 다음 순위를 더 해석 (최대 3묶음)
  const batch = limit + Math.min(limit, 5);
  const context = new Map<number, ChannelItem[]>();
  const stories = new Map<number, Story>();
  const noStory: Group[] = [];
  const sameEvent: Group[] = [];
  const usable: Group[] = [];
  for (let from = 0, round = 0; from < ranked.length && usable.length < limit + 2 && round < 3; from += batch, round++) {
    const cands = ranked.slice(from, from + batch);
    for (const g of cands) context.set(g.id, contextFor(g, pool));
    for (const [id, st] of await interpretStories(cands, context, log)) stories.set(id, st);
    for (const g of cands) {
      const st = stories.get(g.id)!;
      if (!st.hasStory) noStory.push(g);
      // 같은 사건을 다른 측면에서 다룬 소재는 점수 높은 하나만 (같은 일로 글 여러 편이 되지 않게)
      else if (st.sameAs != null) sameEvent.push(g);
      else usable.push(g);
    }
  }

  const seen = new Set(opts.existingKeywords);
  const planned: PlannedTopic[] = [];
  let dupKeyword = 0;
  for (const g of usable) {
    if (planned.length >= limit) break;
    const story = stories.get(g.id)!;
    const { main, alternates, measured } = await chooseMain(story, network);
    const nk = normalizeKeyword(main.keyword);
    if (!nk || seen.has(nk)) {
      dupKeyword++;
      continue;
    }
    seen.add(nk);
    planned.push({ g, story, context: context.get(g.id) ?? [], main, alternates, measured });
  }
  return { planned, noStory, sameEvent, dupKeyword };
}

export const fmtMetric = (c: LongtailCandidate) =>
  `${c.keyword}(월 ${c.volume != null ? c.volume.toLocaleString("ko-KR") : "미확인"}${c.documentCount != null ? `, 문서 ${c.documentCount.toLocaleString("ko-KR")}` : ""})`;

export async function discoverFromChannels(opts: ChannelDiscoverOptions = {}, ctx?: JobContext) {
  const log = (m: string) => ctx?.log(m);
  const category = opts.category?.trim() || NO_RESTRICTION;
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 30);
  const channels = (opts.channels?.length ? opts.channels : CHANNEL_IDS).filter((c) => CHANNEL_IDS.includes(c));
  await log(`실시간 트렌드 발굴 시작 — 카테고리: ${category} · 채널 ${channels.length}개`);
  const network = !process.env.CHANNELS_FIXTURE?.trim();

  // 1) 수집 → 신선도 필터
  const results = await collectChannels(channels, log);
  const status: ChannelStatus[] = results.map((r) => ({ channel: r.channel, label: r.label, ok: r.ok, count: r.items.length, seconds: Math.round(r.seconds), error: r.error, notes: r.notes }));
  const collected = results.flatMap((r) => r.items);
  await ctx?.progress(50, `수집 완료 — ${results.filter((r) => r.ok).length}/${results.length}개 채널, 항목 ${collected.length}개`);
  if (!collected.length) throw new Error("모든 채널에서 항목을 가져오지 못했어요. 네트워크 또는 화면 구조 변경을 확인하세요 (npm run channels:check).");
  if (network) await saveRunSnapshot({ category, limit }, collected);
  const items = freshItems(collected);
  if (collected.length !== items.length) await log(`6시간 넘은 자료 ${collected.length - items.length}건 제외`);

  // 2) 교차검증·점수화 → 분류가 애매한 소재는 AI 재분류 후 다시 점수화
  let analysis = analyzeItems(items, [category], DEFAULT_CHANNEL_CONFIG);
  if (category !== NO_RESTRICTION && (await reclassifyAmbiguous(analysis.groups, log))) analysis = rescore(analysis.groups, [category], DEFAULT_CHANNEL_CONFIG);
  const { groups, ranked, excluded, offTopic } = analysis;
  await log(`소재 그룹 ${groups.length}개 → 추천 후보 ${ranked.length} · 제외 ${excluded.length} · 주제 밖 ${offTopic.length}`);
  if (excluded.length) await log(`제외(부정 사건·정치): ${excluded.slice(0, 3).map((g) => `${g.label} — ${g.excludedReason}`).join(" / ")}`);
  if (offTopic.length) await log(`주제 밖이지만 화제: ${offTopic.slice(0, 3).map((g) => `${g.label}(${g.category}, ${g.score}점)`).join(" / ")}`);

  // 3) 중복 제외 — ① 이미 저장된 키워드(소재명·대표어)  ② 최근 7일 안에 저장한 실시간 소재와 같은 사건(근거 기사 겹침)
  const existing = new Set((await db.topic.findMany({ select: { normalizedKeyword: true, keyword: true } })).map((t) => t.normalizedKeyword || normalizeKeyword(t.keyword)));
  const recent = seenStories(
    await db.topic.findMany({ where: { origin: "channels", createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, select: { signals: true } }),
  );
  const fresh = ranked.filter((g) => !existing.has(normalizeKeyword(g.label)) && !existing.has(normalizeKeyword(groupBase(g))) && !isSeenStory(g, recent));
  if (ranked.length !== fresh.length) await log(`이미 저장한 소재·같은 사건 ${ranked.length - fresh.length}개 제외`);
  if (!fresh.length) {
    await log("저장할 새 추천 소재가 없어요 (이미 저장된 소재이거나 고른 카테고리에 맞는 소재가 없음).");
    return { created: 0, excluded: excluded.length, offTopic: offTopic.length, channels: status };
  }
  await ctx?.progress(60, `추천 후보 ${fresh.length}개 — 소재 해석·키워드 측정 중`);

  // 4) 소재 해석(AI) → 메인 키워드 확정(검색량·문서수)
  const { planned, noStory, sameEvent, dupKeyword } = await planTopics(fresh, items, { limit, existingKeywords: existing, network, log });
  if (noStory.length) await log(`무슨 일인지 근거가 부족해 뺀 소재 ${noStory.length}개: ${noStory.slice(0, 5).map((g) => g.label.slice(0, 20)).join(" / ")}`);
  if (sameEvent.length) await log(`앞 소재와 같은 사건이라 뺀 소재 ${sameEvent.length}개: ${sameEvent.slice(0, 5).map((g) => g.label.slice(0, 20)).join(" / ")}`);
  if (dupKeyword) await log(`메인 키워드가 이미 저장된 것과 같아 건너뛴 소재 ${dupKeyword}개`);
  if (network) await log(`메인 키워드: ${planned.map((p) => `${fmtMetric(p.main)}${p.measured ? "" : " ※검색량 미확인"}`).join(" / ")}`);
  await ctx?.progress(80, `메인 키워드 확정 ${planned.length}개`);
  if (!planned.length) {
    await log("저장할 소재가 없어요 (근거가 부족하거나 메인 키워드가 모두 이미 저장됨).");
    return { created: 0, excluded: excluded.length, offTopic: offTopic.length, channels: status };
  }

  // 5) 저장 — 메인 키워드만. 주제 화면에서 골라 바로 원고 생성
  const affiliateTags = (await db.affiliateProduct.findMany({ where: { active: true }, select: { tags: true } }))
    .flatMap((p) => p.tags.split(","))
    .map((t) => t.trim())
    .filter(Boolean);
  let created = 0;
  for (const p of planned) {
    const { g, main } = p;
    const keyword = main.keyword;
    const momentum = network && main.volume != null ? await momentumOf(keyword) : null;
    const monetization = monetizationScore({ keyword, monthlySearch: main.volume, documentCount: main.documentCount, compIdx: main.compIdx, adDepth: main.adDepth, sources: [] }, affiliateTags);
    const channelCount = g.metrics?.channels.length ?? 0;
    await db.topic.create({
      data: {
        origin: "channels",
        category: g.category,
        keyword,
        normalizedKeyword: normalizeKeyword(keyword),
        title: keyword,
        angle: p.story.summary,
        persona: "GENERAL",
        tool: "",
        // 실시간 소재는 네이버(빠른 노출), 에버그린은 블로거 — 사용자와 합의한 운영 방식
        targetPlatform: "NAVER",
        intent: detectIntent(keyword),
        // 네이버 공식 수치 (검색광고 월검색량·블로그 문서수). 검색량이 아직 잡히지 않은 신조어면 null(미확인)
        searchVolume: main.volume,
        documentCount: main.documentCount,
        trendScore: trendScore(momentum),
        competitionScore: main.competitionScore,
        monetizationScore: monetization,
        totalScore: g.score,
        confidence: Math.min(3, channelCount),
        verification: channelCount >= 2 ? "VERIFIED" : "SUGGESTED",
        rationale: g.reasons.join(" · "),
        signals: groupSignals(
          g,
          g.category,
          status,
          {
            base: keyword,
            seeds: p.story.phrases,
            usedKeyword: keyword,
            best: null,
            candidates: [main, ...p.alternates],
            story: { summary: p.story.summary, by: p.story.by },
          },
          p.alternates.map((c) => ({ keyword: c.keyword, volume: c.volume })),
          p.context,
        ) as unknown as Prisma.InputJsonValue,
      },
    });
    created++;
  }
  await ctx?.progress(100, `메인 키워드 ${created}개 저장`);
  return { created, excluded: excluded.length, offTopic: offTopic.length, channels: status };
}
