export const REVENUE_SOURCE: Record<string, string> = {
  ADSENSE: "구글 애드센스",
  ADPOST: "네이버 애드포스트",
  SHOPPING_CONNECT: "네이버 쇼핑커넥트",
  COUPANG: "쿠팡파트너스",
  OTHER: "기타",
};

export const JOB_LABEL: Record<string, string> = {
  "topic.discover": "주제 발굴",
  "topic.channels": "실시간 트렌드 발굴",
  "topic.cleanup": "보류 주제 정리",
  "post.generate": "원고 생성",
  "post.images": "이미지 생성",
  "post.aiReview": "AI 사실 검수",
  "post.rewriteSection": "섹션 다시 쓰기",
  "post.publishPrivate": "비공개 발행",
  "post.publishPublic": "공개 발행",
  "cardnews.generate": "카드뉴스 생성",
  "cardnews.publish": "SNS 발행",
  "analytics.sync": "분석 동기화",
  "insights.generate": "발전 제안 생성",
};

export const INSIGHT_TYPE: Record<string, { label: string; icon: string }> = {
  GENERAL: { label: "요약", icon: "📊" },
  STRATEGY: { label: "발전 방향", icon: "🧭" },
  RETITLE: { label: "제목 개선", icon: "✏️" },
  REFRESH: { label: "글 보강", icon: "🔄" },
  MONETIZE: { label: "수익화", icon: "💰" },
  NEXT_TOPIC: { label: "다음 주제", icon: "💡" },
  CADENCE: { label: "발행 주기", icon: "📅" },
  CARDNEWS: { label: "카드뉴스", icon: "🖼️" },
};
