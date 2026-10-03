/**
 * 실시간 소재 → 검색 키워드: "AI 가 사건을 해석하고, 데이터가 키워드를 고른다".
 *
 * 왜 이렇게 나눴나: 기사 제목을 글자 조각으로 잘라 규칙으로 검색어를 고르던 방식은 동음이의('중국어 AI 침투' → 중국어 학습),
 * 나열형 제목('신한·국민·하나·우리·농협'), 기사 없는 키워드('은행')에서 계속 엉뚱한 키워드를 냈습니다.
 *  1) 해석(AI, 가벼운 작업 1회): 소재마다 무슨 일인지 한 줄 + 이 일을 찾는 사람이 네이버에 칠 검색어 3~6개.
 *     기사 없는 키워드형 소재는 수집 풀에서 같은 단어가 나온 기사를 맥락으로 붙여 줍니다. 그래도 무슨 일인지 모르면 추천하지 않음.
 *  2) 측정(데이터): 제안 검색어 + 그 검색어를 통째로 포함한 자동완성·검색광고 확장 → 네이버 월검색량 → 상위 후보 문서수.
 *     "관련 있음"은 규칙 추측이 아니라 '사건을 이해한 검색어를 포함하는가'로 정해집니다.
 *  3) 확인(AI, 1회): 측정한 후보가 사건 내용과 어긋나지 않는지 ('코스피 7000 회복' 기사에 '코스피 7000선 붕괴' 같은 확장 걸러냄).
 *  4) 선택(데이터): 통과한 후보 중 경쟁(문서수÷검색량)·검색량 점수가 가장 높은 것. 고른 키워드는 항상 검색량·문서수를 잽니다.
 */
import { z } from "zod";
import { generateJson, routeFor } from "../../llm";
import { naverAutocomplete, naverBlogDocCount } from "../sources";
import { competitionScore, normalizeKeyword } from "../scoring";
import { adVolumes, isHeadKeyword, longtailScore, pickLongtail, volumeOf, type LongtailCandidate } from "../longtail";
import type { Group } from "./crossref";
import { norm } from "./text";
import type { ChannelItem } from "./types";
import { DAUM_TREND_SOURCE } from "./collectors/daum";
import { NATE_KEYWORD_SOURCE } from "./collectors/nate";
import type { AdKeyword } from "../sources";

/** 키워드형 항목(구글 트렌드·네이트/다음 실시간 키워드) */
export function isKeywordItem(i: ChannelItem) {
  return i.channel === "google_trends" || i.source === NATE_KEYWORD_SOURCE || i.source === DAUM_TREND_SOURCE;
}

