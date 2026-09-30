import { readFile } from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../../db";
import { getBrand, PERSONAS } from "../../brand";
import { getBrowser } from "../../browser";
import { generateJson } from "../../llm";
import type { JobContext } from "../../jobs/queue";
import { monetizationScore, normalizeKeyword, trendScore } from "../scoring";
import { adVolumes, ensureKeywordInTitle, expandKeyword, isHeadKeyword, momentumOf, volumeOf, type LongtailResult } from "../longtail";
import type { AdKeyword } from "../sources";
import { COLLECTORS } from "./collectors";
import { defaultDebugDir, firstLine } from "./collectors/common";
import { DAUM_TREND_SOURCE } from "./collectors/daum";
import { NATE_KEYWORD_SOURCE } from "./collectors/nate";
import { DEFAULT_CHANNEL_CONFIG, type ChannelConfig } from "./config";
import { buildGroups, type Group } from "./crossref";
import { NO_RESTRICTION } from "./filters";
import { CHANNEL_LABEL, scoreGroup } from "./scoring";
import { comma, fmtAgo, fmtCount, norm, tokens } from "./text";
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
};

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
function isKeywordItem(i: ChannelItem) {
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
 * 확장 출발점 고르기: 실시간 검색어가 있으면 그것, 아니면 헤드라인의 2~3단어 조각(및 긴 단어) 중
 * 네이버 월검색량이 가장 큰 것 — "사람들이 실제로 치는 말"을 데이터로 고릅니다.
 */
export async function chooseBase(g: Group, network: boolean): Promise<string> {
  const fallback = groupBase(g);
  if (!network || g.items.some((i) => isKeywordItem(i) && i.title.trim().length <= 20)) return fallback;
  const words = g.label.replace(/[“”"‘’'…·,!?()[\]<>|/~]/g, " ").split(/\s+/).filter(Boolean);
  const grams = new Set<string>();
  for (let n = 2; n <= 3; n++) for (let i = 0; i + n <= words.length; i++) grams.add(words.slice(i, i + n).join(" "));
  for (const w of words) if (normalizeKeyword(w).length >= 5) grams.add(w);
  const hints = [fallback, ...[...grams].filter((x) => normalizeKeyword(x).length >= 4 && !/^[\d\s]+$/.test(x))].slice(0, 20);
  const ad = await adVolumes(hints).catch(() => new Map<string, AdKeyword>());
  const best = hints
    .map((h) => ({ h, v: volumeOf(ad.get(normalizeKeyword(h))) }))
    .filter((x) => x.v != null && x.v >= 10)
    .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))[0];
  return best?.h ?? fallback;
}

function longtailLine(lt: LongtailResult | undefined): string {
  const measured = (lt?.candidates ?? []).filter((c) => c.volume != null && !isHeadKeyword(c.keyword)).slice(0, 8);
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
 */
export function analyzeItems(items: ChannelItem[], include: string[], cfg: ChannelConfig = DEFAULT_CHANNEL_CONFIG): Analysis {
  const ignore = new Set(cfg.filters.ignoreKeywords.map((k) => norm(k)));
  const pool = items.filter((i) => !(isKeywordItem(i) && ignore.has(norm(i.title))));
  const groups = buildGroups(pool);
  for (const g of groups) scoreGroup(g, cfg, include);
  const excluded = groups.filter((g) => g.excludedReason);
  const rest = groups.filter((g) => !g.excludedReason);
  const onTopic = (g: Group) => include.includes(NO_RESTRICTION) || include.includes(g.category);
  const ranked = rest.filter(onTopic).sort((a, b) => b.score - a.score || b.metrics!.channels.length - a.metrics!.channels.length || a.id - b.id);
  const offTopic = rest.filter((g) => !onTopic(g)).sort((a, b) => b.score - a.score || a.id - b.id);
  return { groups, ranked, excluded, offTopic };
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
export function groupSignals(g: Group, category: string, status: ChannelStatus[], idea?: ChannelIdea) {
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
  await log(`실시간 트렌드 발굴 시작 — 카테고리: ${category} · 채널 ${channels.length}개`);

  // 1) 수집
  const results = await collectChannels(channels, log);
  const status: ChannelStatus[] = results.map((r) => ({ channel: r.channel, label: r.label, ok: r.ok, count: r.items.length, seconds: Math.round(r.seconds), error: r.error, notes: r.notes }));
  const items = results.flatMap((r) => r.items);
  await ctx?.progress(50, `수집 완료 — ${results.filter((r) => r.ok).length}/${results.length}개 채널, 항목 ${items.length}개`);
  if (!items.length) throw new Error("모든 채널에서 항목을 가져오지 못했어요. 네트워크 또는 화면 구조 변경을 확인하세요 (npm run channels:check).");

  // 2) 교차검증·점수화
  const { groups, ranked, excluded, offTopic } = analyzeItems(items, [category]);
  await log(`소재 그룹 ${groups.length}개 → 추천 후보 ${ranked.length} · 제외 ${excluded.length} · 주제 밖 ${offTopic.length}`);
  if (excluded.length) await log(`제외(부정 사건·정치): ${excluded.slice(0, 3).map((g) => `${g.label} — ${g.excludedReason}`).join(" / ")}`);
  if (offTopic.length) await log(`주제 밖이지만 화제: ${offTopic.slice(0, 3).map((g) => `${g.label}(${g.category}, ${g.score}점)`).join(" / ")}`);

  const existing = new Set((await db.topic.findMany({ select: { normalizedKeyword: true, keyword: true } })).map((t) => t.normalizedKeyword || normalizeKeyword(t.keyword)));
  const top = ranked.filter((g) => !existing.has(normalizeKeyword(g.label))).slice(0, limit);
  await ctx?.progress(65, `추천 소재 ${top.length}개 선정`);
  if (!top.length) {
    await log("저장할 새 추천 소재가 없어요 (이미 저장된 소재이거나 고른 카테고리에 맞는 소재가 없음).");
    return { created: 0, excluded: excluded.length, offTopic: offTopic.length, channels: status };
  }

  // 3) 롱테일 확장 — 소재의 대표어를 실제 검색 문구(자동완성·"함께 많이 찾는")로 넓히고 문구마다 네이버 공식 검색량 확인
  //    (픽스처·오프라인 모드에서는 네트워크를 쓰지 않음)
  const network = !process.env.CHANNELS_FIXTURE?.trim();
  const longtails = new Map<number, LongtailResult>();
  for (const g of top) {
    longtails.set(g.id, await expandKeyword(await chooseBase(g, network), { network, docs: 6 }));
  }
  const withVolume = [...longtails.values()].filter((lt) => lt.candidates.some((c) => c.volume != null && !isHeadKeyword(c.keyword))).length;
  if (network) await log(`롱테일 확장: 소재 ${top.length}개 중 ${withVolume}개에서 네이버 검색량이 잡힌 롱테일 문구 확인`);
  await ctx?.progress(75, "롱테일 확장 완료");

  // 4) AI 기획 — 기존 라우팅(구독 Claude Code / 로컬 Ollama / 수동)을 그대로 사용
  const brand = await getBrand();
  const today = new Date().toISOString().slice(0, 10);
  const blogTopic = opts.domain?.trim() || (category !== NO_RESTRICTION ? `네이버 블로그 '${category}' 분야 정보 블로그` : `${brand.name} — ${brand.mission}`);
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
- keyword: 소재에 "롱테일 후보"가 있으면 그중 하나를 글자 그대로 고르세요. 검색량이 적당하고 경쟁점수가 높은 구체적인 문구(2단어 이상)가 상위 노출에 유리합니다. 후보가 없으면 수집 근거 제목에 실제로 나온 단어로 정하세요.
- 제목은 keyword 를 형태 변형 없이(띄어쓰기·조사 붙이지 말고) 맨 앞에 두세요. 뒤쪽에 다른 후보 문구를 1개 자연스럽게 섞어도 됩니다.
- 이 블로그 주제가 AI 도구와 무관하면 tool 은 빈 문자열로 두고, 소재를 억지로 AI 도구 활용법으로 비틀지 마세요.
- 제목·구성안에 수집 근거에 없는 날짜·금액·수치를 넣지 마세요. 연도를 쓰려면 오늘 기준 연도만 쓰세요. 필요하면 "공식 발표로 확인" 같은 단계를 구성안에 넣으세요.

${top.map((g) => `[소재 #${g.id}] ${g.label}\n분류: ${g.category}\n점수 근거: ${g.reasons.slice(0, 4).join("; ")}\n${longtailLine(longtails.get(g.id))}\n수집 근거:\n${evidenceLines(g)}`).join("\n\n")}`,
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
    const idea = ideaFor(g, idx);
    if (idea) used.add(idea);
    else unmatched++;
    const lt = longtails.get(g.id);
    const kw = idea?.keyword.trim();
    // AI 기획이 없으면 헤드라인 통째가 아니라 롱테일(없으면 소재 대표어)을 키워드로
    let keyword = kw && kw.length <= 40 ? kw : (lt?.best?.keyword ?? groupBase(g));
    let metric = lt?.candidates.find((c) => normalizeKeyword(c.keyword) === normalizeKeyword(keyword));
    // 헤드 키워드를 골랐거나, 롱테일 후보가 있는데 후보 밖 단어를 골랐으면 검색량이 확인된 최적 롱테일로 — 상위 노출이 목적
    if (lt?.best && (isHeadKeyword(keyword) || metric?.volume == null)) {
      keyword = lt.best.keyword;
      metric = lt.best;
    }
    const nk = normalizeKeyword(keyword);
    if (!nk || seen.has(nk)) continue;
    seen.add(nk);
    if (metric?.volume != null) longtailUsed++;
    // 롱테일 키워드에 실제 검색량이 있으면 데이터랩 트렌드·광고경쟁도 기반 수익성도 실제 값으로 계산
    const momentum = network && metric?.volume != null ? await momentumOf(metric.keyword) : null;
    const monetization = metric ? monetizationScore({ keyword, monthlySearch: metric.volume, documentCount: metric.documentCount, compIdx: metric.compIdx, adDepth: metric.adDepth, sources: [] }, affiliateTags) : 0;
    const channelCount = g.metrics?.channels.length ?? 0;
    const related = (lt?.candidates ?? [])
      .filter((c) => normalizeKeyword(c.keyword) !== nk)
      .slice(0, 12)
      .map((c) => ({ keyword: c.keyword, volume: c.volume }));
    await db.topic.create({
      data: {
        origin: "channels",
        category: g.category,
        keyword,
        normalizedKeyword: nk,
        title: idea ? ensureKeywordInTitle(idea.titles[0]?.trim() || keyword, keyword) : keyword,
        angle: idea?.angle ?? "",
        persona: idea?.persona ?? "GENERAL",
        tool: idea?.tool?.trim() ?? "",
        targetPlatform: "NAVER",
        intent: "informational",
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
        signals: {
          ...groupSignals(g, g.category, status, idea),
          longtail: lt ? { base: lt.base, best: lt.best?.keyword ?? null, candidates: lt.candidates.slice(0, 10) } : null,
          related,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    created++;
  }
  if (unmatched) await log(`⚠️ AI 기획과 매칭되지 않은 소재 ${unmatched}개는 롱테일 키워드만 붙여 저장 (제목·구성안은 원고 생성 때 작성)`);
  if (network) await log(`저장한 ${created}개 중 ${longtailUsed}개는 네이버 검색량이 확인된 롱테일을 제목 키워드로 사용`);
  await ctx?.progress(100, `추천 소재 ${created}개 저장`);
  return { created, excluded: excluded.length, offTopic: offTopic.length, channels: status };
}
