import { google } from "googleapis";
import type { Account } from "@prisma/client";
import { accountSettings } from "../content/service";
import { authedClient } from "../publishers/google";
import { daysAgo, ymd } from "../util";

/**
 * 구글 데이터 조회 함수 (읽기 전용) — 분석 동기화(sync.ts)와 개발용 MCP 서버(scripts/mcp-server.ts)가 같은 코드를 씁니다.
 * 그래서 MCP 로 본 값과 DB 에 동기화된 값을 비교하면 동기화 로직이 맞는지 바로 확인할 수 있어요.
 */

export type Ga4Row = { date: string; pagePath: string; pageviews: number; users: number };
export type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
export type AdsenseRow = { date: string; domain: string; amount: number };

export function ga4PropertyOf(account: Account) {
  return accountSettings(account.settings).ga4PropertyId;
}

export function gscSiteOf(account: Account) {
  return accountSettings(account.settings).gscSiteUrl ?? account.url ?? undefined;
}

/** GA4 날짜·페이지별 조회수 (어제까지 days 일) */
export async function fetchGa4Rows(account: Account, opts: { days?: number; pagePath?: string } = {}): Promise<Ga4Row[]> {
  const propertyId = ga4PropertyOf(account);
  if (!propertyId) throw new Error(`[${account.name}] GA4 속성 ID 미설정`);
  const auth = await authedClient(account.id);
  const ga = google.analyticsdata({ version: "v1beta", auth });
  const res = await ga.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate: `${opts.days ?? 30}daysAgo`, endDate: "yesterday" }],
      dimensions: [{ name: "date" }, { name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
      ...(opts.pagePath ? { dimensionFilter: { filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: opts.pagePath } } } } : {}),
      limit: "10000",
    },
  });
  return (res.data.rows ?? []).map((row) => {
    const [date, pagePath] = (row.dimensionValues ?? []).map((v) => v.value ?? "");
    return { date, pagePath, pageviews: Number(row.metricValues?.[0]?.value ?? 0), users: Number(row.metricValues?.[1]?.value ?? 0) };
  });
}

/** 서치콘솔 검색 실적 (데이터 지연을 감안해 2일 전까지) */
export async function fetchGscRows(
  account: Account,
  opts: { days?: number; dimensions: ("date" | "page" | "query")[]; page?: string; query?: string; rowLimit?: number },
): Promise<GscRow[]> {
  const siteUrl = gscSiteOf(account);
  if (!siteUrl) throw new Error(`[${account.name}] 서치콘솔 사이트 URL 미설정`);
  const auth = await authedClient(account.id);
  const sc = google.searchconsole({ version: "v1", auth });
  const filters = [
    ...(opts.page ? [{ dimension: "page", operator: "contains", expression: opts.page }] : []),
    ...(opts.query ? [{ dimension: "query", operator: "contains", expression: opts.query }] : []),
  ];
  const res = await sc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: ymd(daysAgo(opts.days ?? 30)),
      endDate: ymd(daysAgo(2)),
      dimensions: opts.dimensions,
      rowLimit: opts.rowLimit ?? 25000,
      ...(filters.length ? { dimensionFilterGroups: [{ filters }] } : {}),
    },
  });
  return (res.data.rows ?? []).map((r) => ({ keys: r.keys ?? [], clicks: r.clicks ?? 0, impressions: r.impressions ?? 0, ctr: r.ctr ?? 0, position: r.position ?? 0 }));
}

/** 애드센스 일별 예상 수익 (이 계정의 도메인만) */
export async function fetchAdsenseRows(account: Account, opts: { days?: number } = {}): Promise<AdsenseRow[]> {
  const auth = await authedClient(account.id);
  const adsense = google.adsense({ version: "v2", auth });
  const accounts = await adsense.accounts.list();
  const adAccount = accounts.data.accounts?.[0]?.name;
  if (!adAccount) throw new Error(`[${account.name}] 애드센스 계정 없음`);
  const start = daysAgo(opts.days ?? 30);
  const end = daysAgo(1);
  const res = await adsense.accounts.reports.generate({
    account: adAccount,
    dateRange: "CUSTOM",
    "startDate.year": start.getFullYear(),
    "startDate.month": start.getMonth() + 1,
    "startDate.day": start.getDate(),
    "endDate.year": end.getFullYear(),
    "endDate.month": end.getMonth() + 1,
    "endDate.day": end.getDate(),
    dimensions: ["DATE", "DOMAIN_NAME"],
    metrics: ["ESTIMATED_EARNINGS"],
    currencyCode: "KRW",
  });
  const host = account.url ? new URL(account.url).hostname : null;
  return (res.data.rows ?? []).flatMap((row) => {
    const [date, domain] = (row.cells ?? []).map((c) => c.value ?? "");
    if (host && domain && !domain.includes(host) && !host.includes(domain)) return [];
    return [{ date, domain, amount: Number(row.cells?.[2]?.value ?? 0) }];
  });
}
