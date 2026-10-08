import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let mode: "ok" | "blocked" = "ok";
vi.mock("@/lib/topics/sources", async (orig) => {
  const real = await orig<typeof import("@/lib/topics/sources")>();
  return {
    ...real,
    naverSectionBlogCount: vi.fn(async (q: string) => {
      calls.push(q);
      if (mode === "blocked") throw new real.SectionBlockedError("403");
      return q === "큰키워드" ? 1000 : 3;
    }),
    naverBlogDocCount: vi.fn(async () => 54321),
  };
});

describe("문서수 측정기 (공식 API 한도 보호)", () => {
  it("예산만큼만 화면 조회하고, 상한에 걸린 큰 키워드만 공식 API", async () => {
    process.env.GOLDEN_SECTION_BUDGET = "";
    const { DocMeter } = await import("@/lib/topics/golden");
    const m = new DocMeter(2, 1, () => undefined);
    expect(await m.section("a")).toBe(3);
    expect(await m.section("큰키워드")).toBe(1000);
    expect(await m.section("c")).toBeNull(); // 예산 2 소진
    expect(m.left).toBe(0);
    expect(await m.exact("큰키워드")).toBe(54321);
    expect(await m.exact("또")).toBeNull(); // 공식 API 예산 1 소진
  }, 10_000);

  it("막히면 즉시 멈추고 더 조회하지 않음", async () => {
    mode = "blocked";
    calls.length = 0;
    const { DocMeter } = await import("@/lib/topics/golden");
    const logs: string[] = [];
    const m = new DocMeter(100, 0, (s) => logs.push(s));
    expect(await m.section("x")).toBeNull();
    expect(m.blocked).toBe(true);
    expect(await m.section("y")).toBeNull();
    expect(calls).toEqual(["x"]);
    expect(logs[0]).toContain("막힌 것 같아");
  }, 10_000);
});