/** 소재의 대표어: 실시간 검색어(키워드형 항목) → 짧은 소재명 → 핵심 토큰 2개 순 */
export function groupBase(g: Group): string {
  const kw = g.items.find((i) => isKeywordItem(i) && i.title.trim().length <= 20)?.title.trim();
  if (kw) return kw;
  const label = g.label.trim();
  if (label.length <= 15 && !/[“”"‘’'…·,!?]/.test(label)) return label;
  return [...g.core].slice(0, 2).join(" ") || label.slice(0, 15);
}

export const articlesOf = (g: Group) => g.items.filter((i) => !isKeywordItem(i));

/**
 * 기사 없는 키워드형 소재('은행'·'분당 신도시')의 맥락: 수집 풀에서 대표어가 제목에 나온 기사 (채널이 다양하게, 최대 max건).
 * 교차검증(crossref)은 2글자 키워드를 기사에 붙이지 않아(오탐 방지) 이런 소재는 근거가 키워드 한 줄뿐이었습니다.
 */
export function contextFor(g: Group, pool: ChannelItem[], max = 5): ChannelItem[] {
  if (articlesOf(g).length) return [];
  // 띄어쓰기를 살려 비교 — 공백을 지우면 '당신은 행복한'에 '은행'이 걸림
  const spaced = (t: string) => ` ${t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const k = spaced(groupBase(g)).trim();
  if (norm(k).length < 2) return [];
  const hits = pool.filter((i) => !isKeywordItem(i) && spaced(i.title).includes(` ${k}`));
  const out: ChannelItem[] = [];
  const seen = new Set<string>();
  for (const round of [0, 1]) {
    for (const i of hits) {
      if (out.length >= max) break;
      if (round === 0 && seen.has(i.channel)) continue; // 첫 바퀴는 채널마다 하나씩
      if (out.includes(i)) continue;
      out.push(i);
      seen.add(i.channel);
    }
  }
  return out;
}

export const StorySchema = z.object({
  stories: z.array(
    z.object({
      groupId: z.number().int().describe("소재 번호 (입력의 [소재 #번호] 그대로)"),
      hasStory: z.boolean().describe("수집 근거만으로 무슨 일인지 알 수 있으면 true. 키워드 한 단어뿐이거나 근거 기사들이 서로 다른 일이라 하나로 말할 수 없으면 false"),
      summary: z.string().describe("무슨 일인지 한 줄 (근거에 있는 사실만, 40자 안팎)"),
      phrases: z.array(z.string()).max(6).describe("이 일에 대한 정보를 찾는 사람이 네이버 검색창에 실제로 칠 검색어 3~6개 (2~4단어)"),
      sameAs: z.number().int().nullable().describe("앞 번호 소재와 같은 사건이면 그 소재 번호, 아니면 null"),
    }),
  ),
});
export type Story = { hasStory: boolean; summary: string; phrases: string[]; by: "ai" | "fallback"; sameAs?: number | null };

const cleanPhrase = (p: string) => p.replace(/["“”'‘’]/g, "").replace(/\s+/g, " ").trim();

/** AI 없이(수동 모드·데모·AI 실패) 쓰는 해석: 기사가 있으면 대표어만 검색어로 */
export function fallbackStory(g: Group, context: ChannelItem[]): Story {
  return { hasStory: articlesOf(g).length > 0 || context.length > 0, summary: g.label, phrases: [groupBase(g)], by: "fallback" };
}

/** 소재들을 한 번에 해석 (가벼운 작업) */
export async function interpretStories(groups: Group[], context: Map<number, ChannelItem[]>, log: (m: string) => unknown): Promise<Map<number, Story>> {
  const out = new Map<number, Story>(groups.map((g) => [g.id, fallbackStory(g, context.get(g.id) ?? [])]));
  if (!groups.length) return out;
  if ((await routeFor("light")) === "manual") {
    await log("수동 모드라 소재 해석(AI)은 건너뛰고 대표어로 검색어를 잽니다");
    return out;
  }
  const block = (g: Group) => {
    const own = g.items.slice(0, 6).map((i) => `- ${i.title}${isKeywordItem(i) ? " (실시간 검색어)" : ""}`);
    const ctx = (context.get(g.id) ?? []).map((i) => `- ${i.title} (같은 단어가 나온 기사)`);
    return `[소재 #${g.id}] ${g.label}\n${[...own, ...ctx].join("\n")}`;
  };
  try {
    const { stories } = await generateJson({
      name: "channelStories",
      task: "light",
      title: `실시간 소재 해석 (${groups.length}개)`,
      system: "당신은 네이버 검색 키워드를 잘 아는 블로그 편집자입니다. 주어진 수집 근거만 보고 판단하고, 근거에 없는 사실은 지어내지 않습니다.",
      prompt: `소재마다 (1) 무슨 일인지 한 줄로 요약하고 (2) 이 일에 대한 정보를 찾는 사람이 네이버 검색창에 실제로 칠 검색어를 3~6개 제안하세요.
- 검색어는 2~4단어의 실제 검색 문구로 쓰세요. 기사 제목 문장을 그대로 옮기지 마세요. (예: "하나은행 해킹", "하나은행 개인정보 유출 확인", "코스피 7000 회복")
- 이 사건과 직접 관련된 말만 쓰세요. 제목에 우연히 같이 나온 단어(나열된 회사명, 동음이의어)로 다른 주제를 만들지 마세요.
- 기사들이 여러 일을 다루면 가장 많이 다뤄진 하나의 일로 요약하고, 검색어도 그 일에 맞추세요 ("다양한 이슈" 같은 요약 금지).
- 근거가 키워드 한 단어뿐이라 무슨 일인지 알 수 없으면 hasStory=false 로 두세요.
- 앞 번호 소재와 같은 사건(같은 일을 다른 기사·다른 측면에서 다룸)이면 sameAs 에 그 소재 번호를 쓰세요. 아니면 null.
- groupId 는 [소재 #번호] 그대로, 모든 소재에 답하세요.

${groups.map(block).join("\n\n")}`,
      schema: StorySchema,
      effort: "low",
      maxTokens: 4000,
      mock: () => ({ stories: [] }),
    });
    for (const s of stories) {
      if (!out.has(s.groupId)) continue;
      const phrases = [...new Set(s.phrases.map(cleanPhrase).filter((p) => p.length >= 2 && p.length <= 30))];
      const sameAs = s.sameAs != null && s.sameAs !== s.groupId && out.has(s.sameAs) ? s.sameAs : null;
      out.set(s.groupId, { hasStory: s.hasStory && phrases.length > 0, summary: s.summary.trim(), phrases, by: "ai", sameAs });
    }
  } catch (e) {
    await log(`⚠️ 소재 해석(AI) 실패 — 대표어로 진행: ${(e as Error).message.split("\n")[0]}`);
  }
  return out;
}

function candidate(keyword: string, sources: string[], a: AdKeyword | undefined): LongtailCandidate {
  const volume = volumeOf(a);
  return { keyword, sources, volume, compIdx: a?.compIdx ?? null, adDepth: a?.adDepth ?? null, documentCount: null, competitionScore: null, score: longtailScore(volume, null) };
}

/** 문서수를 재고 경쟁점수·선택 점수를 갱신 */
async function measureDocs(c: LongtailCandidate): Promise<void> {
  c.documentCount = await naverBlogDocCount(c.keyword).catch(() => null);
  c.competitionScore = competitionScore(c.documentCount, c.volume);
  c.score = longtailScore(c.volume, c.competitionScore);
}

/**
 * 제안 검색어를 실제 데이터로 잽니다. 후보 = 제안 검색어 + 그것을 통째로 포함한 자동완성·검색광고 확장
 * (포함 관계라 다른 주제 문구가 섞이지 않음). docs 를 주면 검색량 상위 롱테일의 문서수까지 (기본은 검색량만 — 문서수는 확인 뒤에).
 */
export async function measurePhrases(phrases: string[], opts: { network: boolean; docs?: number }): Promise<LongtailCandidate[]> {
  const seeds = phrases.map(normalizeKeyword).filter(Boolean);
  const found = new Map<string, { keyword: string; sources: Set<string> }>();
  const add = (k: string, src: string) => {
    const text = k.trim().replace(/\s+/g, " ");
    const n = normalizeKeyword(text);
    if (!n || text.length > 40) return;
    if (src !== "ai" && !seeds.some((s) => n.includes(s))) return;
    const e = found.get(n) ?? { keyword: text, sources: new Set<string>() };
    e.sources.add(src);
    found.set(n, e);
  };
  phrases.forEach((p) => add(p, "ai"));
  let ad = new Map<string, AdKeyword>();
  if (opts.network) {
    for (const p of phrases) (await naverAutocomplete(p).catch(() => [] as string[])).forEach((k) => add(k, "naver-ac"));
    ad = await adVolumes([...found.values()].map((c) => c.keyword)).catch(() => new Map<string, AdKeyword>());
    for (const a of ad.values()) add(a.keyword, "naver-searchad");
  }
  const list = [...found.entries()].map(([n, c]) => candidate(c.keyword, [...c.sources], ad.get(n)));
  if (opts.network && opts.docs) await measureTopDocs(list, opts.docs);
  return list.sort((a, b) => b.score - a.score || (b.volume ?? 0) - (a.volume ?? 0));
}

/**
 * 검색량이 잡힌 롱테일 상위 max 개의 문서수(경쟁)를 잼. 후보 확인(AI)으로 거른 '뒤'에 불러야
 * 걸러질 후보에 측정 자리를 쓰지 않습니다 (먼저 재면 남은 좋은 후보가 '문서 미확인'으로 선택에서 밀림).
 */
export async function measureTopDocs(cands: LongtailCandidate[], max = 8): Promise<void> {
  const todo = cands
    .filter((c) => c.documentCount == null && c.volume != null && c.volume >= 10 && !isHeadKeyword(c.keyword))
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, max);
  for (const c of todo) await measureDocs(c);
  cands.sort((a, b) => b.score - a.score || (b.volume ?? 0) - (a.volume ?? 0));
}

/**
 * 키워드 선택: 검색량이 확인된 롱테일 중 최고점 → 없으면 헤드 키워드가 아닌 첫 제안 검색어 → 첫 제안 검색어.
 * 고른 키워드는 문서수까지 잽니다 (검색량이 없어도 경쟁 상황은 보이도록).
 */
export async function chooseKeyword(cands: LongtailCandidate[], phrases: string[], network: boolean): Promise<{ pick: LongtailCandidate; reason: "longtail" | "phrase" }> {
  const best = pickLongtail(cands);
  const byText = (p: string) => cands.find((c) => normalizeKeyword(c.keyword) === normalizeKeyword(p));
  const pick = best ?? byText(phrases.find((p) => !isHeadKeyword(p)) ?? phrases[0]) ?? candidate(phrases[0], ["ai"], undefined);
  if (network && pick.documentCount == null) await measureDocs(pick);
  return { pick, reason: best ? "longtail" : "phrase" };
}

export const KeywordCheckSchema = z.object({
  checks: z.array(
    z.object({
      groupId: z.number().int().describe("소재 번호 (입력의 [소재 #번호] 그대로)"),
      ok: z.array(z.string()).describe("이 사건 내용과 어긋나지 않는 후보 검색어를 글자 그대로 (반대 내용·다른 주제는 빼기)"),
    }),
  ),
});

/**
 * 측정한 후보 중 사건 내용과 어긋나지 않는 것만 (소재당 상위 max 개를 AI 가 확인, 한 번에).
 * '포함 관계'만으로는 '코스피 7000 회복' 사건에 '코스피 7000선 붕괴'(반대 내용)가 후보로 남기 때문.
 * 결과: groupId → 통과한 후보 키워드(정규화) 집합. AI 를 못 쓰면(수동·실패) 빈 맵 = 거르지 않음.
 */
export async function checkCandidates(
  topics: { id: number; summary: string; candidates: LongtailCandidate[] }[],
  log: (m: string) => unknown,
  max = 8,
): Promise<Map<number, Set<string>>> {
  const out = new Map<number, Set<string>>();
  const shown = topics.map((t) => ({ ...t, list: t.candidates.filter((c) => c.volume != null).slice(0, max) })).filter((t) => t.list.length);
  if (!shown.length || (await routeFor("light")) === "manual") return out;
  try {
    const { checks } = await generateJson({
      name: "channelKeywordCheck",
      task: "light",
      title: `실시간 소재 키워드 확인 (${shown.length}개)`,
      system: "당신은 네이버 검색 키워드를 검수하는 편집자입니다. 사건 요약과 어긋나는 검색어를 걸러냅니다.",
      prompt: `소재마다 후보 검색어 중 이 사건을 다루는 글의 핵심 키워드로 써도 되는 것만 골라 ok 에 글자 그대로 넣으세요.
- 빼야 하는 것: 사건과 반대 내용(회복 ↔ 붕괴, 기각 ↔ 인용 등), 사건과 다른 주제(같은 단어가 들어간 다른 상품·지역·사람), 사실 확인이 안 된 추측성 문구
- 남겨도 되는 것: 사건을 찾는 사람이 붙여 칠 만한 정보성 문구(전망, 일정, 확인 방법 등)

${shown.map((t) => `[소재 #${t.id}] ${t.summary}\n후보: ${t.list.map((c) => c.keyword).join(" | ")}`).join("\n\n")}`,
      schema: KeywordCheckSchema,
      effort: "low",
      maxTokens: 3000,
      mock: () => ({ checks: [] }),
    });
    for (const c of checks) out.set(c.groupId, new Set(c.ok.map(normalizeKeyword)));
    const removed = shown.reduce((a, t) => a + (out.has(t.id) ? t.list.filter((c) => !out.get(t.id)!.has(normalizeKeyword(c.keyword))).length : 0), 0);
    await log(`후보 키워드 확인(AI): 사건 내용과 어긋나는 후보 ${removed}개 제외`);
  } catch (e) {
    await log(`⚠️ 후보 키워드 확인(AI) 실패 — 거르지 않고 진행: ${(e as Error).message.split("\n")[0]}`);
  }
  return out;
}
