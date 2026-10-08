import { clamp } from "../util";

/*
 * 주제 점수는 "무엇부터 쓸지" 정하는 내부 우선순위 지표입니다. 수익·트래픽 예측이 아닙니다.
 * 원칙: 확인되지 않은 지표는 지어내지 않고 null(미확인)로 둡니다. 총점은 확인된 지표만으로 계산하고,
 * 몇 개의 지표가 실제 데이터로 확인됐는지(confidence)를 함께 돌려줍니다.
 */

/** 상업적 의도(구매·비교·가격)가 담긴 키워드는 광고 단가와 제휴 전환이 높습니다. */
const COMMERCIAL_TERMS = [
  "추천", "비교", "가격", "요금", "요금제", "유료", "구독", "할인", "후기", "리뷰", "순위", "top", "best",
  "구매", "노트북", "태블릿", "키보드", "마이크", "웹캠", "모니터", "앱", "프로그램", "강의", "책", "무료체험",
];
export type KeywordMetrics = {
  keyword: string;
  monthlySearch?: number | null;
  documentCount?: number | null;
  compIdx?: string | null;
  adDepth?: number | null;
  /** 네이버 검색광고 월평균 광고 클릭수(PC+모바일) — 광고주가 실제로 돈을 쓰는 수요 */
  monthlyClicks?: number | null;
  momentum?: number | null;
  /** AI 가 판정한 질문 유형 — AI 브리핑·AI 개요가 대신 답하기 쉬운지(AI 내성) */
  answerType?: AnswerType | null;
  sources: string[];
};

/**
 * 질문 유형 — 플레이북의 'AI 내성' 필터. 정의·요약형은 AI 브리핑이 답하고 끝나 클릭이 남지 않고,
 * 경험·비교·조건 해석·구매 직전 질의는 AI 가 대신하기 어려워 블로그 클릭이 남습니다.
 */
export const ANSWER_TYPES = ["definition", "news", "howto", "local_latest", "condition", "comparison", "experience", "purchase"] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export const ANSWER_TYPE_LABEL: Record<AnswerType, string> = {
  definition: "정의·요약형",
  news: "소식형",
  howto: "방법형",
  local_latest: "지역·최신형",
  condition: "조건 해석형",
  comparison: "비교·선택형",
  experience: "경험·후기형",
  purchase: "구매 직전형",
};

/** AI 내성 0~100 — 높을수록 AI 요약에 클릭을 덜 빼앗김 (플레이북 3번 필터 기준의 상대 순서) */
export const AI_RESISTANCE: Record<AnswerType, number> = {
  definition: 20,
  news: 40,
  howto: 45,
  local_latest: 70,
  purchase: 75,
  condition: 80,
  comparison: 80,
  experience: 85,
};

/**
 * 광고 단가 등급 — 한국어 애드센스 RPM 2차 자료 추정(일반 $1~3, IT $2~5, 금융·보험·재테크 $5~15) 기준의 상대 등급.
 * 정확한 CPC 가 아니라 "같은 트래픽이면 어느 주제가 더 버는가"의 순서만 반영합니다.
 */
const HIGH_VALUE_RE = /(보험|대출|금리|카드|적금|예금|연금|세금|절세|연말정산|종합소득세|부가세|환급|부동산|아파트|청약|전세|월세|투자|주식|etf|코인|재테크|변호사|법률|소송|이혼|상속|증여|병원|치료|수술|임플란트|교정|보험금|지원금|장려금|수당)/;
const MID_VALUE_RE = /(노트북|태블릿|모니터|키보드|스마트폰|아이폰|갤럭시|가전|에어컨|냉장고|세탁기|소프트웨어|프로그램|구독|요금제|강의|자격증|학원|여행|항공|호텔|숙소|창업|부업|이직|취업)/;

export function valueTier(keyword: string): "high" | "mid" | "base" {
  const k = keyword.toLowerCase().replace(/\s/g, "");
  if (HIGH_VALUE_RE.test(k)) return "high";
  if (MID_VALUE_RE.test(k)) return "mid";
  return "base";
}

/**
 * 키워드 검증 수준
 * - VERIFIED: 네이버 검색광고·데이터랩 등 공식 데이터로 검색 수요 확인
 * - SUGGESTED: 네이버·구글 자동완성에 실제로 노출됨 (존재는 확인, 검색량은 미확인)
 * - UNVERIFIED: 시드 조합·직접 입력 등 실제 검색 여부를 확인하지 못함
 */
