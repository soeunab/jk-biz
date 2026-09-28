import { google } from "googleapis";
import type { Account } from "@prisma/client";
import { db } from "../db";
import { accountSettings } from "../content/service";
import { authedClient } from "../publishers/google";
import { naverRss } from "../publishers/naver";
import { asObject, daysAgo, ymd } from "../util";
import type { JobContext } from "../jobs/queue";

type Log = (m: string) => unknown;

function pathOf(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).pathname.replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function postsByPath(accountId: string) {
  const posts = await db.post.findMany({ where: { accountId, remoteUrl: { not: null } }, select: { id: true, remoteUrl: true } });
  return new Map(posts.flatMap((p) => (pathOf(p.remoteUrl) ? [[pathOf(p.remoteUrl)!, p.id] as const] : [])));
}

async function upsertPostMetric(postId: string, date: Date, source: string, data: { pageviews?: number; clicks?: number; impressions?: number; position?: number }) {
  await db.postMetric.upsert({
    where: { postId_date_source: { postId, date, source } },
    create: { postId, date, source, ...data },
    update: data,
  });
}

/** GA4: 날짜·페이지별 조회수 */
async function syncGa4(account: Account, log: Log) {
  const propertyId = accountSettings(account.settings).ga4PropertyId;
  if (!propertyId) return log(`[${account.name}] GA4 속성 ID 미설정 — 건너뜀`);
  const auth = await authedClient(account.id);
  const ga = google.analyticsdata({ version: "v1beta", auth });
  const res = await ga.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
      dimensions: [{ name: "date" }, { name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
      limit: "10000",
    },
  });
  const map = await postsByPath(account.id);
  const daily = new Map<string, { pv: number; users: number }>();
  let matched = 0;
  for (const row of res.data.rows ?? []) {
    const [d, p] = (row.dimensionValues ?? []).map((v) => v.value ?? "");
    const pv = Number(row.metricValues?.[0]?.value ?? 0);
    const users = Number(row.metricValues?.[1]?.value ?? 0);
    const cur = daily.get(d) ?? { pv: 0, users: 0 };
    daily.set(d, { pv: cur.pv + pv, users: cur.users + users });
    const postId = map.get(p.replace(/\/$/, ""));
    if (postId) {
      matched++;
      await upsertPostMetric(postId, parseYmd(d), "GA4", { pageviews: pv });
    }
  }
  for (const [d, v] of daily) {
    const date = parseYmd(d);
    await db.accountMetric.upsert({
      where: { accountId_date_source: { accountId: account.id, date, source: "GA4" } },
      create: { accountId: account.id, date, source: "GA4", pageviews: v.pv, visitors: v.users },
      update: { pageviews: v.pv, visitors: v.users },
    });
  }
  await log(`[${account.name}] GA4 ${res.data.rows?.length ?? 0}행 동기화 (글 매칭 ${matched})`);
}

/** 서치콘솔: 날짜·페이지별 클릭/노출/순위 + 페이지별 상위 검색어 */
async function syncGsc(account: Account, log: Log) {
  const siteUrl = accountSettings(account.settings).gscSiteUrl ?? account.url ?? undefined;
  if (!siteUrl) return log(`[${account.name}] 서치콘솔 사이트 URL 미설정 — 건너뜀`);
  const auth = await authedClient(account.id);
  const sc = google.searchconsole({ version: "v1", auth });
  const range = { startDate: ymd(daysAgo(30)), endDate: ymd(daysAgo(2)) };
  const res = await sc.searchanalytics.query({ siteUrl, requestBody: { ...range, dimensions: ["date", "page"], rowLimit: 25000 } });
  const map = await postsByPath(account.id);
  for (const row of res.data.rows ?? []) {
    const [d, page] = row.keys ?? [];
    const postId = map.get(pathOf(page) ?? "");
    if (!postId) continue;
    await upsertPostMetric(postId, new Date(`${d}T00:00:00`), "GSC", {
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      position: row.position ?? undefined,
    });
  }
  const q = await sc.searchanalytics.query({ siteUrl, requestBody: { ...range, dimensions: ["page", "query"], rowLimit: 5000 } });
  const byPost = new Map<string, { query: string; clicks: number; impressions: number; position: number }[]>();
  for (const row of q.data.rows ?? []) {
    const [page, query] = row.keys ?? [];
    const postId = map.get(pathOf(page) ?? "");
    if (!postId) continue;
    const arr = byPost.get(postId) ?? [];
    arr.push({ query, clicks: row.clicks ?? 0, impressions: row.impressions ?? 0, position: Math.round((row.position ?? 0) * 10) / 10 });
    byPost.set(postId, arr);
  }
  for (const [postId, arr] of byPost) {
    const latest = await db.postMetric.findFirst({ where: { postId, source: "GSC" }, orderBy: { date: "desc" } });
    if (latest) {
      await db.postMetric.update({ where: { id: latest.id }, data: { queries: arr.sort((a, b) => b.impressions - a.impressions).slice(0, 15) } });
    }
  }
  await log(`[${account.name}] 서치콘솔 ${res.data.rows?.length ?? 0}행, 검색어 ${q.data.rows?.length ?? 0}행 동기화`);
}

