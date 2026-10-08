import { describe, expect, it } from "vitest";
import { factSheetText, RESEARCH_SYSTEM } from "@/lib/llm";

describe("핵심 수치 재확인 → 원고용 메모", () => {
  it("확인·정정·미확인을 나눠 정정 전 값을 '틀림'으로 표시", () => {
    const t = factSheetText({
      facts: [
        { claim: "근로장려금 맞벌이 총소득 기준", value: "4,400만원 미만", status: "corrected", previous: "3,800만원 미만", asOf: "2025년 귀속(2026년 신청)", url: "https://www.nts.go.kr/x" },
        { claim: "단독가구 기준", value: "2,200만원 미만", status: "confirmed", previous: "", asOf: "2025년 귀속", url: "https://www.nts.go.kr/x" },
        { claim: "재산 기준일", value: "6월 1일", status: "unverified", previous: "", asOf: "", url: "" },
      ],
    });
    expect(t).toContain('✎ 정정(메모의 "3,800만원 미만"는 틀림): 근로장려금 맞벌이 총소득 기준: 4,400만원 미만');
    expect(t).toContain("✔ 확인: 단독가구 기준");
    expect(t).toContain("? 미확인");
  });

  it("조사 지침에 공식 출처 우선·최신성·기준일 규칙이 있음", () => {
    expect(RESEARCH_SYSTEM).toContain("1차 공식 출처");
    expect(RESEARCH_SYSTEM).toContain("지난 연도 기준 값을 최신처럼 쓰지 마세요");
    expect(RESEARCH_SYSTEM).not.toContain("IT 리서처");
  });
});
