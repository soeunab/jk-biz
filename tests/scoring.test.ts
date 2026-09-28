import { describe, expect, it } from "vitest";
import { competitionScore, detectIntent, relevance, scoreKeyword, trendScore, volumeScore } from "@/lib/topics/scoring";

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
    expect(volumeScore(5000)).toBeGreaterThan(volumeScore(50));
    expect(volumeScore(null)).toBe(40);
    expect(competitionScore(500, 10_000)).toBeGreaterThan(competitionScore(500_000, 10_000));
    expect(competitionScore(null, 100)).toBe(50);
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
