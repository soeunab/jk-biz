/**
 * 메인 키워드(씨드) → 롱테일 확장에 쓰는 도구들 (검색어 기반 발굴 topics/discover.ts 가 사용).
 *
 * 원리 (사용자 운영 방식):
 *  - 키워드를 줄일수록 연관 검색어가 많아짐: '신한은행 유출'은 검색광고 연관어가 거의 없지만 '신한은행'으로 줄이면
 *    '신한은행 해킹·정보유출·개인정보' 같은 연관어가 나옴 → 줄인 키워드로도 자동완성·"함께 많이 찾는"을 모음.
 *    줄인 키워드에서 온 후보는 '신한은행 영업시간'처럼 다른 주제가 섞이므로 AI 가 같은 주제인지 확인.
 *  - 비율 = 문서수 ÷ 월검색량 (키워드마스터 등과 같은 계산) — 0.xx 처럼 낮을수록 경쟁이 덜해 상위 노출에 유리.
 *  - 제목은 메인 키워드를 맨 왼쪽에 두고 연관 검색어를 붙여 6가지 유형으로 (궁금증·행동·정보·주의·비교·조합).
 *  - 네이버에서 그 키워드로 상위 노출된 블로그 글 제목과 AI 브리핑을 제목 형태 벤치마킹 자료로.
 */
import { z } from "zod";
import { withPage } from "../browser";
import { generateJson, routeFor } from "../llm";
import { ANSWER_TYPES, normalizeKeyword, type AnswerType } from "./scoring";

/** '신한은행 개인정보 유출' → ['신한은행 개인정보 유출', '신한은행 개인정보', '신한은행'] (앞 단어부터 남기며 줄임) */
export function shorteningLadder(seed: string): string[] {
  const words = seed.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let n = words.length; n >= 1; n--) {
    const rung = words.slice(0, n).join(" ");
    if (normalizeKeyword(rung).length >= 2 && !out.includes(rung)) out.push(rung);
  }
  return out;
}

/**
 * 메인 키워드(시드)의 기준어 — 시드 전체 + 줄였을 때 2단어 이상 남는 핵심 ('ai 해킹 공격' → ['ai 해킹 공격', 'ai 해킹']).
 * 롱테일은 메인 키워드에 말을 붙여 구체화한 것이므로 이 중 하나를 반드시 포함해야 합니다.
 * 한 단어까지 줄인 말('ai', '서울')은 너무 넓어 연관어 수집에만 씁니다.
 */
export function anchorsOf(seed: string): string[] {
  return shorteningLadder(seed).filter((r, i) => i === 0 || r.split(/\s+/).length >= 2);
}

/** 시드가 정확히 두 단어일 때의 한 단어 줄임말('신한은행 유출' → '신한은행') — 이것만 포함한 후보는 롱테일이 아니고, 같은 주제면 원고 연관어로 */
export function looseAnchorOf(seed: string): string | null {
  const words = seed.trim().split(/\s+/).filter(Boolean);
  return words.length === 2 && normalizeKeyword(words[0]).length >= 2 ? words[0] : null;
}

/** 후보가 어느 메인 키워드에서 뻗어 나왔는지 — strict(롱테일 자격): 시드 전체나 2단어 핵심 포함 / loose(연관어만): 두 단어 시드의 한 단어 줄임말만 포함 */
export function mainKeywordOf(keyword: string, seeds: string[]): { seed: string; strict: boolean } | null {
  const n = normalizeKeyword(keyword);
  for (const s of seeds) if (anchorsOf(s).some((a) => n.includes(normalizeKeyword(a)))) return { seed: s, strict: true };
  for (const s of seeds) {
    const loose = looseAnchorOf(s);
    if (loose && n.includes(normalizeKeyword(loose))) return { seed: s, strict: false };
  }
  return null;
}

/** 롱테일 키워드로 저장할 최소 월검색량 — 이보다 적으면 글을 써도 들어올 사람이 거의 없음 */
export const MIN_MONTHLY_SEARCH = 30;