/** 애드센스: 일별 예상 수익 (도메인별로 계정 매칭) */
async function syncAdsense(account: Account, log: Log) {
  const auth = await authedClient(account.id);
  const adsense = google.adsense({ version: "v2", auth });
  const accounts = await adsense.accounts.list();
  const adAccount = accounts.data.accounts?.[0]?.name;
  if (!adAccount) return log(`[${account.name}] 애드센스 계정 없음 — 건너뜀`);
  const start = daysAgo(30);
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
  let n = 0;
  for (const row of res.data.rows ?? []) {
    const [d, domain] = (row.cells ?? []).map((c) => c.value ?? "");
    if (host && domain && !domain.includes(host) && !host.includes(domain)) continue;
    const date = new Date(`${d}T00:00:00`);
    const amount = Number(row.cells?.[2]?.value ?? 0);
    await db.revenue.deleteMany({ where: { accountId: account.id, date, source: "ADSENSE" } });
    await db.revenue.create({ data: { accountId: account.id, date, source: "ADSENSE", amount, note: domain } });
    n++;
  }
  await log(`[${account.name}] 애드센스 ${n}일치 수익 동기화`);
}

/** 네이버: RSS 로 공개 전환된 글을 찾아 상태·URL 갱신 (사람이 네이버에서 직접 공개한 경우 대응) */
async function syncNaverRss(account: Account, log: Log) {
  if (!account.externalId) return;
  const items = await naverRss(account.externalId).catch(() => []);
  const waiting = await db.post.findMany({ where: { accountId: account.id, status: { in: ["PRIVATE", "APPROVED"] } } });
  let n = 0;
  for (const p of waiting) {
    const hit = items.find((i) => (p.remoteId && i.link.includes(p.remoteId)) || i.title.trim() === p.title.trim());
    if (hit) {
      await db.post.update({ where: { id: p.id }, data: { status: "PUBLISHED", publishedAt: hit.pubDate ? new Date(hit.pubDate) : new Date(), remoteUrl: hit.link.split("?")[0] } });
      n++;
    }
  }
  if (n) await log(`[${account.name}] RSS 에서 공개된 글 ${n}개 확인 → 발행 완료 처리`);
}

/** 데모 계정: 발행된 글에 최근 14일치 가상 지표를 채워 대시보드 흐름을 확인할 수 있게 합니다. */
async function simulateDemo(account: Account) {
  const posts = await db.post.findMany({ where: { accountId: account.id, status: "PUBLISHED" } });
  for (const p of posts) {
    const seed = [...p.id].reduce((a, c) => a + c.charCodeAt(0), 0);
    for (let i = 1; i <= 14; i++) {
      const date = daysAgo(i);
      const base = 20 + (seed % 80);
      const pv = Math.round(base * (1 + Math.sin((seed + i) / 3) * 0.3));
      await upsertPostMetric(p.id, date, account.platform === "NAVER" ? "NAVER" : "GA4", { pageviews: pv });
      if (account.platform === "BLOGGER") {
        const impressions = pv * (4 + (seed % 5));
        await upsertPostMetric(p.id, date, "GSC", { clicks: Math.round(pv * 0.6), impressions, position: 4 + (seed % 15) + Math.sin(i) });
      }
    }
  }
}

export async function syncAnalytics(ctx?: JobContext) {
  const log: Log = (m) => ctx?.log(m);
  const accounts = await db.account.findMany({ where: { active: true } });
  for (const [i, account] of accounts.entries()) {
    const demo = asObject<{ demo?: boolean }>(account.settings, {}).demo === true;
    try {
      if (demo) {
        await simulateDemo(account);
        await log(`[${account.name}] 데모 지표 생성`);
      } else if (account.platform === "BLOGGER" && account.credentials) {
        for (const fn of [syncGa4, syncGsc, syncAdsense]) {
          await fn(account, log).catch((e) => log(`[${account.name}] ${fn.name} 오류: ${(e as Error).message}`));
        }
      } else if (account.platform === "NAVER") {
        await syncNaverRss(account, log);
      }
    } catch (e) {
      await log(`[${account.name}] 동기화 실패: ${(e as Error).message}`);
    }
    await ctx?.progress(((i + 1) / accounts.length) * 100);
  }
  return { accounts: accounts.length };
}

function parseYmd(d: string) {
  // GA4 date 형식: YYYYMMDD
  return new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00`);
}
