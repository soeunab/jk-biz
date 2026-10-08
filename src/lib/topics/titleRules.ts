import { normalizeKeyword, type AnswerType } from "./scoring";
import { naverSearchAdKeywords } from "./sources";

/*
 * 제목 규칙 — "발행 전 제목 체크리스트 4"(검색어가 들어갔나 · 내년에도 검색할까 · 누군가의 문제를 푸나 · 살 사람이 검색하는 말인가)를
 * 데이터로 판단합니다(2026-10-08 사용자 요청, 적용 전 검색광고로 검증).
 * 검증 결과: '2026근로장려금' 130,300(≈ 근로장려금 132,300) · '근로장려금2026' 120 · '클로드요금제2026' 10 · '청년미래적금2차' 166,200
 *  → 날짜를 일괄 금지하면 안 되고, 사람들이 실제로 그 형태(어순까지)로 검색할 때만 시간 표현을 넣습니다. 월·일·"기준"은 검색되지 않아 제목에서 뺍니다.
 */

/** 글 수명 — 상시형(날짜 없이) / 해마다 반복(연도+키워드, 해마다 연도 갱신) / 이슈형(회차·날짜 허용, 소모품) */
export type Lifespan = "evergreen" | "recurring" | "issue";
export const LIFESPAN_LABEL: Record<Lifespan, string> = { evergreen: "🌲 상시형", recurring: "🔁 해마다 반복", issue: "⚡ 이슈형(소모품)" };

export type TimeForm = { form: string; volume: number; kind: "year" | "event" };

const TIME_TOKEN = /(20\d\d)|(\d+차)|(\d분기)|(상반기|하반기)/;

/**
 * 키워드에 연도·회차·분기를 붙인 형태 중 실제로 검색되는 것 (검색광고 — 블로그 검색 API 월 한도와 별개).
 * 기본 키워드 검색량의 5% 이상이거나 월 1,000회 이상인 형태만. 어순은 검색되는 그대로("2026 근로장려금").
 */
export async function findTimeForms(keyword: string, now = new Date()): Promise<TimeForm[]> {
  const kw = keyword.trim();
  const ns = kw.replace(/\s+/g, "");
  const year = now.getFullYear();
  // 연도(앞·뒤)·회차 힌트 — 검색광고는 힌트와 관련 키워드를 함께 돌려주므로 실제로 검색되는 형태만 남음 (2회 호출)
  const ad = await naverSearchAdKeywords([ns, `${year}${ns}`, `${ns}${year}`, `${year + 1}${ns}`, `${ns}1차`, `${ns}2차`, `${ns}3차`]).catch(() => []);
  const base = ad.find((k) => normalizeKeyword(k.keyword) === normalizeKeyword(ns));
  const baseVol = base ? base.monthlyPc + base.monthlyMobile : 0;
  const out: TimeForm[] = [];
  const seen = new Set<string>();
  for (const k of ad) {
    const word = k.keyword.replace(/\s+/g, "");
    if (!word.includes(ns) || word === ns || seen.has(word)) continue;
    seen.add(word);
    const rest = word.replace(ns, "");
    const m = rest.match(TIME_TOKEN);
    if (!m || rest.replace(TIME_TOKEN, "").length > 0) continue; // 시간 표현만 붙은 형태 ("2026근로장려금", "청년미래적금2차")
    const volume = k.monthlyPc + k.monthlyMobile;
    if (volume < Math.max(1000, baseVol * 0.05) && volume < 5000) continue;
    const front = word.startsWith(rest);
    out.push({ form: front ? `${rest} ${kw}` : `${kw} ${rest}`, volume, kind: m[1] ? "year" : "event" });
  }
  return out.sort((a, b) => b.volume - a.volume);
}

/** 수명 판단 — 실시간 트렌드·한때 몰린 수요는 이슈형, 해마다 반복되는 수요·연도 붙여 검색되는 키워드는 반복, 나머지 상시형 */
export function lifespanOf(t: { origin?: string | null; seasonality?: string | null; timeForms?: TimeForm[] | null }): Lifespan {
  if (t.origin === "channels" || t.seasonality === "spike") return "issue";
  if (t.seasonality === "seasonal" || t.timeForms?.some((f) => f.kind === "year")) return "recurring";
  return "evergreen";
}