/** 네이버 검색광고는 10 미만을 "< 10"으로만 줌(PC·모바일 각 5로 환산) → 합계 10 이하는 실제 값이 아닌 바닥값 */
export function isFloorVolume(volume: number | null | undefined): boolean {
  return volume != null && volume <= 10;
}

/** 문서수 ÷ 월검색량. 둘 중 하나라도 없거나 검색량이 바닥값("< 10")이면 null (바닥값으로 나누면 의미 없는 큰 수가 나옴) */
export function docRatio(documentCount: number | null | undefined, volume: number | null | undefined): number | null {
  if (documentCount == null || !volume || isFloorVolume(volume)) return null;
  return documentCount / volume;
}

/** 0.123 → '0.12', 3.4 → '3.4', 52.1 → '52' */
export function fmtRatio(r: number | null | undefined): string {
  if (r == null) return "미확인";
  if (r < 1) return r.toFixed(2);
  if (r < 10) return r.toFixed(1);
  return String(Math.round(r));
}

export const TITLE_TYPES = ["궁금증형", "행동형", "정보형", "주의형", "비교형", "조합형"] as const;
export type TitleType = (typeof TITLE_TYPES)[number];

/** 유형별 쓰는 법 — 예시는 형태 참고용 (다른 주제의 실제 예) */
export const TITLE_TYPE_GUIDE: Record<TitleType, string> = {
  궁금증형: "독자가 가장 궁금해할 질문으로 끝맺기 — 예: 신한은행 고객정보 유출, 내 정보도 포함됐을까?",
  행동형: "지금 바로 할 행동을 짧게 — 예: 신한은행 개인정보 유출 확인방법, 바로 조회",
  정보형: "무엇을 정리했는지 순서·범위로 — 예: 신한은행 고객정보 유출, 확인 방법과 대처 순서",
  주의형: "하기 전에 확인할 점·주의 — 예: 신한은행 유출 조회, 문자 링크 누르기 전 확인할 점",
  비교형: "두 가지를 나란히 — 예: 신한은행 유출 확인, 문자 링크와 공식 채널의 차이",
  조합형: "연관 검색어를 이어 붙이고 괄호로 보충 — 예: 신한은행 유출 조회 확인 방법 (+ 문자 링크&공식 사이트)",
};

/** 제목이 키워드로 시작하는지 (띄어쓰기·문장부호 무시) */
export function startsWithKeyword(title: string, keyword: string): boolean {
  return normalizeKeyword(title).startsWith(normalizeKeyword(keyword));
}

/** 키워드가 맨 왼쪽에 오도록 고침 — 제목 안에 키워드가 있으면 그 자리에서 빼서 앞으로, 없으면 앞에 붙임 */
export function keywordFirst(title: string, keyword: string): string {
  const t = title.trim();
  if (startsWithKeyword(t, keyword)) return t;
  const idx = t.indexOf(keyword);
  const rest = (idx >= 0 ? t.slice(0, idx) + t.slice(idx + keyword.length) : t).replace(/\s{2,}/g, " ").replace(/^[\s,·:|\-–]+|[\s,·:|\-–]+$/g, "").trim();
  return rest ? `${keyword} ${rest}` : keyword;
}

// ---------------------------------------------------------------- 줄인 키워드에서 온 후보 확인 (AI)
export const RelatedCheckSchema = z.object({
  ok: z.array(z.string()).describe("메인 키워드와 같은 주제의 검색어를 글자 그대로 (다른 주제·단순 대상 이름·커뮤니티/사이트 이름 검색은 빼기)"),
  types: z
    .array(z.object({ keyword: z.string(), type: z.enum(ANSWER_TYPES) }))
    .default([])
    .describe("ok 에 넣은 검색어 각각의 질문 유형"),
});

