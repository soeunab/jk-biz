import { describe, expect, it } from "vitest";
import { goldenInsight, splitBudget, tierOf, trendMomentum } from "@/lib/topics/golden";
import { countSince } from "@/lib/topics/sources";

describe("황금키워드 구간", () => {
  it("검색량 경계 — 아래는 포함, 위는 다음 구간", () => {
    expect(tierOf(99)).toBeNull();
    expect(tierOf(100)).toBe("beginner");
    expect(tierOf(499)).toBe("beginner");
    expect(tierOf(500)).toBe("intermediate");
    expect(tierOf(9_999)).toBe("advanced");
    expect(tierOf(10_000)).toBe("expert");
    expect(tierOf(499_999)).toBe("challenger");
    expect(tierOf(500_000)).toBe("legend");
    expect(tierOf(3_000_000)).toBe("legend");
  });
});

describe("문서수 조회 예산 분배", () => {
  it("똑같이 나누고, 조회할 게 적은 구간이 남긴 몫은 다른 구간으로", () => {
    const out = splitBudget({ beginner: 5000, intermediate: 5000, legend: 10 }, 300);
    expect(out.legend).toBe(10);
    expect(out.beginner + out.intermediate + out.legend).toBe(300);
    expect(Math.abs(out.beginner - out.intermediate)).toBeLessThanOrEqual(1);
  });
  it("필요한 만큼만 쓰고 넘치면 남김", () => {
    expect(splitBudget({ a: 3, b: 0 }, 100)).toEqual({ a: 3, b: 0 });
  });
});

describe("최근 30일 발행 수", () => {
  it("postdate 가 기간 안인 글만 셈 (30일 전 그날까지 포함)", () => {
    const now = new Date("2026-10-07T12:00:00");
    const items = [{ postdate: "20261006" }, { postdate: "20260908" }, { postdate: "20260907" }, { postdate: "20260906" }, { postdate: "20260801" }];
    expect(countSince(items, 30, now)).toBe(3);
  });
});

describe("골든 점수·진단 (규칙, AI 안 씀)", () => {
  const flat = (n: number) => Array.from({ length: n }, () => ({ ratio: 50 }));
  it("비율이 아주 낮고 최근 발행이 적으면 높은 점수", () => {
    const g = goldenInsight({ volume: 490, mobile: 480, ratio: 0.002, recent30: 1, seasonality: "evergreen" }, flat(30));
    expect(g.score).toBeGreaterThanOrEqual(80);
    expect(g.tags).toContain("도전가능");
    expect(g.tags).toContain("꾸준형");
    expect(g.flags.map((f) => f.title)).toContain("모바일 타겟");
  });
  it("관심이 식으면 유행 종료, 최근 발행이 많으면 경쟁 증가", () => {
    const fading = [...Array.from({ length: 23 }, () => ({ ratio: 80 })), ...Array.from({ length: 7 }, () => ({ ratio: 10 }))];
    const g = goldenInsight({ volume: 1000, mobile: 500, ratio: 3, recent30: 100, seasonality: "spike" }, fading);
    const titles = g.flags.map((f) => f.title);
    expect(titles).toEqual(expect.arrayContaining(["유행 종료", "경쟁 증가", "이슈형"]));
    expect(g.score).toBeLessThan(45);
  });
  it("추이 데이터가 짧으면 모멘텀을 판단하지 않음", () => {
    expect(trendMomentum([{ ratio: 1 }])).toBeNull();
  });
});
