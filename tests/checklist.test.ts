import { describe, expect, it } from "vitest";
import { actionableItems, internalLinksOf } from "@/lib/content/checklist";

describe("사람 검수 항목 — 실제로 할 일만", () => {
  // 2026-10-08 실제 원고(챗지피티 아스트라 요금제)에 남았던 항목들
  const items = [
    "GPT-6 Pro 주간 메시지 한도는 미확인이라 제외함 (추가 조사: 신뢰할 만한 출처가 없어요. 본문에 쓰지 않았으니 그대로 두세요.)",
    "Plus·Pro 월 구독료는 미확인 상태로 본문이 적절히 유보했어요.",
    "[경험 추가] 자리표시 2곳을 실제 캡처와 경험으로 교체 (사람이 직접 처리: 사람이 해야 해요.)",
    "스크린샷 이미지는 발행 직전 공식 화면으로 교체하고 개인정보 가리기",
    "내부 링크 2건의 URL이 유효한지 확인",
    "클립(숏폼) 추가 고려 (사람이 직접 처리: …)",
    "'설정 → 사용량' 경로는 도움말 본문을 직접 열람하지 못한 상태예요.",
  ];
  it("원고에 없는 내용·이미 유보·자리표시·팁·확인된 링크·캡처 없는 원고의 캡처 교체는 뺌", () => {
    expect(actionableItems(items, { linksOk: true, hasScreenshots: false })).toEqual(["'설정 → 사용량' 경로는 도움말 본문을 직접 열람하지 못한 상태예요."]);
  });
  it("링크가 깨졌거나 캡처가 있으면 그 항목은 남김", () => {
    const out = actionableItems(items, { linksOk: false, hasScreenshots: true });
    expect(out).toContain("내부 링크 2건의 URL이 유효한지 확인");
    expect(out.some((c) => c.startsWith("스크린샷"))).toBe(true);
  });
  it("같은 내용이 주석만 달리 두 번 있으면 하나만", () => {
    expect(actionableItems(["A 확인 (추가 조사: x)", "A 확인 (추가 조사: y)"])).toHaveLength(1);
  });
  it("내 블로그로 가는 링크만 내부 링크로", () => {
    const t = "참고 [글](https://blog.naver.com/ai_jiwonforyou/224428722277), 공식 https://help.openai.com/x, 다른 https://blog.naver.com/other/1";
    expect(internalLinksOf(t, ["https://blog.naver.com/ai_jiwonforyou"])).toEqual(["https://blog.naver.com/ai_jiwonforyou/224428722277"]);
  });
});

describe("공식 페이지 후보", () => {
  it("블로그·위키·SNS 는 빼고 중복 없이", async () => {
    const { officialCandidates } = await import("@/lib/content/officialPages");
    expect(
      officialCandidates([
        "https://help.openai.com/en/articles/1",
        "https://help.openai.com/en/articles/1#top",
        "https://blog.naver.com/x/1",
        "https://wikidocs.net/2",
        "https://www.nts.go.kr/a",
      ]),
    ).toEqual(["https://help.openai.com/en/articles/1", "https://www.nts.go.kr/a"]);
  });
});