/** 원고·제목 AI 에게 줄 제목 규칙 */
export function titleRulesText(o: { keyword: string; lifespan: Lifespan; timeForms: TimeForm[]; secondaryKeyword?: string | null; today: string }): string {
  const fmt = (fs: TimeForm[]) => fs.map((f) => `"${f.form}"(월 ${f.volume.toLocaleString("ko-KR")})`).join(", ");
  const forms = fmt(o.timeForms);
  const years = fmt(o.timeForms.filter((f) => f.kind === "year"));
  const events = fmt(o.timeForms.filter((f) => f.kind === "event"));
  const time =
    o.lifespan === "issue"
      ? `이 글은 이슈형(며칠~몇 주 화제)이라 회차·기간 표현을 써도 됩니다${forms ? ` — 실제로 검색되는 형태: ${forms}` : ""}. 다만 월·일까지 박지는 마세요.`
      : o.lifespan === "recurring"
        ? `이 글은 해마다 반복되는 주제입니다. ${years ? `연도는 실제로 검색되는 형태 그대로만 쓰세요: ${years} (어순 그대로, 예: "2026 근로장려금"은 되고 "근로장려금 2026"은 검색이 거의 없음).` : "연도를 붙여 검색하는 사람이 거의 없으니 연도 없이 쓰세요."}${events ? ` 지금 회차로도 많이 검색합니다: ${events} — 글이 그 회차 내용이면 써도 되지만 회차가 지나면 낡는 소모품입니다.` : ""} 월·일·"○월 기준"은 쓰지 마세요.`
        : `이 글은 상시형(내년에도 검색됨)입니다. 연도·월·일·"기준"·"오늘"·회차 같은 시간 표현을 제목에 넣지 마세요(시점은 본문·메타 설명에만).${events ? ` (예외: 지금 ${events}로 많이 검색하니 글이 그 회차 내용일 때만)` : ""}`;
  return `[제목 규칙 — 발행 전 제목 체크리스트]
- 검색어: 핵심 키워드 "${o.keyword}"를 형태 변형 없이 맨 왼쪽에${o.lifespan !== "evergreen" && yearLead(o.keyword, o.timeForms) ? ` (연도를 넣을 때만 검색되는 형태 "${yearLead(o.keyword, o.timeForms)}" 그대로 맨 앞에)` : ""}.${o.secondaryKeyword ? ` 그 뒤에 보조 검색어 "${o.secondaryKeyword}"를 자연스러운 문장으로 넣으세요(이 계정 글을 다른 계정 글과 구별하는 말).` : ""}
- 유효기간: ${time}
- 남의 문제: 독자가 겪는 문제를 푸는 말(방법·확인·조건·차이·대처·비교 등)로. 일기·감성·사건 묘사 제목 금지.
- 살 사람의 말: 구매·선택 단계 질의면 후기·추천·비교·가격 표현을 우선.
- 독자층 단어(직장인·프리랜서·1인 가구 등)를 제목에 넣지 마세요 — 아무도 그 말로 검색하지 않습니다(관점은 본문에서).
- 핵심 키워드를 반복하는 괄호 "(…)"를 붙이지 마세요. 길이는 40자 안팎(네이버 상위 글 평균 36~49자, 길면 모바일에서 잘림).`;
}

const ns = (x: string) => x.replace(/\s+/g, "").toLowerCase();
const startsNs = (t: string, k: string) => ns(t).startsWith(ns(k));

/** 연도가 앞에 붙어 검색되는 형태 ("2026 근로장려금 신청") — 연도를 넣는 제목은 이 형태로 시작 */
export function yearLead(keyword: string, timeForms?: TimeForm[] | null): string | null {
  return timeForms?.find((f) => f.kind === "year" && /^20\d\d/.test(f.form) && ns(f.form).includes(ns(keyword)))?.form ?? null;
}

/**
 * 연도 어순 바로잡기 — 검색되는 형태가 "2026 근로장려금"(연도 앞)인데 제목이 "근로장려금 2026 …"이면 연도를 맨 앞으로.
 * 연도를 붙여 검색하는 형태가 없으면 그대로 둠(체크리스트가 ✖로 알림).
 */
export function fixYearOrder(title: string, keyword: string, timeForms?: TimeForm[] | null): string {
  const lead = yearLead(keyword, timeForms);
  const t = title.trim();
  if (!lead || startsNs(t, lead)) return t;
  const year = lead.match(/^20\d\d/)![0];
  if (!t.includes(year)) return t;
  const rest = t.replace(new RegExp(`\\s*${year}년?\\s*`), " ").replace(/\s{2,}/g, " ").trim();
  return startsNs(rest, keyword) ? `${year} ${rest}` : t;
}

