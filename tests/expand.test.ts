/**
 * 메인 키워드(씨드) → 롱테일 확장 도구 (topics/expand.ts): 키워드 줄이기, 비율, 제목 키워드 왼쪽 고정, 같은 주제 확인.
 */
import { describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({ route: "claude-code", ok: [] as string[] }));
vi.mock("@/lib/llm", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm")>()),
  routeFor: async () => llm.route,
  generateJson: async () => ({ ok: llm.ok }),
}));

import { docRatio, filterSameTopic, fmtRatio, keywordFirst, shorteningLadder, startsWithKeyword, TITLE_TYPE_GUIDE, TITLE_TYPES } from "@/lib/topics/expand";

describe("키워드 줄이기", () => {
  it("앞 단어부터 남기며 줄임", () => {
    expect(shorteningLadder("신한은행 개인정보 유출")).toEqual(["신한은행 개인정보 유출", "신한은행 개인정보", "신한은행"]);
    expect(shorteningLadder("신한은행 유출")).toEqual(["신한은행 유출", "신한은행"]);
    expect(shorteningLadder("  코스피  ")).toEqual(["코스피"]);
  });
});

describe("비율 (문서수 ÷ 월검색량)", () => {
  it("키워드마스터와 같은 계산, 낮을수록 경쟁 적음", () => {
    expect(docRatio(100, 1000)).toBe(0.1);
    expect(docRatio(null, 1000)).toBeNull();
    expect(docRatio(100, 0)).toBeNull();
    expect(fmtRatio(0.1234)).toBe("0.12");
    expect(fmtRatio(3.45)).toBe("3.5");
    expect(fmtRatio(52.4)).toBe("52");
    expect(fmtRatio(null)).toBe("미확인");
  });
});

describe("제목 — 메인 키워드는 항상 맨 왼쪽", () => {
  it("6가지 유형", () => {
    expect(TITLE_TYPES).toEqual(["궁금증형", "행동형", "정보형", "주의형", "비교형", "조합형"]);
    for (const t of TITLE_TYPES) expect(TITLE_TYPE_GUIDE[t]).toContain("예:");
  });

  it("띄어쓰기·문장부호 무시하고 시작 여부 판단", () => {
    expect(startsWithKeyword("신한은행 고객정보 유출, 내 정보도 포함됐을까?", "신한은행 고객정보")).toBe(true);
    expect(startsWithKeyword("신한은행고객정보 유출 확인", "신한은행 고객정보")).toBe(true);
    expect(startsWithKeyword("내 정보도? 신한은행 고객정보 유출", "신한은행 고객정보")).toBe(false);
  });

  it("어기면 키워드를 맨 앞으로 옮김 (중복 없이)", () => {
    expect(keywordFirst("내 정보도 포함됐을까? 신한은행 고객정보 유출", "신한은행 고객정보")).toBe("신한은행 고객정보 내 정보도 포함됐을까? 유출");
    expect(keywordFirst("확인 방법과 대처 순서", "신한은행 유출")).toBe("신한은행 유출 확인 방법과 대처 순서");
    expect(keywordFirst("신한은행 유출 조회, 문자 링크 누르기 전 확인할 점", "신한은행 유출")).toBe("신한은행 유출 조회, 문자 링크 누르기 전 확인할 점");
  });
});

describe("줄인 키워드에서 온 후보의 같은 주제 확인", () => {
  it("AI 가 고른 것만 통과 (정규화 비교)", async () => {
    llm.route = "claude-code";
    llm.ok = ["신한은행 해킹", "신한은행정보유출"];
    const ok = await filterSameTopic("신한은행 유출", "해킹으로 고객정보 유출", ["신한은행 해킹", "신한은행 정보유출", "신한은행 영업시간"], () => undefined);
    expect(ok && [...ok].sort()).toEqual(["신한은행정보유출", "신한은행해킹"]);
  });

  it("수동 모드면 null — 호출하는 쪽이 보수적으로 처리", async () => {
    llm.route = "manual";
    expect(await filterSameTopic("신한은행 유출", undefined, ["신한은행 해킹"], () => undefined)).toBeNull();
  });
});

describe("검색량 바닥값 · 하한 · 제목 숫자 규칙", () => {
  it("'< 10'(합계 10 이하)은 바닥값 — 비율을 계산하지 않음", async () => {
    const { isFloorVolume, MIN_MONTHLY_SEARCH } = await import("@/lib/topics/expand");
    expect(isFloorVolume(10)).toBe(true);
    expect(isFloorVolume(15)).toBe(false);
    expect(isFloorVolume(null)).toBe(false);
    expect(docRatio(435831, 10)).toBeNull();
    expect(docRatio(7211, 365)).toBeCloseTo(19.76, 1);
    expect(MIN_MONTHLY_SEARCH).toBe(30);
  });

  it("제목 숫자는 근거 있는 사실만", async () => {
    const { TITLE_NUMBER_RULE } = await import("@/lib/topics/expand");
    expect(TITLE_NUMBER_RULE).toContain("실제로 나온 사실");
    expect(TITLE_NUMBER_RULE).toContain("지어내지");
  });
});

describe("롱테일은 메인 키워드를 반드시 포함", () => {
  it("기준어: 시드 전체 + 2단어 이상 핵심 (한 단어 줄임말은 제외)", async () => {
    const { anchorsOf, looseAnchorOf } = await import("@/lib/topics/expand");
    expect(anchorsOf("ai 해킹 공격")).toEqual(["ai 해킹 공격", "ai 해킹"]);
    expect(anchorsOf("서울 아파트값")).toEqual(["서울 아파트값"]);
    expect(anchorsOf("청년미래적금")).toEqual(["청년미래적금"]);
    expect(looseAnchorOf("신한은행 유출")).toBe("신한은행");
    expect(looseAnchorOf("ai 해킹 공격")).toBeNull();
  });

  it("어느 메인 키워드에서 뻗었는지", async () => {
    const { mainKeywordOf } = await import("@/lib/topics/expand");
    const seeds = ["ai 해킹 공격"];
    expect(mainKeywordOf("ai 해킹 사건", seeds)).toEqual({ seed: "ai 해킹 공격", strict: true });
    expect(mainKeywordOf("AI해킹은행", seeds)).toEqual({ seed: "ai 해킹 공격", strict: true });
    expect(mainKeywordOf("AI 보안 솔루션", seeds)).toBeNull();
    expect(mainKeywordOf("인공지능 해킹", seeds)).toBeNull();
    expect(mainKeywordOf("신한은행 해킹", ["신한은행 유출"])).toEqual({ seed: "신한은행 유출", strict: false });
    expect(mainKeywordOf("서울 날씨", ["서울 아파트값"])).toEqual({ seed: "서울 아파트값", strict: false });
  });
});
