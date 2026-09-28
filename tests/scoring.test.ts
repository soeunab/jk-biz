import { describe, expect, it } from "vitest";
import { competitionScore, detectIntent, normalizeKeyword, relevance, scoreKeyword, trendScore, volumeScore } from "@/lib/topics/scoring";

describe("topic scoring", () => {
  it("detects commercial and transactional intent", () => {
    expect(detectIntent("제미나이 유료 요금제 비교")).toBe("commercial");
    expect(detectIntent("AI 노트북 최저가 구매")).toBe("transactional");
    expect(detectIntent("클로드 사용법")).toBe("informational");
  });

  it("rewards on-brand AI how-to keywords", () => {
    expect(relevance("제미나이 사용법")).toBeGreaterThanOrEqual(80);
    expect(relevance("강아지 사료 추천")).toBe(0);
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
    const good = scoreKeyword({ keyword: "직장인 AI 보고서 작성 추천", monthlySearch: 8000, documentCount: 4000, compIdx: "높음", sources: [] });
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
