export const REVENUE_SOURCE: Record<string, string> = {
  ADSENSE: "구글 애드센스",
  ADPOST: "네이버 애드포스트",
  SHOPPING_CONNECT: "네이버 쇼핑커넥트",
  COUPANG: "쿠팡파트너스",
  MATE: "네이버 메이트",
  BRAND_CONNECT: "브랜드커넥트·협찬",
  SPONSOR: "체험단",
  CLIP: "네이버 클립",
  OTHER: "기타",
};

/** 광고 수익(트래픽 × 단가) — 나머지는 비광고(제휴·인용·협찬) 수익. 수익원 다변화 비중 계산용 */
export const AD_REVENUE_SOURCES = ["ADSENSE", "ADPOST"];

export const JOB_LABEL: Record<string, string> = {
  "topic.discover": "주제 발굴",
  "topic.channels": "실시간 트렌드 발굴",
  "topic.titles": "제목 만들기",
  "topic.cleanup": "보류 주제·황금키워드 정리",
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
  "post.optimize": "기존 글 개선 제안",
  "topic.golden": "황금키워드 발굴",
  "post.syncRemote": "블로그에서 가져오기",
  "post.convertRemote": "블로그 글을 원고로 변환",
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
  AD_DENSITY: { label: "광고 배치", icon: "📐" },
  PRUNE: { label: "저성과 글 정리", icon: "🧹" },
  HOMEFEED_MIX: { label: "홈판·검색 배분", icon: "🏠" },
  YEAR_REFRESH: { label: "연도 갱신", icon: "🔁" },
  EVERGREEN_SIBLING: { label: "짝 주제", icon: "🌲" },
  TITLE_EFFECT: { label: "제목 효과", icon: "📝" },
};
