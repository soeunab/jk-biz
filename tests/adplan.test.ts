import { describe, expect, it } from "vitest";
import { adPlan } from "@/lib/content/adPlan";

const sec = (len: number) => ({ heading: "h", level: 2 as const, body: "가".repeat(len), table: null, tip: "", image: null });
const ms = (n: number, len: number) => ({ intro: "", sections: Array.from({ length: n }, () => sec(len)) }) as Parameters<typeof adPlan>[0];

describe("인아티클 광고 배치 (체류시간 보호)", () => {
  it("짧은 글은 1개, 첫 화면이 아니라 1번 섹션 뒤", () => {
    expect(adPlan(ms(6, 300))).toEqual([0]);
  });

  it("3,000자 이상이면 2개, 서로 붙지 않고 마지막 섹션(FAQ 직전) 뒤에는 없음", () => {
    const at = adPlan(ms(7, 600));
    expect(at).toHaveLength(2);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(2);
    expect(at.every((i) => i <= 5)).toBe(true);
  });

  it("제휴 상품이 있으면 1개만, 상품 박스 섹션과 앞뒤 섹션은 피함", () => {
    // 상품이 2번 섹션 뒤(afterSection=2 → 인덱스 1) — 인덱스 0·1·2 금지
    const at = adPlan(ms(7, 600), [2]);
    expect(at).toHaveLength(1);
    expect([0, 1, 2]).not.toContain(at[0]);
  });

  it("섹션이 1개뿐이면 광고 없음", () => {
    expect(adPlan(ms(1, 5000))).toEqual([]);
  });
});