export type TitleCheck = { id: string; label: string; pass: boolean | null; note: string };

const MONTH_DAY = /(\d{1,2}월(\s*\d{1,2}일)?)|(\d{1,2}\/\d{1,2})|(D-\d+)|(오늘|이번\s*주|어제)|(기준\))|(\d{1,2}일\s*(마감|까지))/;
const PERSONA = ["직장인", "프리랜서", "1인 가구", "1인가구", "자영업자", "주부", "대학생", "사회초년생"];
const PROBLEM = /(\?|할까|일까|될까|있을까|나요|방법|하는\s*법|확인|신청|조회|정리|차이|비교|기준|조건|대상|해결|대처|주의|체크|가이드|순서|절차|계산|받는\s*법|쓰는\s*법|사용법|추천|후기|가격|요금)/;
const BUYER = /(후기|추천|비교|가격|요금|가성비|구매|할인|최저가|순위|vs)/i;
const BUYER_TYPES: AnswerType[] = ["purchase", "comparison", "experience"];
const PROBLEM_TYPES: AnswerType[] = ["howto", "condition", "comparison", "experience", "purchase", "local_latest"];

/** 제목 체크리스트 4 + 보조 점검 (규칙, Claude 토큰 안 씀). pass=null 은 '해당 없음' */
export function titleChecks(
  title: string,
  o: { keyword: string; lifespan: Lifespan; timeForms?: TimeForm[] | null; answerType?: AnswerType | null; intent?: string | null; related?: string[] },
): TitleCheck[] {
  const t = title.trim();
  const lead = yearLead(o.keyword, o.timeForms);
  const kwStart = startsNs(t, o.keyword) || (!!lead && startsNs(t, lead));
  const years = [...t.matchAll(/20\d\d/g)].map((m) => m[0]);
  // 연도는 검색되는 형태(어순 포함) 그대로일 때만 — "2026 근로장려금"은 되고 "근로장려금 2026"은 안 됨
  const yearForms = (o.timeForms ?? []).filter((f) => f.kind === "year");
  const allowedYear = yearForms.some((f) => ns(t).includes(ns(f.form)));
  const eventWord = t.match(/(\d+차|\d분기|상반기|하반기)/)?.[0];
  // 검색되는 회차 형태("청년미래적금 2차")와 같은 회차면 허용
  const event = !!eventWord && !(o.timeForms ?? []).some((f) => f.kind === "event" && f.form.includes(eventWord));
  const monthDay = MONTH_DAY.test(t);
  const timeProblems = [
    monthDay ? "월·일·D-day·'기준' 같은 날짜가 있음" : "",
    years.length && !allowedYear && o.lifespan !== "issue"
      ? yearForms.length
        ? `연도 어순이 검색되는 형태와 다름 — "${yearForms[0].form}"처럼`
        : "연도를 붙여 검색하지 않는 키워드인데 연도가 있음"
      : "",
    event && o.lifespan !== "issue" ? "회차·분기 표현이 있음(이슈형이 아님)" : "",
  ].filter(Boolean);
  // 문제 해결·구매 표현은 키워드 자체가 아니라 제목이 덧붙인 말에서 찾음 ("클로드 요금제"의 '요금'은 세지 않음)
  const extra = t.replace(o.keyword, " ");
  // 키워드 자체가 구매 단계 말("…가격", "…요금제")이면 통과
  const buyerWord = BUYER.test(extra) || /(요금제|가격|후기|추천|비교|가성비|최저가|순위)/.test(o.keyword);
  const buyerRelevant = o.intent === "commercial" || o.intent === "transactional" || (o.answerType ? BUYER_TYPES.includes(o.answerType) : false);
  const persona = PERSONA.filter((p) => t.includes(p) && !o.keyword.includes(p) && !(o.related ?? []).some((r) => r.includes(p)));
  const paren = [...t.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).filter((inner) => inner.replace(/\s/g, "").includes(o.keyword.replace(/\s/g, "")));
  return [
    { id: "keyword", label: "사람들이 검색하는 말이 들어갔나", pass: kwStart, note: kwStart ? `"${o.keyword}"로 시작` : `"${o.keyword}"가 맨 앞에 없음` },
    {
      id: "lifespan",
      label: "내년에도 검색할까",
      pass: o.lifespan === "issue" ? (monthDay ? false : null) : timeProblems.length === 0,
      note: o.lifespan === "issue" ? `이슈형(소모품) — ${monthDay ? "월·일까지는 빼는 게 좋아요" : "회차·기간 표현 허용"}` : timeProblems.join(" · ") || "시간이 지나도 낡지 않음",
    },
    { id: "problem", label: "누군가의 문제를 푸나", pass: PROBLEM.test(extra) || (o.answerType ? PROBLEM_TYPES.includes(o.answerType) : false), note: PROBLEM.test(extra) ? "문제 해결 표현 있음" : o.answerType && PROBLEM_TYPES.includes(o.answerType) ? "질문 유형이 방법·조건·비교형" : "방법·확인·조건 같은 문제 해결 표현이 없음" },
    {
      id: "buyer",
      label: "살 사람이 검색하는 말인가",
      pass: buyerRelevant ? buyerWord : null,
      note: buyerRelevant ? (buyerWord ? "후기·추천·비교·가격 표현 있음" : "구매 단계 질의인데 후기·비교·가격 표현이 없음") : "구매 단계 질의가 아님(해당 없음)",
    },
    { id: "length", label: "길이 40자 안팎", pass: t.length <= 48, note: `${t.length}자` },
    { id: "persona", label: "독자층 단어 없음", pass: persona.length === 0, note: persona.length ? `${persona.join("·")} — 검색되지 않는 말` : "없음" },
    { id: "paren", label: "키워드 반복 괄호 없음", pass: paren.length === 0, note: paren.length ? `(${paren[0]})` : "없음" },
  ];
}

