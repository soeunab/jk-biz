import { describe, expect, it } from "vitest";
import { ensureKeywordInTitle, isHeadKeyword, pickLongtail, relatedOf, type LongtailCandidate } from "@/lib/topics/longtail";

const c = (keyword: string, volume: number | null, score: number): LongtailCandidate => ({
  keyword,
  sources: ["naver-ac"],
  volume,
  compIdx: null,
  documentCount: null,
  competitionScore: null,
  score,
});

describe("롱테일 선택", () => {
  it("띄어쓰기 없는 4글자 이하는 헤드 키워드", () => {
    expect(isHeadKeyword("ai")).toBe(true);
    expect(isHeadKeyword("클로드")).toBe(true);
    expect(isHeadKeyword("연말정산")).toBe(true);
    expect(isHeadKeyword("클로드 요금제")).toBe(false);
    expect(isHeadKeyword("클로드요금제")).toBe(false);
  });

  it("헤드 키워드·검색량 없는 문구를 빼고 점수 높은 롱테일을 고름", () => {
    const best = pickLongtail([c("클로드", 911600, 90), c("클로드 무료", null, 80), c("클로드 요금제", 21020, 55), c("클로드 가격", 15230, 60)]);
    expect(best?.keyword).toBe("클로드 가격");
  });

  it("경쟁을 잰 문구가 있으면 안 잰 문구는 후보에서 뺌", () => {
    const measured = { ...c("클로드 요금제", 21020, 40), competitionScore: 70 };
    expect(pickLongtail([c("클로드 가격", 15230, 60), measured])?.keyword).toBe("클로드 요금제");
  });

  it("검색량이 확인된 롱테일이 없으면 null", () => {
    expect(pickLongtail([c("클로드", 911600, 90), c("클로드 무료", null, 80)])).toBeNull();
  });

  it("제목에 핵심 키워드가 없으면 앞에 붙이고, 띄어쓰기만 다르면 그대로 둠", () => {
    expect(ensureKeywordInTitle("요금제 총정리", "클로드 요금제")).toBe("클로드 요금제, 요금제 총정리");
    expect(ensureKeywordInTitle("클로드요금제 총정리", "클로드 요금제")).toBe("클로드요금제 총정리");
  });

  it("저장된 연관 문구 읽기 (문자열·객체 모두)", () => {
    expect(relatedOf({ related: ["a b", { keyword: "c d", volume: 10 }] })).toEqual([
      { keyword: "a b", volume: null },
      { keyword: "c d", volume: 10 },
    ]);
    expect(relatedOf({})).toBeNull();
    expect(relatedOf(null)).toBeNull();
  });
});
