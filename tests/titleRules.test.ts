import { describe, expect, it, vi } from "vitest";

// 검색광고 응답 (2026-10-08 실제 조회값)
const VOL: Record<string, number> = {
  근로장려금: 132_300,
  "2026근로장려금": 130_300,
  근로장려금2026: 120,
  근로장려금신청: 40_000,
  클로드요금제: 25_500,
  클로드요금제2026: 10,
  청년미래적금: 604_100,
  청년미래적금2차: 166_200,
};
vi.mock("@/lib/topics/sources", () => ({
  naverSearchAdKeywords: async (hints: string[]) => {
    // 실제 API 처럼 힌트와 관련된 키워드도 함께 돌려줌
    const keys = Object.keys(VOL).filter((k) => hints.some((h) => k.includes(h.replace(/\d{4}/, "")) || h.includes(k)));
    return keys.map((k) => ({ keyword: k, monthlyPc: 0, monthlyMobile: VOL[k], monthlyClicks: 0, compIdx: "중간", adDepth: 0 }));
  },
}));

import { evergreenSibling, findTimeForms, fixYearOrder, isChosenTitle, lifespanOf, pickSecondaryKeywords, stripTitleNoise, titleChecks, titleRulesText } from "../src/lib/topics/titleRules";
import { titleInsights, type TitlePerf } from "../src/lib/insights/engine";
import { buildUserPrompt, conceptRules } from "../src/lib/content/prompts";

const now = new Date("2026-10-08T00:00:00+09:00");

describe("A. 시간 표현은 검색량으로", () => {
  it("검색되는 어순 그대로만 — '2026 근로장려금'은 되고 '근로장려금 2026'(120)은 안 됨", async () => {
    const forms = await findTimeForms("근로장려금", now);
    expect(forms).toEqual([{ form: "2026 근로장려금", volume: 130_300, kind: "year" }]);
  });
  it("연도를 붙여 검색하지 않는 키워드는 빈 목록 (클로드요금제2026 = 10)", async () => {
    expect(await findTimeForms("클로드 요금제", now)).toEqual([]);
  });
  it("회차 표현도 검색량이 크면 잡음", async () => {
    expect(await findTimeForms("청년미래적금", now)).toContainEqual({ form: "청년미래적금 2차", volume: 166_200, kind: "event" });
  });
});

describe("B. 수명", () => {
  it("실시간·이슈 → 이슈형, 연도 검색·계절 → 반복, 나머지 상시형", () => {
    expect(lifespanOf({ origin: "channels" })).toBe("issue");
    expect(lifespanOf({ seasonality: "spike" })).toBe("issue");
    expect(lifespanOf({ timeForms: [{ form: "2026 근로장려금", volume: 1, kind: "year" }] })).toBe("recurring");
    expect(lifespanOf({ seasonality: "evergreen" })).toBe("evergreen");
  });
  it("규칙 문구가 수명에 맞게 바뀜", () => {
    expect(titleRulesText({ keyword: "클로드 요금제", lifespan: "evergreen", timeForms: [], today: "2026-10-08" })).toContain("시간 표현을 제목에 넣지 마세요");
    expect(titleRulesText({ keyword: "근로장려금", lifespan: "recurring", timeForms: [{ form: "2026 근로장려금", volume: 130_300, kind: "year" }], today: "2026-10-08" })).toContain('"2026 근로장려금"(월 130,300)');
  });
  it("이슈형의 오래 남는 짝 주제", () => {
    expect(evergreenSibling("청년미래적금 2차 신청")).toBe("청년미래적금 신청");
    expect(evergreenSibling("2026 근로장려금")).toBe("근로장려금");
    expect(evergreenSibling("클로드 요금제")).toBeNull();
  });
});

