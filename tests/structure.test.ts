import { describe, expect, it } from "vitest";
import { recipeFor } from "@/lib/content/recipes";
import { notAnswerFirst } from "@/lib/content/seo";
import { rankInternalLinks } from "@/lib/content/internalLinks";

const sec = (body: string) => ({ heading: "h", level: 2 as const, body, table: null, tip: "", image: null });

describe("조건 해석형 글 유형", () => {
  it("지원금·대상·자격 질의는 CONDITION, 나머지는 기존대로", () => {
    expect(recipeFor("informational", "청년월세 지원 대상")).toBe("CONDITION");
    expect(recipeFor("informational", "근로장려금 소득 기준")).toBe("CONDITION");
    expect(recipeFor("informational", "클로드 사용법")).toBe("HOWTO");
    expect(recipeFor("commercial", "노트북 추천")).toBe("COMPARISON"); // 상업 의도가 우선
  });
});

describe("결론 먼저", () => {
  it("예고·뜸들이기나 본문 의존 표현으로 시작하는 섹션을 찾음", () => {
    const m = { sections: [sec("신청은 복지로에서 해요. 자세히 보면…"), sec("이번에는 신청 방법을 알아보겠습니다. 먼저…"), sec("위에서 말한 기준을 다시 보면…")] };
    expect(notAnswerFirst(m)).toEqual([2, 3]);
  });
});

describe("내부링크 후보 순서", () => {
  const c = (title: string, focusKeyword: string, mainKeyword?: string, tags: string[] = []) => ({ title, url: `https://b/${title}`, focusKeyword, mainKeyword, tags });
  it("필러 → 같은 메인 키워드 → 태그 겹침 → 최근 글, 같은 키워드 글은 제외", () => {
    const out = rankInternalLinks({ keyword: "청년월세 신청 방법", mainKeyword: "청년월세" }, [
      c("최근 글", "연말정산 공제"),
      c("태그 겹침", "주거급여", undefined, ["청년월세"]),
      c("같은 묶음", "청년월세 지급일", "청년월세"),
      c("필러", "청년월세"),
      c("중복", "청년월세 신청 방법"),
    ]);
    expect(out.map((l) => l.title)).toEqual(["필러", "같은 묶음", "태그 겹침", "최근 글"]);
    expect(out[0].pillar).toBe(true);
  });
});