/**
 * 모은 후보 중 메인 키워드와 같은 주제이고 블로그 글로 답할 수 있는 검색어만 (가벼운 작업 1회).
 * 결과는 통과한 후보의 정규화 키워드 집합. AI 를 못 쓰면(수동 모드·실패) null — 호출하는 쪽에서 보수적으로 처리.
 */
export async function filterSameTopic(
  main: string,
  context: string | undefined,
  candidates: string[],
  log: (m: string) => unknown,
): Promise<(Set<string> & { types?: Map<string, AnswerType> }) | null> {
  if (!candidates.length) return new Set();
  if ((await routeFor("light")) === "manual") return null;
  try {
    const { ok, types } = await generateJson({
      name: "relatedCheck",
      task: "light",
      title: `연관 검색어 주제 확인 (${main})`,
      system: "당신은 네이버 검색어를 분류하는 블로그 편집자입니다. 같은 주제를 찾는 사람의 검색어인지만 판단합니다.",
      prompt: `메인 키워드: ${main}${context ? `\n지금 이 키워드가 화제인 이유: ${context}` : ""}

아래는 메인 키워드로 모은 연관 검색어입니다. 메인 키워드를 찾는 사람이 함께 궁금해할 같은 주제이고, 블로그 글 한 편으로 답할 수 있는 검색어만 골라 ok 에 글자 그대로 넣으세요.
- 빼야 하는 것: 같은 대상의 다른 주제(예: 메인이 '신한은행 유출'이면 '신한은행 영업시간', '신한은행 대출금리'), 다른 대상, 관련 없는 상품·지역·사람
- 빼야 하는 것: 커뮤니티·사이트·앱 이름을 붙인 검색어(예: '○○ 더쿠', '○○ 디시', '○○ 나무위키', '○○ 유튜브') — 그 사이트의 글을 찾는 검색이라 블로그 글로 답할 수 없음
- 빼야 하는 것: 상위 분야의 다른 주제(예: 메인이 'ai 해킹 공격'이면 'AI 보안 솔루션', 'AI 보안 인증' — 제품·제도 이야기라 해킹 공격 글이 아님)
- 남길 것: 같은 일을 다른 말로 찾거나 더 구체적으로 묻는 검색어(예: '신한은행 해킹', '신한은행 정보유출', '신한은행 개인정보 유출 확인', 'ai 해킹 공격'의 '인공지능 해킹')

그리고 ok 에 넣은 검색어마다 types 에 질문 유형을 하나 고르세요 (AI 검색 요약이 대신 답하기 쉬운지 판단용):
definition(뜻·개념·요약이면 끝) / news(사건·발표 소식) / howto(방법·절차) / local_latest(특정 지역·최신 현황) /
condition(내가 대상인지·기준 해석) / comparison(비교·선택) / experience(후기·경험담) / purchase(가격·구매처·할인 등 구매 직전)

후보: ${candidates.join(" | ")}`,
      schema: RelatedCheckSchema,
      effort: "low",
      maxTokens: 2000,
      mock: () => ({ ok: candidates, types: [] }),
    });
    const set: Set<string> & { types?: Map<string, AnswerType> } = new Set(ok.map(normalizeKeyword));
    set.types = new Map((types ?? []).map((t) => [normalizeKeyword(t.keyword), t.type]));
    await log(`연관 검색어 ${candidates.length}개 중 같은 주제 ${[...set].filter((k) => candidates.some((c) => normalizeKeyword(c) === k)).length}개 (AI 확인)`);
    return set;
  } catch (e) {
    await log(`⚠️ 연관 검색어 주제 확인(AI) 실패 — 메인 키워드를 그대로 포함한 후보만 사용: ${(e as Error).message.split("\n")[0]}`);
    return null;
  }
}