export type Verification = "VERIFIED" | "SUGGESTED" | "UNVERIFIED";

export type Intent = "informational" | "commercial" | "transactional" | "navigational";

export const INTENT_LABEL: Record<Intent, string> = {
  informational: "정보탐색형",
  navigational: "탐색형",
  commercial: "상업조사형",
  transactional: "구매의도형",
};

export type Scores = {
  /** null = 미확인 (데이터 없음) */
  volumeScore: number | null;
  competitionScore: number | null;
  trendScore: number | null;
  /** 광고경쟁도가 있으면 데이터 기반, 없으면 검색의도 규칙 기반 */
  monetizationScore: number;
  monetizationBasis: "ad-data" | "intent-rule";
  /** AI 내성 0~100, null = 질문 유형 미판정 */
  aiResistance: number | null;
  answerType: AnswerType | null;
  /** 우선순위 정렬용 0~100 (예측 아님) */
  total: number;
  /** 실제 데이터로 확인된 지표 수 (검색량·경쟁·트렌드 중 0~3) */
  confidence: number;
  verification: Verification;
  intent: Intent;
  targetPlatform: "NAVER" | "BLOGGER" | "BOTH";
};

export function normalizeKeyword(k: string): string {
  return k.toLowerCase().replace(/[\s\p{P}]/gu, "");
}

export function detectIntent(keyword: string): Intent {
  const k = keyword.toLowerCase();
  if (/(구매|최저가|할인|쿠폰|결제|주문)/.test(k)) return "transactional";
  if (COMMERCIAL_TERMS.some((t) => k.includes(t))) return "commercial";
  if (/(로그인|홈페이지|공식|다운로드|사이트)$/.test(k)) return "navigational";
  return "informational";
}

/** 검색량 점수: 월 1천~3만 구간을 가장 높게 (너무 크면 상위 노출이 어렵고, 너무 작으면 유입이 적음) */
export function volumeScore(v: number | null | undefined): number | null {
  if (v == null) return null;
  if (v <= 0) return 0;
  const log = Math.log10(v);
  if (log < 2) return log * 15; // ~100 미만
  if (log <= 4.5) return 30 + ((log - 2) / 2.5) * 70; // 100 ~ 31,600
  return clamp(100 - (log - 4.5) * 40, 50, 100); // 대형 키워드는 경쟁 부담
}

/**
 * 경쟁 점수: 문서 수 / 검색량 (포화 지수) 이 낮을수록 좋습니다. 둘 중 하나라도 모르면 미확인.
 * 검색량이 너무 작으면(월 50 미만) 분모가 작아 문서수 오차 하나에도 비율이 크게 흔들리고,
 * 특히 막 뜬 실시간 이슈는 검색광고 월검색량이 아직 최근 화제를 반영 못 해(집계 지연) 문서수만
 * 앞서가는 경우가 흔해 실제로는 좋은 소재인데도 경쟁이 매우 나쁜 것처럼(0점) 잘못 계산됩니다.
 * 이런 경우 억지로 나쁜 점수를 매기지 않고 미확인(null)으로 둡니다.
 */
export function competitionScore(docs: number | null | undefined, volume: number | null | undefined): number | null {
  if (docs == null || volume == null || volume < 50) return null;
  const saturation = docs / volume;
  // 0.1 이하 매우 좋음(100) … 50 이상 매우 나쁨(0)
  return clamp(100 - Math.log10(saturation / 0.1 + 1) * 37, 0, 100);
}

/**
 * 수익성(0~100) — 광고주 경쟁(compIdx·노출 광고 수) + 실제 광고 클릭 수요(월 광고클릭수) + 주제 단가 등급 + 구매 의도 + 제휴 상품.
 * 우선순위용 상대 점수이며 수익 예측이 아닙니다.
 */
