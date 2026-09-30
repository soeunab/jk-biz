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
const HOWTO_TERMS = ["사용법", "방법", "하는법", "설정", "가입", "시작", "기초", "입문", "팁", "활용", "프롬프트", "예시"];
const AI_TERMS = [
  "ai", "인공지능", "제미나이", "gemini", "클로드", "claude", "챗gpt", "chatgpt", "gpt", "퍼플렉시티", "perplexity",
  "노트북lm", "notebooklm", "코파일럿", "copilot", "감마", "gamma", "뤼튼", "젠스파크", "genspark", "캔바", "노션ai", "프롬프트", "자동화",
];

export type KeywordMetrics = {
  keyword: string;
  monthlySearch?: number | null;
  documentCount?: number | null;
  compIdx?: string | null;
  adDepth?: number | null;
  momentum?: number | null;
  sources: string[];
};

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
  relevanceScore: number;
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

/**
 * 이 키워드가 지금 발굴 대상 블로그와 관련 있어 보이는지(0~100). 기본은 브랜드 미션(AI 도구) 기준 가중치이고,
 * 계정 콘셉트·도메인이 따로 있으면(domainNeutral) AI 도구 관련 여부는 묻지 않고 범용 정보성 콘텐츠 여부만 봅니다
 * — AI 도구와 무관한 계정에서 AI_TERMS 가 없다고 관련 없는 키워드로 오판(총점 하향·후보 탈락)하지 않도록.
 */
export function relevance(keyword: string, domainNeutral = false): number {
  const k = keyword.toLowerCase().replace(/\s/g, "");
  let s = 0;
  if (!domainNeutral && AI_TERMS.some((t) => k.includes(t.replace(/\s/g, "")))) s += 60;
  if (HOWTO_TERMS.some((t) => k.includes(t))) s += 25;
  if (/(1인가구|자취|혼자|프리랜서|직장인|회사|업무|보고서|엑셀|메일|회의)/.test(k)) s += 15;
  if (domainNeutral) s += 20;
  return clamp(s, 0, 100);
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

export function monetizationScore(m: KeywordMetrics, affiliateTags: string[] = []): number {
  const k = m.keyword.toLowerCase();
  let s = 20;
  if (m.compIdx === "높음") s += 35;
  else if (m.compIdx === "중간") s += 20;
  else if (m.compIdx === "낮음") s += 8;
  if (m.adDepth) s += clamp(m.adDepth, 0, 15);
  const intent = detectIntent(m.keyword);
  if (intent === "commercial") s += 20;
  if (intent === "transactional") s += 25;
  if (/(업무|보고서|엑셀|프리랜서|세금|부업|수익|재테크|이직)/.test(k)) s += 10; // 고단가 광고주 카테고리
  if (affiliateTags.some((t) => t && k.includes(t.toLowerCase()))) s += 10;
  return clamp(s, 0, 100);
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

export function scoreKeyword(m: KeywordMetrics, affiliateTags: string[] = [], domainNeutral = false): Scores {
  const vs = volumeScore(m.monthlySearch);
  const cs = competitionScore(m.documentCount, m.monthlySearch);
  const ms = monetizationScore(m, affiliateTags);
  const ts = trendScore(m.momentum);
  const rs = relevance(m.keyword, domainNeutral);
  const intent = detectIntent(m.keyword);
  const confidence = [vs, cs, ts].filter((x) => x != null).length;

  // 네이버: 검색량·경쟁(상위노출 가능성) 중심 / 구글: 수익성(CPC)·에버그린 정보성 중심
  const naver = weighted([[vs, 0.3], [cs, 0.3], [ms, 0.2], [ts, 0.2]]);
  const google = weighted([[vs, 0.25], [cs, 0.15], [ms, 0.4], [ts, 0.2]]);
  const base = Math.max(naver, google);
  // 브랜드 주제와 관련 없는 키워드는 크게 감점
  const total = Math.round(base * (0.4 + (rs / 100) * 0.6));
  // 확인된 지표가 없으면 플랫폼을 가를 근거도 없음
  const targetPlatform = confidence === 0 || Math.abs(naver - google) < 5 ? "BOTH" : naver > google ? "NAVER" : "BLOGGER";
  const r = (x: number | null) => (x == null ? null : Math.round(x));

  return {
    volumeScore: r(vs),
    competitionScore: r(cs),
    trendScore: r(ts),
    monetizationScore: Math.round(ms),
    monetizationBasis: m.compIdx ? "ad-data" : "intent-rule",
    relevanceScore: rs,
    total,
    confidence,
    verification: verificationOf(m),
    intent,
    targetPlatform,
  };
}
