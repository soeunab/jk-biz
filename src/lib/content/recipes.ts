import type { Intent } from "../topics/scoring";

/**
 * 글 유형 레시피: 검색의도에 맞는 섹션 순서.
 * 새 유형이 필요하면 여기 목록만 추가하면 됩니다 (코드 수정 불필요).
 */
export type ArticleType = "HOWTO" | "TUTORIAL" | "EXPLAINER" | "COMPARISON" | "REVIEW" | "BUYING_GUIDE" | "CONDITION" | "HOMEFEED";

export const RECIPES: Record<ArticleType, { label: string; sections: string[] }> = {
  HOWTO: {
    label: "사용법(How-to)",
    sections: ["한 문장 정의와 누구에게 필요한지", "시작 전 준비(필요한 것·비용)", "단계별 따라하기(번호 목록, 직접 해 본 화면은 경험 자리표시)", "자주 막히는 지점과 해결법", "독자 상황별 활용 예시", "주의사항과 한계"],
  },
  TUTORIAL: {
    label: "실전 튜토리얼",
    sections: ["이 글로 만들 결과물", "준비할 것", "실제 예시와 결과(인용 블록, 직접 해 본 결과는 경험 자리표시)", "결과 다듬기", "독자 상황별 응용", "주의사항"],
  },
  EXPLAINER: {
    label: "개념 설명",
    sections: ["한 문장 정의", "왜 중요한가", "핵심 개념 정리", "실제 예시", "흔한 오해와 사실", "다음 단계"],
  },
  COMPARISON: {
    label: "비교·추천",
    sections: ["한눈에 보는 결론(누구에게 무엇)", "비교 기준", "비교표", "항목별 상세 비교(직접 써 본 차이는 경험 자리표시)", "상황별 추천", "선택 시 주의사항"],
  },
  REVIEW: {
    label: "사용 후기",
    sections: ["어떤 상황에서 써봤는지(경험 자리표시)", "좋았던 점", "아쉬운 점(판매 페이지에 없는 단점, 경험 자리표시)", "가격 대비 가치", "이런 분께 추천·비추천"],
  },
  BUYING_GUIDE: {
    label: "구매 가이드",
    sections: ["구매 전 체크리스트", "선택 기준", "추천 조합(제휴 시 고지)", "결제·구독 방법", "해지·환불 방법"],
  },
  HOMEFEED: {
    label: "홈피드형(네이버 홈판)",
    sections: [
      "첫 문장 후킹 — 독자가 몰랐거나 잘못 알던 사실로 바로 시작(제목이 던진 궁금증의 답을 본문 첫 1/3 안에)",
      "무슨 일인지 한눈에(확인된 사실만)",
      "내 생활에 어떤 영향이 있는지",
      "지금 확인하거나 해 볼 것",
      "직접 겪거나 확인한 이야기(경험 자리표시)",
    ],
  },
  CONDITION: {
    label: "조건 해석(대상·기준)",
    sections: [
      "한 문장 결론: 누가 받을 수 있고 누가 안 되는지",
      "대상·제외 조건(표로)",
      "기준 계산법(소득·건강보험료·재산 등, 공식 기준과 예시)",
      "신청 방법·기한(직접 신청한 화면은 경험 자리표시)",
      "자주 헷갈리거나 탈락하는 경우",
      "공식 확인처와 문의처",
    ],
  },
};

export function recipeFor(intent: Intent | string | undefined, keyword: string): ArticleType {
  const k = keyword.toLowerCase();
  if (intent === "transactional") return "BUYING_GUIDE";
  if (intent === "commercial") {
    if (/(후기|리뷰|써보니|사용기)/.test(k)) return "REVIEW";
    return "COMPARISON";
  }
  // 정책·지원금처럼 "내가 해당되나"를 따지는 질의 — AI 요약이 대신하기 어려운 조건 해석형
  if (/(지원금|장려금|수당|지원 ?대상|대상자|자격|조건|소득 ?기준|기준 ?중위소득|신청 ?방법|신청 ?기간|환급|감면|공제 ?대상)/.test(k)) return "CONDITION";
  if (/(란|뜻|개념|차이|원리)$|(이란|무엇)/.test(k)) return "EXPLAINER";
  if (/(프롬프트|예시|템플릿|만들기|자동화|활용)/.test(k)) return "TUTORIAL";
  return "HOWTO";
}