export function monetizationScore(m: KeywordMetrics, affiliateTags: string[] = []): number {
  const k = m.keyword.toLowerCase();
  let s = 15;
  if (m.compIdx === "높음") s += 25;
  else if (m.compIdx === "중간") s += 15;
  else if (m.compIdx === "낮음") s += 5;
  if (m.adDepth) s += clamp(m.adDepth, 0, 10);
  // 월 광고클릭수: 10회 → 8, 100회 → 16, 1,000회 이상 → 20
  if (m.monthlyClicks != null && m.monthlyClicks > 0) s += clamp(Math.log10(m.monthlyClicks + 1) * 8, 0, 20);
  const tier = valueTier(m.keyword);
  if (tier === "high") s += 20;
  else if (tier === "mid") s += 10;
  const intent = detectIntent(m.keyword);
  if (intent === "commercial") s += 15;
  if (intent === "transactional") s += 20;
  if (affiliateTags.some((t) => t && k.includes(t.toLowerCase()))) s += 10;
  return clamp(s, 0, 100);
}

/** AI 내성 점수 — 질문 유형을 모르면 null (지어내지 않음) */
export function aiResistanceScore(t: AnswerType | null | undefined): number | null {
  return t ? AI_RESISTANCE[t] : null;
}

export function trendScore(momentum: number | null | undefined): number | null {
  if (momentum == null) return null;
  // 1.0 = 보합(50점), 2.0 이상 = 급상승(100점), 0.5 이하 = 하락(0점)
  return clamp(50 + Math.log2(momentum) * 50, 0, 100);
}

export function verificationOf(m: KeywordMetrics): Verification {
  if (m.monthlySearch != null || m.momentum != null) return "VERIFIED";
  if (m.sources.some((s) => s.endsWith("-ac") || s === "google-trends" || s === "naver-searchad" || s === "naver-related")) return "SUGGESTED";
  return "UNVERIFIED";
}

/** 확인된 항목만으로 가중 평균 (가중치 재정규화) */
function weighted(parts: [number | null, number][]): number {
  const known = parts.filter(([v]) => v != null) as [number, number][];
  const w = known.reduce((a, [, wt]) => a + wt, 0);
  return w ? known.reduce((a, [v, wt]) => a + v * wt, 0) / w : 0;
}

/**
 * 우선순위 점수 — 검색량·경쟁(문서수÷검색량)·수익성·트렌드를 플랫폼별 가중치로 합친 뒤 AI 내성 배율만 곱합니다.
 * (예전에는 'AI 도구 관련어' 관련성 배율이 있었지만 계정 주제가 다양해져 2026-09-29 꺼졌고, 모든 키워드에 일률적으로
 *  ×0.52 가 곱해져 점수만 낮아 보이던 것을 2026-10-07 제거 — 순서는 같고 0~100 범위로 보임)
 */
export function scoreKeyword(m: KeywordMetrics, affiliateTags: string[] = []): Scores {
  const vs = volumeScore(m.monthlySearch);
  const cs = competitionScore(m.documentCount, m.monthlySearch);
  const ms = monetizationScore(m, affiliateTags);
  const ts = trendScore(m.momentum);
  const ai = aiResistanceScore(m.answerType);
  const intent = detectIntent(m.keyword);
  const confidence = [vs, cs, ts].filter((x) => x != null).length;

  // 네이버: 검색량·경쟁(상위노출 가능성) 중심 / 구글: 수익성(CPC)·에버그린 정보성 중심
  const naver = weighted([[vs, 0.3], [cs, 0.3], [ms, 0.2], [ts, 0.2]]);
  const google = weighted([[vs, 0.25], [cs, 0.15], [ms, 0.4], [ts, 0.2]]);
  const base = Math.max(naver, google);
  // AI 내성: 판정됐으면 0.8(정의형 20점 → 0.88)~1.2(경험형 85점 → 1.14)배, 모르면 그대로
  const aiFactor = ai == null ? 1 : 0.8 + (ai / 100) * 0.4;
  const total = Math.round(clamp(base * aiFactor, 0, 100));
  // 확인된 지표가 없으면 플랫폼을 가를 근거도 없음
  const targetPlatform = confidence === 0 || Math.abs(naver - google) < 5 ? "BOTH" : naver > google ? "NAVER" : "BLOGGER";
  const r = (x: number | null) => (x == null ? null : Math.round(x));

  return {
    volumeScore: r(vs),
    competitionScore: r(cs),
    trendScore: r(ts),
    monetizationScore: Math.round(ms),
    monetizationBasis: m.compIdx ? "ad-data" : "intent-rule",
    aiResistance: ai,
    answerType: m.answerType ?? null,
    total,
    confidence,
    verification: verificationOf(m),
    intent,
    targetPlatform,
  };
}
