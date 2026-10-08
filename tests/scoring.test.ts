import { describe, expect, it } from "vitest";
import { competitionScore, detectIntent, normalizeKeyword, scoreKeyword, trendScore, volumeScore } from "@/lib/topics/scoring";

describe("topic scoring", () => {
  it("detects commercial and transactional intent", () => {
    expect(detectIntent("제미나이 유료 요금제 비교")).toBe("commercial");
    expect(detectIntent("AI 노트북 최저가 구매")).toBe("transactional");
    expect(detectIntent("클로드 사용법")).toBe("informational");
  });

  it("prefers mid-volume keywords and low saturation", () => {
    expect(volumeScore(5000)!).toBeGreaterThan(volumeScore(50)!);
    expect(competitionScore(500, 10_000)!).toBeGreaterThan(competitionScore(500_000, 10_000)!);
  });

  it("maps momentum to 0..100 around 50", () => {
    expect(trendScore(1)).toBe(50);
    expect(trendScore(2)).toBe(100);
    expect(trendScore(0.5)).toBe(0);
  });

  it("scores high-CPC, on-brand keywords above off-topic ones", () => {
    const good = scoreKeyword({ keyword: "직장인 AI 보고서 작성 추천", monthlySearch: 8000, documentCount: 4000, compIdx: "높음", monthlyClicks: 500, sources: [] });
    const offTopic = scoreKeyword({ keyword: "캠핑 의자 추천", monthlySearch: 8000, documentCount: 4000, compIdx: "높음", sources: [] });
    expect(good.total).toBeGreaterThan(offTopic.total);
    expect(good.monetizationScore).toBeGreaterThan(60);
  });
});

describe("unknown data is never invented", () => {
  it("returns null (미확인) instead of neutral numbers", () => {
    expect(volumeScore(null)).toBeNull();
    expect(competitionScore(null, 100)).toBeNull();
    expect(competitionScore(100, null)).toBeNull();
    expect(trendScore(null)).toBeNull();
  });

  it("reports confidence and verification level", () => {
    const none = scoreKeyword({ keyword: "제미나이 사용법", sources: ["template"] });
    expect(none.confidence).toBe(0);
    expect(none.verification).toBe("UNVERIFIED");
    expect(none.volumeScore).toBeNull();
    expect(none.targetPlatform).toBe("BOTH");

    expect(scoreKeyword({ keyword: "제미나이 사용법", sources: ["naver-ac"] }).verification).toBe("SUGGESTED");

    const full = scoreKeyword({ keyword: "제미나이 사용법", monthlySearch: 5000, documentCount: 2000, momentum: 1.2, sources: ["naver-searchad"] });
    expect(full.verification).toBe("VERIFIED");
    expect(full.confidence).toBe(3);
  });

  it("computes the total from known metrics only (no hidden defaults)", () => {
    const a = scoreKeyword({ keyword: "클로드 보고서", monthlySearch: 3000, sources: [] });
    const b = scoreKeyword({ keyword: "클로드 보고서", monthlySearch: 3000, documentCount: null, momentum: null, sources: [] });
    expect(a.total).toBe(b.total);
    expect(a.confidence).toBe(1);
  });

  it("normalizes spacing/case/punctuation for duplicate detection", () => {
    expect(normalizeKeyword("제미나이 사용법")).toBe(normalizeKeyword("제미나이사용법"));
    expect(normalizeKeyword("ChatGPT, 무료")).toBe(normalizeKeyword("chatgpt 무료"));
  });
});

describe("수익성·AI 내성 (플레이북 3중 필터)", () => {
  it("같은 조건이면 금융·세금 같은 고단가 주제, 광고 클릭이 많은 키워드가 수익성 높음", async () => {
    const { monetizationScore, valueTier } = await import("@/lib/topics/scoring");
    expect(valueTier("1억 대출 금리")).toBe("high");
    expect(valueTier("노트북 추천")).toBe("mid");
    expect(valueTier("캠핑 요리")).toBe("base");
    const base = { monthlySearch: 3000, documentCount: 3000, compIdx: "중간", sources: [] };
    expect(monetizationScore({ keyword: "연말정산 환급 조회", ...base })).toBeGreaterThan(monetizationScore({ keyword: "캠핑 요리 레시피", ...base }));
    expect(monetizationScore({ keyword: "캠핑 요리 레시피", ...base, monthlyClicks: 300 })).toBeGreaterThan(monetizationScore({ keyword: "캠핑 요리 레시피", ...base }));
  });

  it("AI 가 판정한 질문 유형: 정의형은 낮게, 경험·조건 해석형은 높게, 모르면 그대로", async () => {
    const m = { keyword: "청년월세 신청", monthlySearch: 3000, documentCount: 3000, compIdx: "중간", sources: [] };
    const def = scoreKeyword({ ...m, answerType: "definition" });
    const cond = scoreKeyword({ ...m, answerType: "condition" });
    const unknown = scoreKeyword(m);
    expect(cond.total).toBeGreaterThan(def.total);
    expect(def.aiResistance).toBe(20);
    expect(unknown.aiResistance).toBeNull();
  });
});

describe("수요 성격 (상시형·변동형·이슈형)", () => {
  it("1년치 주간 추이로 분류", async () => {
    const { classifySeasonality } = await import("@/lib/topics/sources");
    expect(classifySeasonality(Array.from({ length: 52 }, (_, i) => 50 + (i % 3)))).toBe("evergreen");
    expect(classifySeasonality([...Array(48).fill(2), 100, 80, 60, 40])).toBe("spike");
    expect(classifySeasonality(Array.from({ length: 52 }, (_, i) => (i % 13 < 4 ? 90 : 15)))).toBe("seasonal");
    expect(classifySeasonality(Array(52).fill(0))).toBeNull();
  });
});
