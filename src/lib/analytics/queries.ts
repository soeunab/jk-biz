import { db } from "../db";
import { daysAgo, ymd } from "../util";

const VIEW_SOURCES = ["GA4", "NAVER", "MANUAL"];

export type DailyPoint = { date: string; pageviews: number; clicks: number; impressions: number; revenue: number };

export async function dailySeries(days = 30, accountId?: string): Promise<DailyPoint[]> {
  const since = daysAgo(days);
  const postFilter = accountId ? { post: { accountId } } : {};
  const [metrics, revenues] = await Promise.all([
    db.postMetric.findMany({ where: { date: { gte: since }, ...postFilter }, select: { date: true, source: true, pageviews: true, clicks: true, impressions: true } }),
    db.revenue.findMany({ where: { date: { gte: since }, ...(accountId ? { accountId } : {}) }, select: { date: true, amount: true } }),
  ]);
  const map = new Map<string, DailyPoint>();
  for (let i = days; i >= 1; i--) {
    const d = ymd(daysAgo(i));
    map.set(d, { date: d, pageviews: 0, clicks: 0, impressions: 0, revenue: 0 });
  }
  for (const m of metrics) {
    const p = map.get(ymd(m.date));
    if (!p) continue;
    if (VIEW_SOURCES.includes(m.source)) p.pageviews += m.pageviews;
    if (m.source === "GSC") (p.clicks += m.clicks), (p.impressions += m.impressions);
  }
  for (const r of revenues) {
    const p = map.get(ymd(r.date));
    if (p) p.revenue += r.amount;
  }
  return [...map.values()];
}

export async function revenueBySource(days = 30) {
  const rows = await db.revenue.groupBy({ by: ["source"], where: { date: { gte: daysAgo(days) } }, _sum: { amount: true } });
  return rows.map((r) => ({ source: r.source, amount: r._sum.amount ?? 0 })).sort((a, b) => b.amount - a.amount);
}

export type PostPerf = {
  id: string;
  title: string;
  platform: string;
  account: string;
  status: string;
  remoteUrl: string | null;
  publishedAt: Date | null;
  pageviews: number;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  revenue: number;
  seoScore: number;
  hasAffiliate: boolean;
  hasCardNews: boolean;
  topQueries: { query: string; clicks: number; impressions: number; position: number }[];
};

export async function postPerformance(days = 28): Promise<PostPerf[]> {
  const since = daysAgo(days);
  const posts = await db.post.findMany({
    where: { status: { in: ["PUBLISHED", "PRIVATE", "APPROVED"] } },
    include: {
      account: { select: { name: true } },
      metrics: { where: { date: { gte: since } } },
      revenues: { where: { date: { gte: since } } },
      _count: { select: { cardNews: true } },
    },
  });
  return posts
    .map((p) => {
      const views = p.metrics.filter((m) => VIEW_SOURCES.includes(m.source)).reduce((a, m) => a + m.pageviews, 0);
      const gsc = p.metrics.filter((m) => m.source === "GSC");
      const clicks = gsc.reduce((a, m) => a + m.clicks, 0);
      const impressions = gsc.reduce((a, m) => a + m.impressions, 0);
      const weighted = gsc.reduce((a, m) => a + (m.position ?? 0) * m.impressions, 0);
      const latestQ = [...gsc].sort((a, b) => b.date.getTime() - a.date.getTime()).find((m) => Array.isArray(m.queries) && (m.queries as unknown[]).length);
      const content = (p.content ?? {}) as { affiliate?: unknown[] };
      return {
        id: p.id,
        title: p.title,
        platform: p.platform,
        account: p.account?.name ?? "-",
        status: p.status,
        remoteUrl: p.remoteUrl,
        publishedAt: p.publishedAt,
        pageviews: views,
        clicks,
        impressions,
        ctr: impressions ? clicks / impressions : 0,
        position: impressions ? weighted / impressions : null,
        revenue: p.revenues.reduce((a, r) => a + r.amount, 0),
        seoScore: p.seoScore,
        hasAffiliate: (content.affiliate?.length ?? 0) > 0,
        hasCardNews: p._count.cardNews > 0,
        topQueries: (latestQ?.queries as PostPerf["topQueries"]) ?? [],
      };
    })
    .sort((a, b) => b.pageviews - a.pageviews);
}

export async function accountPerformance(days = 30) {
  const since = daysAgo(days);
  const accounts = await db.account.findMany({
    where: { platform: { in: ["BLOGGER", "NAVER"] } },
    include: {
      posts: { select: { status: true, publishedAt: true, metrics: { where: { date: { gte: since } }, select: { source: true, pageviews: true } } } },
      revenues: { where: { date: { gte: since } }, select: { amount: true } },
    },
  });
  return accounts.map((a) => {
    const pv = a.posts.flatMap((p) => p.metrics).filter((m) => VIEW_SOURCES.includes(m.source)).reduce((s, m) => s + m.pageviews, 0);
    const revenue = a.revenues.reduce((s, r) => s + r.amount, 0);
    return {
      id: a.id,
      name: a.name,
      platform: a.platform,
      published: a.posts.filter((p) => p.status === "PUBLISHED").length,
      publishedRecent: a.posts.filter((p) => p.publishedAt && p.publishedAt >= since).length,
      pageviews: pv,
      revenue,
      rpm: pv ? (revenue / pv) * 1000 : 0,
    };
  });
}

export async function statusCounts() {
  const rows = await db.post.groupBy({ by: ["status"], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Record<string, number>;
}
