/**
 * 실시간 채널 발굴 — 데이터 모양 (원본: reference/contents-finder/finder/models.py)
 */
export type ChannelId = "naver_home" | "naver_ranking" | "nate" | "google_trends" | "daum" | "google_news";

export const CHANNEL_IDS: ChannelId[] = ["naver_home", "naver_ranking", "nate", "google_trends", "daum", "google_news"];

/** 채널에서 수집한 항목 하나 (기사·키워드·홈판 글) */
export type ChannelItem = {
  channel: ChannelId | string;
  /** 세부 출처 (예: "네이트 실시간 이슈 키워드", "다음 경제") */
  source: string;
  title: string;
  url?: string;
  rank?: number | null;
  /** 네이버 블로그 카테고리 라벨 (filters.ts 의 CATEGORY_LIST) — 원 채널이 알려준 경우만 */
  category?: string;
  /** 조회수 (네이버 엔터 랭킹) */
  views?: number | null;
  /** 몇 분 전 (기사 시각·트렌드 시작 시각) */
  ageMinutes?: number | null;
  /** 검색량 증가율 % (구글 트렌드) */
  growthPct?: number | null;
  /** 검색량 (구글 트렌드) */
  volume?: number | null;
  /** 같은 사건을 다룬 기사 수 (구글 뉴스) */
  clusterSize?: number | null;
  press?: string;
  extra?: Record<string, unknown>;
};

export type ChannelResult = {
  channel: ChannelId;
  label: string;
  ok: boolean;
  items: ChannelItem[];
  error: string;
  seconds: number;
  notes: string[];
};