describe("F. 제목 체크리스트", () => {
  const fail = (title: string, o: Parameters<typeof titleChecks>[1]) => titleChecks(title, o).filter((c) => c.pass === false).map((c) => c.id);
  it("상시형에 월·연도·독자층·키워드 반복 괄호·긴 제목은 ✖", () => {
    expect(fail("챗지피티 아스트라 요금제, 직장인이 2026년 10월 기준 꼭 알아야 할 가격 정리 (챗지피티 아스트라 가격)", { keyword: "챗지피티 아스트라", lifespan: "evergreen" })).toEqual(
      expect.arrayContaining(["lifespan", "length", "persona", "paren"]),
    );
  });
  it("검색되는 연도 형태는 반복형에서 통과, 키워드가 맨 앞이 아니면 ✖", () => {
    const tf = [{ form: "2026 근로장려금", volume: 130_300, kind: "year" as const }];
    expect(fail("2026 근로장려금 신청 대상과 지급일 확인", { keyword: "2026 근로장려금", lifespan: "recurring", timeForms: tf })).toEqual([]);
    expect(fail("신청 전 확인할 근로장려금 대상", { keyword: "근로장려금 대상", lifespan: "evergreen" })).toContain("keyword");
  });
  it("구매 단계 질의는 후기·비교·가격 표현이 있어야 통과, 아니면 해당 없음", () => {
    expect(titleChecks("노이즈캔슬링 이어폰 무엇이 다를까", { keyword: "노이즈캔슬링 이어폰", lifespan: "evergreen", answerType: "purchase" }).find((c) => c.id === "buyer")?.pass).toBe(false);
    // 키워드 자체가 구매 단계 말이면 통과 (챗지피티 아스트라 가격)
    expect(titleChecks("챗지피티 아스트라 가격, 어떤 요금제부터 쓸 수 있나요?", { keyword: "챗지피티 아스트라 가격", lifespan: "evergreen", answerType: "purchase" }).find((c) => c.id === "buyer")?.pass).toBe(true);
    expect(titleChecks("클로드 요금제 가격 비교", { keyword: "클로드 요금제", lifespan: "evergreen", answerType: "purchase" }).find((c) => c.id === "buyer")?.pass).toBe(true);
    expect(titleChecks("근로장려금 신청 방법", { keyword: "근로장려금", lifespan: "evergreen", answerType: "howto" }).find((c) => c.id === "buyer")?.pass).toBeNull();
  });
  it("이슈형은 회차 허용, 월·일은 ✖", () => {
    expect(fail("청년미래적금 2차 신청 조건 정리", { keyword: "청년미래적금", lifespan: "issue" })).toEqual([]);
    expect(fail("청년미래적금 2차 10월 15일 마감 조건", { keyword: "청년미래적금", lifespan: "issue" })).toContain("lifespan");
  });
});

describe("E. 괄호·날짜 꼬리 정리", () => {
  it("키워드 반복 괄호와 '(2026년 10월 기준)'을 뺌, 다른 괄호는 둠", () => {
    expect(stripTitleNoise("챗지피티 아스트라 요금제 정리 (챗지피티 아스트라 가격)", "챗지피티 아스트라")).toBe("챗지피티 아스트라 요금제 정리");
    expect(stripTitleNoise("근로장려금 지급일 확인 (2026년 10월 기준)", "근로장려금")).toBe("근로장려금 지급일 확인");
    expect(stripTitleNoise("근로장려금 대상 (홑벌이·맞벌이)", "근로장려금")).toBe("근로장려금 대상 (홑벌이·맞벌이)");
  });
});

describe("C·D. 제목 확정과 계정별 보조 검색어", () => {
  it("6가지 중 고른 제목이나 사용자가 고정한 제목만 확정", () => {
    expect(isChosenTitle("A", { titleOptions: [{ title: "A" }] })).toBe(true);
    expect(isChosenTitle("B", { titleOptions: [{ title: "A" }] })).toBe(false);
    expect(isChosenTitle("B", { titleLocked: true })).toBe(true);
    expect(isChosenTitle("", { titleLocked: true })).toBe(false);
  });
  it("계정마다 서로 다른 보조 검색어 — 검색량 순, 시간 표현·이미 쓴 말 제외", () => {
    const related = [
      { keyword: "클로드 요금제 비교", volume: 900 },
      { keyword: "클로드 요금제 가격", volume: 1500 },
      { keyword: "클로드 요금제 2026", volume: 10 },
      { keyword: "클로드 프로", volume: 3000 },
    ];
    expect(pickSecondaryKeywords("클로드 요금제", related, 3)).toEqual(["클로드 요금제 가격", "클로드 요금제 비교", null]);
    expect(pickSecondaryKeywords("클로드 요금제", related, 2, ["클로드 요금제 가격 총정리"])).toEqual(["클로드 요금제 비교", null]);
  });
  it("원고 프롬프트: 확정 제목은 그대로, 바꾸면 이유 — 콘셉트 규칙에 독자층 제목 지시 없음", () => {
    const base = { platform: "NAVER" as const, keyword: "클로드 요금제", persona: "GENERAL" as const, today: "2026-10-08" };
    const locked = buildUserPrompt({ ...base, title: "클로드 요금제 가격 비교", titlePlan: { locked: true, rules: "[제목 규칙 — X]" } });
    expect(locked).toContain("확정 제목: 클로드 요금제 가격 비교");
    expect(locked).toContain("titleChangeReason");
    expect(locked).not.toContain("[제목 규칙 — X]");
    const free = buildUserPrompt({ ...base, titlePlan: { locked: false, rules: "[제목 규칙 — X]" } });
    expect(free).toContain("[제목 규칙 — X]");
    expect(conceptRules("직장인을 위한 AI 활용")).not.toContain("다른 계정 글과 구별되게");
  });
});

