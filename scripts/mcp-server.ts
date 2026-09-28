/**
 * jk-biz MCP 서버 (개발·디버깅용, 읽기 전용) — 맥미니의 Claude Code 세션이 이 앱의 DB·구글 데이터·네이버 화면 점검 결과를 직접 조회합니다.
 * .mcp.json 에 등록되어 있어 이 폴더에서 claude 를 실행하면 자동으로 뜹니다 (처음 한 번 승인).
 *
 * - 서치콘솔·애드센스·GA4 조회는 분석 동기화와 "같은 코드"(src/lib/analytics/google.ts)를 써서,
 *   API 에서 바로 받은 값과 DB 에 동기화된 값을 나란히 보여 줍니다 → 동기화가 맞는지 바로 확인.
 * - 쓰기·발행·삭제 도구는 없습니다. (구글 접근 토큰이 만료돼 갱신되면 새 토큰을 저장하는 것만 예외)
 * - 인증정보(토큰)는 절대 출력하지 않습니다.
 */
import "./load-env";

// stdout 은 MCP 통신 전용 — 다른 모듈의 console.log 가 섞이지 않도록 stderr 로 돌립니다.
console.log = (...a: unknown[]) => console.error(...a);
console.info = console.log;

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Account } from "@prisma/client";
import { db } from "../src/lib/db";
import { getBrand } from "../src/lib/brand";
import { statusCounts } from "../src/lib/analytics/queries";
import { fetchAdsenseRows, fetchGa4Rows, fetchGscRows, ga4PropertyOf, gscSiteOf } from "../src/lib/analytics/google";
import { accountSettings, readManuscript, researchNotesOf } from "../src/lib/content/service";
import { readinessIssues } from "../src/lib/content/readiness";
import type { SeoCheck } from "../src/lib/content/seo";
import { routingSummary } from "../src/lib/llm";
import { daysAgo, ymd } from "../src/lib/util";

const server = new McpServer({ name: "jk-biz", version: "1.0.0" });

type Out = { content: { type: "text"; text: string }[]; isError?: boolean };
const json = (data: unknown): Out => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const error = (message: string): Out => ({ content: [{ type: "text", text: message }], isError: true });

/** 도구 실행 — 오류는 한국어 메시지로 돌려줌 */
function safe<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<Out> => {
    try {
      return json(await fn(args));
    } catch (e) {
      return error((e as Error).message);
    }
  };
}

/** 계정 ID 또는 이름(일부)으로 찾기 */
async function findAccount(ref: string): Promise<Account> {
  const byId = await db.account.findUnique({ where: { id: ref } });
  if (byId) return byId;
  const all = await db.account.findMany();
  const hits = all.filter((a) => a.name.includes(ref) || a.externalId === ref);
  if (hits.length === 1) return hits[0];
  const list = all.map((a) => `${a.id} ${a.name}(${a.platform})`).join(", ");
  throw new Error(hits.length ? `"${ref}" 에 해당하는 계정이 여러 개예요: ${hits.map((a) => a.name).join(", ")}` : `계정 "${ref}" 를 찾지 못했어요. 계정: ${list}`);
}

function googleReady(a: Account) {
  if ((accountSettings(a.settings) as { demo?: boolean }).demo) throw new Error(`"${a.name}" 은 데모 계정이라 구글 데이터가 없어요.`);
  if (a.platform !== "BLOGGER") throw new Error(`"${a.name}" 은 ${a.platform} 계정이에요. 구글 데이터는 블로거 계정에서만 조회합니다.`);
  if (!a.credentials) throw new Error(`"${a.name}" 계정의 구글 연결이 없어요. 대시보드 [계정 관리]에서 구글 연결 후 다시 시도하세요.`);
}

const pathOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).pathname.replace(/\/$/, "") : null;
  } catch {
    return null;
  }
};

async function postPaths(accountId: string) {
  const posts = await db.post.findMany({ where: { accountId, remoteUrl: { not: null } }, select: { id: true, title: true, remoteUrl: true } });
  return new Map(posts.flatMap((p) => (pathOf(p.remoteUrl) ? [[pathOf(p.remoteUrl)!, p] as const] : [])));
}

const accountArg = z.string().describe("계정 ID 또는 계정 이름 일부 (db_summary 에서 확인)");
const daysArg = z.number().int().min(1).max(480).default(28).describe("조회 기간(일)");

