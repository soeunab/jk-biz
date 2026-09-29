import { env } from "../env";
import { naverAutocomplete, naverBlogDocCount, naverRelatedSearch, naverSearchAdKeywords } from "./sources";
import { normalizeKeyword, scoreKeyword } from "./scoring";

export type RelatedRow = {
  keyword: string;
  monthlySearch: number;
  monthlyClicks: number;
  compIdx: string;
  documentCount: number | null;
  priority: number;
};

/**
 * 연관 키워드 확장 — 검색량·경쟁도 숫자는 전부 네이버 검색광고 API 의 공식 데이터입니다 (AI 추측 없음).
 * 검색광고 API 의 연관 키워드 확장은 광고주 입찰 데이터 기반이라, 광고 경쟁이 거의 없는 틈새 키워드는
 * 시드 하나만 넣으면 자기 자신 외에 거의 안 나올 수 있습니다. 그래서 아래 두 가지도 "후보 문구"로만 함께
 * 힌트에 넣어 각 문구별 실제 검색량을 조회합니다 (숫자 자체는 이 소스들이 아니라 항상 검색광고 API 결과):
 * - 자동완성(키 불필요, 실제 사용자 검색 기반)
 * - 네이버 통합검색 결과 페이지의 "함께 많이 찾는" 위젯(키 불필요, 화면 스크래핑 — 실패해도 나머지는 진행)
 * 문서 수는 네이버 검색 API 가 있을 때 상위 15개만 조회합니다.
 * 사람이 표를 보고 직접 고르는 수동 도구라 관련성 자동 필터는 두지 않습니다 (특정 브랜드/도메인을 가정하면
 * "삼성전자"처럼 무관한 키워드가 통째로 걸러지는 문제가 있었음).
 */
export async function relatedKeywords(keyword: string): Promise<RelatedRow[]> {
  if (!env.naverSearchAd) throw new Error("네이버 검색광고 API 키(NAVER_AD_*)가 필요합니다. 공식 검색량 데이터 없이 추측으로 채우지 않습니다.");
  const [autocomplete, relatedSearch] = await Promise.all([
    naverAutocomplete(keyword).catch(() => []),
    naverRelatedSearch(keyword).catch(() => []),
  ]);
  const seen = new Set<string>();
  const hints = [keyword, ...autocomplete, ...relatedSearch].filter((k) => {
    const n = normalizeKeyword(k);
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  const rows = await naverSearchAdKeywords(hints);
  const sorted = rows.sort((a, b) => b.monthlyPc + b.monthlyMobile - (a.monthlyPc + a.monthlyMobile)).slice(0, 50);
  const out: RelatedRow[] = [];
  for (const [i, r] of sorted.entries()) {
    const volume = r.monthlyPc + r.monthlyMobile;
    const docs = i < 15 ? await naverBlogDocCount(r.keyword).catch(() => null) : null;
    const sc = scoreKeyword({ keyword: r.keyword, monthlySearch: volume, documentCount: docs, compIdx: r.compIdx, adDepth: r.adDepth, sources: ["naver-searchad"] }, [], true);
    out.push({ keyword: r.keyword, monthlySearch: volume, monthlyClicks: r.monthlyClicks, compIdx: r.compIdx, documentCount: docs, priority: sc.total });
  }
  return out;
}
