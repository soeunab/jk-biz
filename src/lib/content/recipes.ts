import type { Intent } from "../topics/scoring";

/**
 * 글 유형 레시피: 검색의도에 맞는 섹션 순서.
 * 새 유형이 필요하면 여기 목록만 추가하면 됩니다 (코드 수정 불필요).
 */
export type ArticleType = "HOWTO" | "TUTORIAL" | "EXPLAINER" | "COMPARISON" | "REVIEW" | "BUYING_GUIDE";

export const RECIPES: Record<ArticleType, { label: string; sections: string[] }> = {
  HOWTO: {
    label: "사용법(How-to)",
    sections: ["한 문장 정의와 누구에게 필요한지", "시작 전 준비(계정·요금제)", "단계별 따라하기(번호 목록)", "자주 막히는 지점과 해결법", "독자 상황별 활용 예시", "주의사항과 한계"],
  },
  TUTORIAL: {
    label: "실전 튜토리얼",
    sections: ["이 글로 만들 결과물", "준비할 것", "프롬프트 예시와 결과(인용 블록)", "결과 다듬기(후속 질문)", "독자 상황별 응용", "주의사항"],
  },
  EXPLAINER: {
    label: "개념 설명",
    sections: ["한 문장 정의", "왜 중요한가", "핵심 개념 정리", "실제 예시", "흔한 오해와 사실", "다음 단계"],
  },
  COMPARISON: {
    label: "비교·추천",
    sections: ["한눈에 보는 결론(누구에게 무엇)", "비교 기준", "비교표", "항목별 상세 비교", "상황별 추천", "선택 시 주의사항"],
  },
  REVIEW: {
    label: "사용 후기",
    sections: ["어떤 상황에서 써봤는지(경험 자리표시)", "좋았던 점", "아쉬운 점", "요금 대비 가치", "이런 분께 추천·비추천"],
  },
  BUYING_GUIDE: {
    label: "구매 가이드",
    sections: ["구매 전 체크리스트", "선택 기준", "추천 조합(제휴 시 고지)", "결제·구독 방법", "해지·환불 방법"],
  },
};

export function recipeFor(intent: Intent | string | undefined, keyword: string): ArticleType {
  const k = keyword.toLowerCase();
  if (intent === "transactional") return "BUYING_GUIDE";
  if (intent === "commercial") {
    if (/(후기|리뷰|써보니|사용기)/.test(k)) return "REVIEW";
    return "COMPARISON";
  }
  if (/(란|뜻|개념|차이|원리)$|(이란|무엇)/.test(k)) return "EXPLAINER";
  if (/(프롬프트|예시|템플릿|만들기|자동화|활용)/.test(k)) return "TUTORIAL";
  return "HOWTO";
}