server.registerTool(
  "db_summary",
  { title: "앱 현황 요약", description: "원고 상태별 개수, 검수·수동 입력 대기, 작업 큐, 계정 목록(연동 여부), 작업별 담당 AI 를 요약합니다." },
  safe(async () => {
    const [counts, manual, jobs, accounts, routes] = await Promise.all([
      statusCounts(),
      db.manualRequest.count({ where: { status: "PENDING" } }),
      db.job.groupBy({ by: ["status"], _count: { _all: true } }),
      db.account.findMany({ orderBy: [{ platform: "asc" }, { createdAt: "asc" }] }),
      routingSummary(),
    ]);
    return {
      posts: counts,
      reviewWaiting: (counts.PRIVATE ?? 0) + (counts.APPROVED ?? 0),
      manualPending: manual,
      jobs: Object.fromEntries(jobs.map((j) => [j.status, j._count._all])),
      ai: routes.map((r) => ({ task: r.label, provider: r.providerLabel, cost: r.cost })),
      accounts: accounts.map((a) => {
        const s = accountSettings(a.settings) as Record<string, unknown>;
        return {
          id: a.id,
          name: a.name,
          platform: a.platform,
          active: a.active,
          demo: s.demo === true,
          blogId: a.externalId,
          url: a.url,
          googleConnected: !!a.credentials && a.platform === "BLOGGER",
          ga4PropertyId: s.ga4PropertyId ?? null,
          gscSiteUrl: s.gscSiteUrl ?? null,
          concept: a.concept,
        };
      }),
    };
  }),
);

