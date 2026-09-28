import type { ChannelId, ChannelResult } from "../types";
import type { CollectContext } from "./common";
import { collectDaum } from "./daum";
import { collectGoogleNews } from "./googleNews";
import { collectGoogleTrends } from "./googleTrends";
import { collectNate } from "./nate";
import { collectNaverHome } from "./naverHome";
import { collectNaverRanking } from "./naverRanking";

/** 채널 수집기 등록부 (순서 = 표시 순서) */
export const COLLECTORS: Record<ChannelId, { label: string; browser: boolean; collect: (ctx: CollectContext) => Promise<ChannelResult> }> = {
  naver_home: { label: "네이버 모바일 홈판", browser: true, collect: collectNaverHome },
  naver_ranking: { label: "네이버 랭킹 뉴스", browser: true, collect: collectNaverRanking },
  nate: { label: "네이트 실시간 이슈", browser: true, collect: collectNate },
  google_trends: { label: "구글 트렌드", browser: true, collect: collectGoogleTrends },
  daum: { label: "다음 뉴스", browser: true, collect: collectDaum },
  google_news: { label: "구글 뉴스", browser: false, collect: collectGoogleNews },
};

export type { CollectContext };