/** 키워드를 반복하는 괄호와 '(YYYY년 M월 기준)' 같은 날짜 괄호를 제목 끝에서 뺌 */
export function stripTitleNoise(title: string, keyword: string): string {
  const kw = keyword.replace(/\s/g, "");
  return title
    .replace(/\s*\(([^)]*)\)\s*$/g, (all, inner: string) => (inner.replace(/\s/g, "").includes(kw) || /^\s*20\d\d년\s*\d{1,2}월(\s*기준)?\s*$/.test(inner) || /^\s*\d{1,2}월\s*기준\s*$/.test(inner) ? "" : all))
    .trim();
}

/** 사용자가 고른(또는 제목 6가지에서 정해진) 제목인지 — 원고 AI 가 바꾸지 못하게 확정 */
export function isChosenTitle(title: string | null | undefined, sig: { titleOptions?: { title: string }[]; titleLocked?: boolean } | null | undefined): boolean {
  if (!title?.trim()) return false;
  return !!sig?.titleLocked || !!sig?.titleOptions?.some((o) => o.title === title);
}

/**
 * 계정마다 서로 다른 보조 검색어 — 같은 키워드를 여러 계정에 쓸 때 독자층 단어 대신 실제 검색어로 제목을 구별.
 * 핵심 키워드를 포함하고 남은 말이 있는 연관 검색어를 검색량 순으로, 이미 다른 원고·확정 제목에 쓴 말은 뺌.
 */
export function pickSecondaryKeywords(keyword: string, related: { keyword: string; volume: number | null }[], count: number, taken: string[] = []): (string | null)[] {
  const ns = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const kw = ns(keyword);
  const takenNs = taken.map(ns);
  const pool = related
    .filter((r) => ns(r.keyword).includes(kw) && ns(r.keyword) !== kw && !TIME_TOKEN.test(ns(r.keyword).replace(kw, "")))
    .filter((r) => !takenNs.some((t) => t.includes(ns(r.keyword).replace(kw, ""))))
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  return Array.from({ length: count }, (_, i) => pool[i]?.keyword ?? null);
}

/** 이슈형 글의 '오래 남는 짝 주제' — 회차·연도·분기를 뺀 키워드 (같으면 null) */
export function evergreenSibling(keyword: string): string | null {
  const s = keyword
    .replace(/20\d\d년?|\d+차|\d분기|상반기|하반기/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s && s !== keyword.trim() && s.length >= 2 ? s : null;
}

/** 원고에 기록하는 제목 전략 (Post.titlePlan) */
export type TitlePlan = {
  lifespan: Lifespan;
  timeForms: TimeForm[];
  locked: boolean;
  lockedTitle?: string | null;
  changeReason?: string | null;
  secondaryKeyword?: string | null;
  /** 제목에 연도·회차 같은 시간 표현이 들어갔는지 (유입 비교용) */
  timeInTitle?: boolean;
  failed?: string[];
  decidedAt?: string;
};