describe("B·G. 제목 전략 제안", () => {
  const post = (o: Partial<TitlePerf> & { plan: TitlePerf["plan"] }): TitlePerf => ({
    id: Math.random().toString(36),
    title: "t",
    focusKeyword: "k",
    publishedAt: new Date("2026-08-01"),
    pageviews: 10,
    impressions: 100,
    clicks: 5,
    ...o,
  });
  it("해마다 반복 글의 지난 연도 제목 → 연도 갱신, 이슈형 2주 뒤 → 짝 주제(이미 쓴 키워드면 생략)", () => {
    const out = titleInsights(
      [
        post({ title: "2025 근로장려금 지급일", focusKeyword: "2025 근로장려금", plan: { lifespan: "recurring", timeForms: [], locked: true } }),
        post({ title: "청년미래적금 2차 조건", focusKeyword: "청년미래적금 2차", plan: { lifespan: "issue", timeForms: [], locked: false } }),
        post({ title: "삼성전자 3분기 배당금", focusKeyword: "삼성전자 3분기 배당금", plan: { lifespan: "issue", timeForms: [], locked: false } }),
      ],
      new Set(["삼성전자배당금"]),
      now,
    );
    expect(out.map((i) => i.type)).toEqual(["YEAR_REFRESH", "EVERGREEN_SIBLING"]);
    expect(out[1].title).toContain("청년미래적금");
  });
  it("유형별 유입 비교는 묶음마다 3개 이상일 때만", () => {
    const ev = Array.from({ length: 3 }, () => post({ plan: { lifespan: "evergreen", timeForms: [], locked: true, timeInTitle: false } }));
    const is = Array.from({ length: 2 }, () => post({ plan: { lifespan: "issue", timeForms: [], locked: false, timeInTitle: true } }));
    const out = titleInsights([...ev, ...is], new Set(), now).filter((i) => i.type === "TITLE_EFFECT");
    expect(out).toHaveLength(1);
    expect(out[0].body).toContain("🌲 상시형 3개");
    expect(out[0].body).not.toContain("⚡ 이슈형");
  });
});

describe("검색되는 회차", () => {
  it("검색되는 회차 형태면 반복형에서도 통과, 검색 안 되는 회차는 ✖", () => {
    const tf = [{ form: "청년미래적금 2차", volume: 166_200, kind: "event" as const }];
    const ok = titleChecks("청년미래적금 2차 신청 조건 정리", { keyword: "청년미래적금", lifespan: "recurring", timeForms: tf });
    expect(ok.find((c) => c.id === "lifespan")?.pass).toBe(true);
    const bad = titleChecks("청년미래적금 3차 신청 조건 정리", { keyword: "청년미래적금", lifespan: "recurring", timeForms: tf });
    expect(bad.find((c) => c.id === "lifespan")?.pass).toBe(false);
  });
});

describe("연도 어순", () => {
  const tf = [{ form: "2026 근로장려금 신청", volume: 7_890, kind: "year" as const }];
  it("검색되지 않는 어순 '근로장려금 신청 2026'을 '2026 근로장려금 신청'으로 (2026-10-08 실제 생성 제목)", () => {
    expect(fixYearOrder("근로장려금 신청 2026 방법 기한 후 신청", "근로장려금 신청", tf)).toBe("2026 근로장려금 신청 방법 기한 후 신청");
    expect(fixYearOrder("근로장려금 신청 2026년 방법", "근로장려금 신청", tf)).toBe("2026 근로장려금 신청 방법");
    expect(fixYearOrder("근로장려금 신청 2026 방법", "근로장려금 신청", [])).toBe("근로장려금 신청 2026 방법");
  });
  it("체크리스트: 검색되는 형태로 시작하면 키워드 ✔, 어순이 다르면 ✖", () => {
    const good = titleChecks("2026 근로장려금 신청 방법과 기한", { keyword: "근로장려금 신청", lifespan: "recurring", timeForms: tf });
    expect(good.filter((c) => c.pass === false)).toEqual([]);
    const bad = titleChecks("근로장려금 신청 2026 방법", { keyword: "근로장려금 신청", lifespan: "recurring", timeForms: tf });
    expect(bad.find((c) => c.id === "lifespan")?.note).toContain("연도 어순");
  });
  it("질문형 제목은 독자의 문제를 다룸", () => {
    expect(titleChecks("근로장려금 신청 기한 놓쳤다면, 지금도 가능할까?", { keyword: "근로장려금 신청", lifespan: "evergreen" }).find((c) => c.id === "problem")?.pass).toBe(true);
  });
});