server.registerTool(
  "list_posts",
  {
    title: "원고 목록",
    description: "원고 목록 (최근 수정 순). 상태: GENERATING, WAITING_MANUAL, DRAFT, PRIVATE(검수 대기), APPROVED, PUBLISHED, REJECTED, FAILED",
    inputSchema: { status: z.string().optional(), account: z.string().optional().describe("계정 ID 또는 이름 일부"), limit: z.number().int().min(1).max(100).default(20) },
  },
  safe(async ({ status, account, limit }: { status?: string; account?: string; limit: number }) => {
    const acc = account ? await findAccount(account) : null;
    const posts = await db.post.findMany({
      where: { ...(status ? { status } : {}), ...(acc ? { accountId: acc.id } : {}) },
      include: { account: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    return posts.map((p) => ({
      id: p.id,
      title: p.title,
      platform: p.platform,
      account: p.account?.name ?? null,
      status: p.status,
      seoScore: p.seoScore,
      focusKeyword: p.focusKeyword,
      remoteUrl: p.remoteUrl,
      republishOf: p.sourcePostId,
      error: p.error?.split("\n")[0] ?? null,
      updatedAt: p.updatedAt.toISOString(),
    }));
  }),
);

server.registerTool(
  "post_detail",
  {
    title: "원고 상세",
    description: "원고 한 편의 점검 결과(SEO·AEO·GEO), 승인 전 확인 사항, AI 사실 검수, 조사 출처, 최근 지표, 오류를 보여줍니다.",
    inputSchema: { id: z.string() },
  },
  safe(async ({ id }: { id: string }) => {
    const post = await db.post.findUnique({ where: { id }, include: { account: true, source: { select: { id: true, title: true, remoteUrl: true } } } });
    if (!post) throw new Error(`원고 ${id} 가 없어요.`);
    const m = readManuscript(post.content);
    const report = post.seoReport as { checks?: SeoCheck[]; similarity?: { warn: boolean; max: number; with: { title: string } | null }; republish?: { sourceTitle: string; sourceUrl: string | null; similarity: number; warn: boolean } | null } | null;
    const issues = m
      ? readinessIssues(m, {
          brand: await getBrand(),
          similarity: report?.similarity,
          renderedHtml: post.html,
          researchNotes: researchNotesOf(post.research),
          republish: report?.republish ?? null,
          accountConcept: post.account ? post.account.concept : undefined,
        })
      : [];
    const metrics = await db.postMetric.groupBy({
      by: ["source"],
      where: { postId: id, date: { gte: daysAgo(30) } },
      _sum: { pageviews: true, clicks: true, impressions: true },
    });
    const manual = await db.manualRequest.findMany({ where: { postId: id, status: "PENDING" }, select: { id: true, title: true, createdAt: true } });
    return {
      id: post.id,
      title: post.title,
      status: post.status,
      platform: post.platform,
      account: post.account?.name ?? null,
      remoteUrl: post.remoteUrl,
      republishOf: post.source,
      seoScore: post.seoScore,
      failedChecks: (report?.checks ?? []).filter((c) => !c.pass).map((c) => `${c.label} — ${c.detail}`),
      similarity: report?.similarity ?? null,
      readinessIssues: issues.map((i) => i.message),
      aiReview: post.aiReview,
      researchSources: (post.research as { sources?: unknown } | null)?.sources ?? [],
      reviewChecklist: m?.reviewChecklist ?? [],
      metrics30d: metrics.map((x) => ({ source: x.source, ...x._sum })),
      manualPending: manual,
      reviewerNote: post.reviewerNote,
      error: post.error,
    };
  }),
);

server.registerTool(
  "recent_jobs",
  {
    title: "최근 작업",
    description: "백그라운드 작업(원고 생성·발행·동기화 등) 최근 기록과 로그 끝부분 — 실패 원인 확인용",
    inputSchema: { status: z.enum(["QUEUED", "RUNNING", "WAITING", "DONE", "FAILED"]).optional(), limit: z.number().int().min(1).max(50).default(10) },
  },
  safe(async ({ status, limit }: { status?: string; limit: number }) => {
    const jobs = await db.job.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: limit });
    return jobs.map((j) => ({ id: j.id, type: j.type, status: j.status, attempts: j.attempts, createdAt: j.createdAt.toISOString(), error: j.error, logTail: j.log.split("\n").slice(-12).join("\n") }));
  }),
);

server.registerTool(
  "ga4_report",
  {
    title: "GA4 조회수 (API ↔ DB 비교)",
    description: "블로거 계정의 GA4 페이지별 조회수를 API 에서 바로 받고, DB 에 동기화된 글별 조회수(PostMetric GA4)와 나란히 보여줍니다.",
    inputSchema: { account: accountArg, days: daysArg, pagePath: z.string().optional().describe("이 경로로 시작하는 페이지만 (예: /2026/09/)") },
  },
  safe(async ({ account, days, pagePath }: { account: string; days: number; pagePath?: string }) => {
    const a = await findAccount(account);
    googleReady(a);
    if (!ga4PropertyOf(a)) throw new Error(`"${a.name}" 의 GA4 속성 ID 가 설정되지 않았어요 ([계정 관리] → 분석 설정).`);
    const rows = await fetchGa4Rows(a, { days, pagePath });
    const byPath = new Map<string, number>();
    for (const r of rows) byPath.set(r.pagePath.replace(/\/$/, ""), (byPath.get(r.pagePath.replace(/\/$/, "")) ?? 0) + r.pageviews);
    const paths = await postPaths(a.id);
    const dbRows = await db.postMetric.groupBy({ by: ["postId"], where: { source: "GA4", date: { gte: daysAgo(days) }, post: { accountId: a.id } }, _sum: { pageviews: true } });
    const dbByPost = new Map(dbRows.map((r) => [r.postId, r._sum.pageviews ?? 0]));
    const pages = [...byPath].sort((x, y) => y[1] - x[1]).slice(0, 50).map(([p, pv]) => {
      const post = paths.get(p);
      return { pagePath: p, apiPageviews: pv, post: post ? { id: post.id, title: post.title, dbPageviews: dbByPost.get(post.id) ?? 0 } : null };
    });
    return {
      account: a.name,
      period: `${days}일 (어제까지)`,
      apiTotal: rows.reduce((s, r) => s + r.pageviews, 0),
      dbTotalMatchedPosts: [...dbByPost.values()].reduce((s, v) => s + v, 0),
      note: "apiPageviews 와 dbPageviews 가 크게 다르면 URL 매칭(remoteUrl 경로) 또는 동기화 기간을 확인하세요. DB 는 마지막 동기화 시점 값입니다.",
      pages,
    };
  }),
);

server.registerTool(
  "gsc_query",
  {
    title: "서치콘솔 검색 실적 (API ↔ DB 비교)",
    description: "블로거 계정의 서치콘솔 클릭·노출·CTR·평균순위를 조회합니다. by=page 면 DB 에 동기화된 글별 값과 비교합니다. 데이터는 2일 전까지.",
    inputSchema: {
      account: accountArg,
      days: daysArg,
      by: z.enum(["query", "page", "date"]).default("query"),
      keyword: z.string().optional().describe("검색어에 포함된 문자열로 필터"),
      page: z.string().optional().describe("페이지 URL 에 포함된 문자열로 필터"),
      limit: z.number().int().min(1).max(200).default(30),
    },
  },
  safe(async ({ account, days, by, keyword, page, limit }: { account: string; days: number; by: "query" | "page" | "date"; keyword?: string; page?: string; limit: number }) => {
    const a = await findAccount(account);
    googleReady(a);
    if (!gscSiteOf(a)) throw new Error(`"${a.name}" 의 서치콘솔 사이트 URL 이 없어요.`);
    const rows = await fetchGscRows(a, { days, dimensions: [by], query: keyword, page, rowLimit: 1000 });
    rows.sort((x, y) => (by === "date" ? x.keys[0].localeCompare(y.keys[0]) : y.impressions - x.impressions));
    let dbByPost = new Map<string, { clicks: number; impressions: number }>();
    const paths = by === "page" ? await postPaths(a.id) : new Map();
    if (by === "page") {
      const g = await db.postMetric.groupBy({ by: ["postId"], where: { source: "GSC", date: { gte: daysAgo(days) }, post: { accountId: a.id } }, _sum: { clicks: true, impressions: true } });
      dbByPost = new Map(g.map((r) => [r.postId, { clicks: r._sum.clicks ?? 0, impressions: r._sum.impressions ?? 0 }]));
    }
    return {
      account: a.name,
      site: gscSiteOf(a),
      period: `${ymd(daysAgo(days))} ~ ${ymd(daysAgo(2))}`,
      rows: rows.slice(0, limit).map((r) => {
        const base = { [by]: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: Math.round(r.ctr * 1000) / 10, position: Math.round(r.position * 10) / 10 };
        if (by !== "page") return base;
        const post = paths.get(pathOf(r.keys[0]) ?? "");
        return { ...base, post: post ? { id: post.id, title: post.title, db: dbByPost.get(post.id) ?? null } : null };
      }),
    };
  }),
);

server.registerTool(
  "adsense_report",
  {
    title: "애드센스 수익 (API ↔ DB 비교)",
    description: "블로거 계정 도메인의 애드센스 일별 예상 수익을 API 에서 받고, DB 에 저장된 수익(Revenue ADSENSE)과 날짜별로 비교합니다.",
    inputSchema: { account: accountArg, days: daysArg },
  },
  safe(async ({ account, days }: { account: string; days: number }) => {
    const a = await findAccount(account);
    googleReady(a);
    const rows = await fetchAdsenseRows(a, { days });
    const dbRows = await db.revenue.findMany({ where: { accountId: a.id, source: "ADSENSE", date: { gte: daysAgo(days) } } });
    const dbByDate = new Map<string, number>();
    for (const r of dbRows) dbByDate.set(ymd(r.date), (dbByDate.get(ymd(r.date)) ?? 0) + r.amount);
    const daily = rows.map((r) => ({ date: r.date, domain: r.domain, apiKRW: r.amount, dbKRW: dbByDate.get(r.date) ?? null }));
    return {
      account: a.name,
      currency: "KRW (예상 수익)",
      apiTotal: Math.round(rows.reduce((s, r) => s + r.amount, 0)),
      dbTotal: Math.round([...dbByDate.values()].reduce((s, v) => s + v, 0)),
      mismatches: daily.filter((d) => d.dbKRW === null || Math.abs(d.dbKRW - d.apiKRW) >= 1).length,
      daily,
    };
  }),
);

server.registerTool(
  "list_manual_tasks",
  { title: "수동 입력 대기 목록", description: "수동 모드(또는 구독 한도 초과로 전환)에서 결과 붙여넣기를 기다리는 AI 작업 목록" },
  safe(async () => {
    const rows = await db.manualRequest.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
    return rows.map((r) => ({ id: r.id, title: r.title, jobType: r.jobType, schema: r.schemaName, postId: r.postId, cardNewsId: r.cardNewsId, reason: r.error, createdAt: r.createdAt.toISOString() }));
  }),
);

server.registerTool(
  "naver_selector_check",
  {
    title: "네이버 에디터 선택자 점검",
    description: "저장된 로그인 세션으로 네이버 글쓰기 화면을 열어 자동화 선택자(SELECTORS)가 아직 맞는지 확인합니다. 글은 쓰지 않고, 발행 설정 창은 열어만 봅니다. 스크린샷·HTML 경로를 돌려줍니다.",
    inputSchema: { account: accountArg },
  },
  safe(async ({ account }: { account: string }) => {
    const a = await findAccount(account);
    if (a.platform !== "NAVER") throw new Error(`"${a.name}" 은 네이버 계정이 아니에요.`);
    const { runNaverCheck } = await import("../src/lib/publishers/naver");
    return runNaverCheck(a.id);
  }),
);

async function main() {
  await server.connect(new StdioServerTransport());
  console.error("jk-biz MCP 서버 실행 중 (읽기 전용)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
