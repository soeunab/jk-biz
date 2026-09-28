import { env } from "../env";
import { naverBlogDocCount, naverSearchAdKeywords } from "./sources";
import { relevance, scoreKeyword } from "./scoring";

export type RelatedRow = {
  keyword: string;
  monthlySearch: number;
  monthlyClicks: number;
  compIdx: string;
  documentCount: number | null;
  priority: number;
  relevance: number;
};

/**
 * 연관 키워드 확장 — 네이버 검색광고 키워드도구의 공식 데이터만 사용합니다 (AI 추측 없음).
 * 문서 수는 네이버 검색 API 가 있을 때 상위 15개만 조회합니다.
 */
export async function relatedKeywords(keyword: string): Promise<RelatedRow[]> {
  if (!env.naverSearchAd) throw new Error("네이버 검색광고 API 키(NAVER_AD_*)가 필요합니다. 공식 검색량 데이터 없이 추측으로 채우지 않습니다.");
  const rows = await naverSearchAdKeywords([keyword]);
  const sorted = rows.sort((a, b) => b.monthlyPc + b.monthlyMobile - (a.monthlyPc + a.monthlyMobile)).slice(0, 50);
  const out: RelatedRow[] = [];
  for (const [i, r] of sorted.entries()) {
    const volume = r.monthlyPc + r.monthlyMobile;
    const docs = i < 15 ? await naverBlogDocCount(r.keyword).catch(() => null) : null;
    const sc = scoreKeyword({ keyword: r.keyword, monthlySearch: volume, documentCount: docs, compIdx: r.compIdx, adDepth: r.adDepth, sources: ["naver-searchad"] });
    out.push({ keyword: r.keyword, monthlySearch: volume, monthlyClicks: r.monthlyClicks, compIdx: r.compIdx, documentCount: docs, priority: sc.total, relevance: relevance(r.keyword) });
  }
  return out;
}