// ---------------------------------------------------------------- 제목 6가지 유형 (고른 키워드 하나만, 필요할 때)
export const TitleSchema = z.object({
  titles: z
    .array(z.object({ type: z.enum(TITLE_TYPES), title: z.string().describe("keyword 를 형태 변형 없이 맨 왼쪽에 둔 제목, 25~40자") }))
    .min(3)
    .max(6)
    .describe("유형별 제목 — 궁금증형·행동형·정보형·주의형·비교형·조합형 각 1개"),
  bestType: z.enum(TITLE_TYPES).describe("이 키워드의 검색 의도에 가장 맞는 제목 유형 (기본 제목으로 씀)"),
  angle: z.string().describe("차별화 관점·구성 한 줄"),
});

/** 제목 숫자 규칙 — 숫자는 클릭률을 돕는 보조 수단일 뿐 순위 요인이 아니고, 지어낸 숫자는 원고 사실 검수와 충돌 */
export const TITLE_NUMBER_RULE =
  "숫자는 키워드·연관 검색어·벤치마킹 제목·AI 브리핑에 실제로 나온 사실(통계·기간·회차·연도 등)만 쓰세요. 근거 없는 수치나 본문 구성과 맞지 않을 수 있는 개수(예: 'TOP 7', '5가지')를 지어내지 마세요. 숫자가 없어도 됩니다.";

// ---------------------------------------------------------------- 네이버 상위 노출 벤치마킹
export type SerpBenchmark = { keyword: string; titles: string[]; aiBriefing: string | null };

// page.evaluate 에 넘길 스크립트는 문자열로 (tsx 가 함수에 붙이는 __name 이 브라우저에 없어 깨짐)
const BLOG_TITLES_JS = `(() => {
  const clean = (t) => (t || "").replace(/새 창 열림/g, "").replace(/\\s+/g, " ").trim();
  const pick = [...document.querySelectorAll('a[href*="blog.naver.com"][data-heatmap-target=".nblg"]')].map((a) => clean(a.textContent));
  const any = pick.length ? pick : [...document.querySelectorAll('a[href*="blog.naver.com"]')]
    .filter((a) => a.getAttribute("data-heatmap-target") !== "articleSourceJSX_title").map((a) => clean(a.textContent));
  return [...new Set(any.filter((t) => t.length >= 8 && t.length <= 80))];
})()`;

const AI_BRIEFING_JS = `(() => {
  const head = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.textContent || "").trim() === "AI 브리핑");
  if (!head) return null;
  let box = head;
  for (let i = 0; i < 8 && box; i++) { if ((box.innerText || "").length > 300) break; box = box.parentElement; }
  if (!box) return null;
  let t = (box.innerText || "").replace(/^AI 브리핑\\s*/, "");
  for (const cut of ["출처 ", "AI 답변으로"]) { const i = t.indexOf(cut); if (i > 0) t = t.slice(0, i); }
  return t.replace(/\\n+/g, " ").replace(/\\s+/g, " ").trim().slice(0, 600) || null;
})()`;

/**
 * 네이버에서 키워드로 검색했을 때 블로그 탭 상위 글 제목과 통합검색 AI 브리핑 (화면 스크래핑 — 실패하면 빈 값).
 * 제목은 형태 참고용이며 그대로 베끼지 않습니다.
 */
export async function naverSerpBenchmark(keyword: string, max = 10): Promise<SerpBenchmark> {
  const empty: SerpBenchmark = { keyword, titles: [], aiBriefing: null };
  return withPage(
    async (page) => {
      const q = encodeURIComponent(keyword);
      await page.goto(`https://search.naver.com/search.naver?ssc=tab.blog.all&query=${q}`, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(1800);
      const titles = ((await page.evaluate(BLOG_TITLES_JS).catch(() => [])) as string[]).slice(0, max);
      await page.goto(`https://search.naver.com/search.naver?query=${q}`, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(2500);
      const aiBriefing = (await page.evaluate(AI_BRIEFING_JS).catch(() => null)) as string | null;
      return { keyword, titles, aiBriefing };
    },
    { width: 1280, height: 1800 },
  ).catch(() => empty);
}
