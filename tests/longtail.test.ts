import { describe, expect, it, vi } from "vitest";

// 네이버 조회는 고정 응답 — 연관 후보 필터만 검사
const net = vi.hoisted(() => ({ ac: [] as string[], rel: [] as string[], ad: [] as string[] }));
vi.mock("@/lib/topics/sources", () => ({
  naverAutocomplete: async (k: string) => (net.ac.includes(k) ? [] : net.ac),
  naverRelatedSearch: async () => net.rel,
  naverSearchAdKeywords: async (hints: string[]) =>
    [...hints, ...net.ad].map((keyword) => ({ keyword, monthlyPc: 50, monthlyMobile: 100, compIdx: "낮음", adDepth: 1 })),
  naverBlogDocCount: async () => 1000,
  naverTrendMomentum: async () => null,
}));

import { containsAll, coreTokens, ensureKeywordInTitle, expandKeyword, isHeadKeyword, pickLongtail, relatedOf, type LongtailCandidate } from "@/lib/topics/longtail";

const c = (keyword: string, volume: number | null, score: number): LongtailCandidate => ({
  keyword,
  sources: ["naver-ac"],
  volume,
  compIdx: null,
  adDepth: null,
  documentCount: null,
  competitionScore: null,
  score,
});

describe("롱테일 선택", () => {
  it("띄어쓰기 없는 4글자 이하는 헤드 키워드", () => {
    expect(isHeadKeyword("ai")).toBe(true);
    expect(isHeadKeyword("클로드")).toBe(true);
    expect(isHeadKeyword("연말정산")).toBe(true);
    expect(isHeadKeyword("클로드 요금제")).toBe(false);
    expect(isHeadKeyword("클로드요금제")).toBe(false);
  });

  it("헤드 키워드·검색량 없는 문구를 빼고 점수 높은 롱테일을 고름", () => {
    const best = pickLongtail([c("클로드", 911600, 90), c("클로드 무료", null, 80), c("클로드 요금제", 21020, 55), c("클로드 가격", 15230, 60)]);
    expect(best?.keyword).toBe("클로드 가격");
  });

  it("경쟁을 잰 문구가 있으면 안 잰 문구는 후보에서 뺌", () => {
    const measured = { ...c("클로드 요금제", 21020, 40), competitionScore: 70 };
    expect(pickLongtail([c("클로드 가격", 15230, 60), measured])?.keyword).toBe("클로드 요금제");
  });

  it("검색량이 확인된 롱테일이 없으면 null", () => {
    expect(pickLongtail([c("클로드", 911600, 90), c("클로드 무료", null, 80)])).toBeNull();
  });

  it("제목에 핵심 키워드가 없으면 앞에 붙이고, 띄어쓰기만 다르면 그대로 둠", () => {
    expect(ensureKeywordInTitle("요금제 총정리", "클로드 요금제")).toBe("클로드 요금제, 요금제 총정리");
    expect(ensureKeywordInTitle("클로드요금제 총정리", "클로드 요금제")).toBe("클로드요금제 총정리");
  });

  it("저장된 연관 문구 읽기 (문자열·객체 모두)", () => {
    expect(relatedOf({ related: ["a b", { keyword: "c d", volume: 10 }] })).toEqual([
      { keyword: "a b", volume: null },
      { keyword: "c d", volume: 10 },
    ]);
    expect(relatedOf({})).toBeNull();
    expect(relatedOf(null)).toBeNull();
  });
});

describe("연관 문구는 같은 이야기만 (B1)", () => {
  it("핵심 토큰 = 토큰 − 범용 수식어, 범용어만 있으면 전체", () => {
    expect(coreTokens("힉스필드 현대차")).toEqual(["힉스필드", "현대차"]);
    expect(coreTokens("청년 도약계좌 해지")).toEqual(["청년", "도약계좌"]);
    expect(coreTokens("제미나이 사용법 2026")).toEqual(["제미나이"]);
    expect(coreTokens("사용법 추천")).toEqual(["사용법", "추천"]);
    expect(coreTokens("클로드")).toEqual(["클로드"]);
  });

  it("핵심 토큰을 모두 포함해야 통과", () => {
    const core = coreTokens("힉스필드 현대차");
    expect(containsAll("힉스필드 현대차 광고", core)).toBe(true);
    expect(containsAll("힉스필드 현대차 광고 제작", core)).toBe(true);
    expect(containsAll("현대차 AI 투자", core)).toBe(false);
    expect(containsAll("힉스필드 AI 영상", core)).toBe(false);
    expect(containsAll("청년도약계좌 금리", coreTokens("청년 도약계좌 해지"))).toBe(true);
  });

  it("expandKeyword: 하나만 겹치는 다른 이야기는 후보·연관 문구에서 빠짐", async () => {
    net.ac = ["힉스필드 현대차 광고", "현대차 AI 투자", "힉스필드 사용법"];
    net.rel = ["힉스필드 현대차 광고 제작", "현대차 로봇"];
    net.ad = ["현대차 주가", "힉스필드 현대차 광고 모델"];
    const r = await expandKeyword("힉스필드 현대차", { docs: 0 });
    const kws = r.candidates.map((c) => c.keyword);
    expect(kws).toEqual(expect.arrayContaining(["힉스필드 현대차", "힉스필드 현대차 광고", "힉스필드 현대차 광고 제작", "힉스필드 현대차 광고 모델"]));
    for (const bad of ["현대차 AI 투자", "힉스필드 사용법", "현대차 로봇", "현대차 주가"]) expect(kws).not.toContain(bad);
    expect(r.related.map((x) => x.keyword)).not.toContain("현대차 AI 투자");
  });

  it("단어 1개 기준은 그 단어를 포함한 문구 모두 (기존과 같음)", async () => {
    net.ac = ["클로드 요금제", "클로드 코드 사용법", "챗지피티 요금제"];
    net.rel = [];
    net.ad = [];
    const kws = (await expandKeyword("클로드", { docs: 0 })).candidates.map((c) => c.keyword);
    expect(kws).toEqual(expect.arrayContaining(["클로드", "클로드 요금제", "클로드 코드 사용법"]));
    expect(kws).not.toContain("챗지피티 요금제");
  });
});
