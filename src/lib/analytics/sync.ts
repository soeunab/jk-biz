import type { Account } from "@prisma/client";
import { db } from "../db";
import { fetchAdsenseRows, fetchGa4Rows, fetchGscRows, ga4PropertyOf, gscSiteOf } from "./google";
import { naverRss } from "../publishers/naver";
import { asObject, daysAgo } from "../util";
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
  if (!ga4PropertyOf(account)) return log(`[${account.name}] GA4 속성 ID 미설정 — 건너뜀`);
  const rows = await fetchGa4Rows(account, { days: 30 });
  const map = await postsByPath(account.id);
  const daily = new Map<string, { pv: number; users: number }>();
  let matched = 0;
  for (const { date: d, pagePath: p, pageviews: pv, users } of rows) {
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
  await log(`[${account.name}] GA4 ${rows.length}행 동기화 (글 매칭 ${matched})`);
}

/** 서치콘솔: 날짜·페이지별 클릭/노출/순위 + 페이지별 상위 검색어 */
async function syncGsc(account: Account, log: Log) {
  if (!gscSiteOf(account)) return log(`[${account.name}] 서치콘솔 사이트 URL 미설정 — 건너뜀`);
  const rows = await fetchGscRows(account, { days: 30, dimensions: ["date", "page"], rowLimit: 25000 });
  const map = await postsByPath(account.id);
  for (const row of rows) {
    const [d, page] = row.keys;
    const postId = map.get(pathOf(page) ?? "");
    if (!postId) continue;
    await upsertPostMetric(postId, new Date(`${d}T00:00:00`), "GSC", {
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position || undefined,
    });
  }
  const q = await fetchGscRows(account, { days: 30, dimensions: ["page", "query"], rowLimit: 5000 });
  const byPost = new Map<string, { query: string; clicks: number; impressions: number; position: number }[]>();
  for (const row of q) {
    const [page, query] = row.keys;
    const postId = map.get(pathOf(page) ?? "");
    if (!postId) continue;
    const arr = byPost.get(postId) ?? [];
    arr.push({ query, clicks: row.clicks, impressions: row.impressions, position: Math.round(row.position * 10) / 10 });
    byPost.set(postId, arr);
  }
  for (const [postId, arr] of byPost) {
    const latest = await db.postMetric.findFirst({ where: { postId, source: "GSC" }, orderBy: { date: "desc" } });
    if (latest) {
      await db.postMetric.update({ where: { id: latest.id }, data: { queries: arr.sort((a, b) => b.impressions - a.impressions).slice(0, 15) } });
    }
  }
  await log(`[${account.name}] 서치콘솔 ${rows.length}행, 검색어 ${q.length}행 동기화`);
}

/** 애드센스: 일별 예상 수익 (도메인별로 계정 매칭) */
async function syncAdsense(account: Account, log: Log) {
  let rows;
  try {
    rows = await fetchAdsenseRows(account, { days: 30 });
  } catch (e) {
    if (/애드센스 계정 없음/.test((e as Error).message)) return log(`[${account.name}] 애드센스 계정 없음 — 건너뜀`);
    throw e;
  }
  for (const { date: d, domain, amount } of rows) {
    const date = new Date(`${d}T00:00:00`);
    await db.revenue.deleteMany({ where: { accountId: account.id, date, source: "ADSENSE" } });
    await db.revenue.create({ data: { accountId: account.id, date, source: "ADSENSE", amount, note: domain } });
  }
  await log(`[${account.name}] 애드센스 ${rows.length}일치 수익 동기화`);
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
