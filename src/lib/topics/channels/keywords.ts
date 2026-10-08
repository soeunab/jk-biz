/**
 * 실시간 소재 → 메인 키워드(씨드): "AI 가 사건을 해석하고, 데이터로 확인한다".
 *
 * 실시간 발굴은 지금(6시간 이내) 화제인 사건의 메인 키워드만 찾습니다(예: '신한은행 유출').
 * 사용자는 그중 골라 바로 원고를 생성합니다. (직접 입력한 키워드로 롱테일·제목을 만드는 건 검색어 기반 발굴 topics/discover.ts)
 *  1) 해석(AI, 가벼운 작업 1회): 소재마다 무슨 일인지 한 줄 + 메인 키워드 1개 + 대안 검색어.
 *     기사 없는 키워드형 소재는 수집 풀에서 같은 단어가 나온 기사를 맥락으로 붙여 줍니다. 그래도 무슨 일인지 모르면 추천하지 않음.
 *  2) 확인(데이터): 메인 키워드·대안의 네이버 월검색량 → 검색량이 잡힌 것 중 AI 메인 키워드 우선 → 문서수.
 *     기사 제목을 글자 조각으로 잘라 규칙으로 고르던 방식은 동음이의·나열형 제목에서 계속 엉뚱한 키워드를 내서 쓰지 않습니다.
 */
import { z } from "zod";
import { generateJson, routeFor } from "../../llm";
import { naverBlogDocCount } from "../sources";
import { competitionScore, normalizeKeyword } from "../scoring";
import { adVolumes, isHeadKeyword, longtailScore, volumeOf, type LongtailCandidate } from "../longtail";
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
      mainKeyword: z.string().describe("메인 키워드 1개 — 이 일을 가장 많은 사람이 네이버에 칠 핵심 검색어. 대상+사건 2~3단어 (예: '신한은행 유출'). 대상 이름 하나만은 안 됨"),
      phrases: z.array(z.string()).max(5).describe("메인 키워드 대신 쓸 수 있는 다른 표현의 검색어 2~5개 (2~3단어, 예: '신한은행 해킹', '신한은행 정보유출')"),
      sameAs: z.number().int().nullable().describe("앞 번호 소재와 같은 사건이면 그 소재 번호, 아니면 null"),
    }),
  ),
});
export type Story = { hasStory: boolean; summary: string; main: string; phrases: string[]; by: "ai" | "fallback"; sameAs?: number | null };

const cleanPhrase = (p: string) => p.replace(/["“”'‘’]/g, "").replace(/\s+/g, " ").trim();

/** AI 없이(수동 모드·데모·AI 실패) 쓰는 해석: 기사가 있으면 대표어를 메인 키워드로 */
export function fallbackStory(g: Group, context: ChannelItem[]): Story {
  return { hasStory: articlesOf(g).length > 0 || context.length > 0, summary: g.label, main: groupBase(g), phrases: [], by: "fallback" };
}

/** 소재들을 한 번에 해석 (가벼운 작업) */
export async function interpretStories(groups: Group[], context: Map<number, ChannelItem[]>, log: (m: string) => unknown): Promise<Map<number, Story>> {
  const out = new Map<number, Story>(groups.map((g) => [g.id, fallbackStory(g, context.get(g.id) ?? [])]));
  if (!groups.length) return out;
  if ((await routeFor("light")) === "manual") {
    await log("수동 모드라 소재 해석(AI)은 건너뛰고 대표어를 메인 키워드로 씁니다");
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
      prompt: `소재마다 (1) 무슨 일인지 한 줄로 요약하고 (2) 이 일을 찾는 사람이 네이버 검색창에 칠 메인 키워드 1개와 (3) 다른 표현의 검색어 2~5개를 주세요.
- 메인 키워드는 "대상 + 사건" 2~3단어의 실제 검색 문구입니다 (예: "신한은행 유출", "코스피 7000", "제미나이 4 출시"). 대상 이름 하나만("신한은행")은 너무 넓어 안 됩니다. 기사 제목 문장을 그대로 옮기지 마세요.
- 이 사건과 직접 관련된 말만 쓰세요. 제목에 우연히 같이 나온 단어(나열된 회사명, 동음이의어)로 다른 주제를 만들지 마세요.
- 기사들이 여러 일을 다루면 가장 많이 다뤄진 하나의 일로 요약하고, 키워드도 그 일에 맞추세요 ("다양한 이슈" 같은 요약 금지).
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
      const main = cleanPhrase(s.mainKeyword);
      const phrases = [...new Set(s.phrases.map(cleanPhrase).filter((p) => p.length >= 2 && p.length <= 30 && normalizeKeyword(p) !== normalizeKeyword(main)))];
      const sameAs = s.sameAs != null && s.sameAs !== s.groupId && out.has(s.sameAs) ? s.sameAs : null;
      const ok = main.length >= 2 && main.length <= 30;
      out.set(s.groupId, { hasStory: s.hasStory && (ok || phrases.length > 0), summary: s.summary.trim(), main: ok ? main : phrases[0] ?? "", phrases, by: "ai", sameAs });
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
export async function measureDocs(c: LongtailCandidate): Promise<void> {
  c.documentCount = await naverBlogDocCount(c.keyword).catch(() => null);
  c.competitionScore = competitionScore(c.documentCount, c.volume);
  c.score = longtailScore(c.volume, c.competitionScore);
}

/**
 * 메인 키워드 확정: AI 메인 키워드와 대안 검색어의 네이버 월검색량을 재서
 *  - AI 메인 키워드에 검색량(월 10회 이상)이 잡히면 그대로
 *  - 아니면 검색량이 잡힌 대안 중 가장 큰 것 (대상 이름 하나뿐인 헤드 키워드는 제외 — '신한은행'은 시드로 너무 넓음)
 *  - 둘 다 없으면 AI 메인 키워드 그대로 (막 터진 이슈라 아직 검색량 데이터가 없음 = measured false)
 * 고른 메인 키워드는 문서수까지 잽니다.
 */
export async function chooseMain(story: Story, network: boolean): Promise<{ main: LongtailCandidate; alternates: LongtailCandidate[]; measured: boolean }> {
  const words = [story.main, ...story.phrases].filter(Boolean);
  const ad = network ? await adVolumes(words).catch(() => new Map<string, AdKeyword>()) : new Map<string, AdKeyword>();
  const list = words.map((w, i) => candidate(w, [i === 0 ? "ai-main" : "ai-alt"], ad.get(normalizeKeyword(w))));
  const ok = (c: LongtailCandidate) => c.volume != null && c.volume >= 10;
  const main =
    (ok(list[0]) ? list[0] : undefined) ??
    list.slice(1).filter((c) => ok(c) && !isHeadKeyword(c.keyword)).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0] ??
    list[0];
  if (network) await measureDocs(main);
  return { main, alternates: list.filter((c) => c !== main), measured: ok(main) };
}
