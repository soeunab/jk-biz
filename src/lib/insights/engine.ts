import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { getBrand } from "../brand";
import { generateJson } from "../llm";
import { accountPerformance, postPerformance, revenueBySource, type PostPerf } from "../analytics/queries";
import { daysAgo, formatKRW, formatNumber } from "../util";
import type { JobContext } from "../jobs/queue";
import { evergreenSibling, type TitlePlan } from "../topics/titleRules";
import { normalizeKeyword } from "../topics/scoring";

type NewInsight = { type: string; priority: number; title: string; body: string; postId?: string; data?: Record<string, unknown> };

/** 규칙 기반 개선 제안 — 데이터로 바로 판단 가능한 항목 */
export function ruleInsights(
  posts: PostPerf[],
  accounts: Awaited<ReturnType<typeof accountPerformance>>,
  backlog: { id: string; title: string; privateAt: Date | null }[],
  /** 운영자가 정한 발행 리듬 (플랫폼 공식 기준이 아님) */
  targetPerWeek = 3,
): NewInsight[] {
  const out: NewInsight[] = [];
  const published = posts.filter((p) => p.status === "PUBLISHED");

  for (const p of published) {
    if (p.impressions >= 200 && p.ctr < 0.02) {
      out.push({
        type: "RETITLE", priority: 1, postId: p.id,
        title: `제목·설명 개선: ${p.title}`,
        body: `노출 ${formatNumber(p.impressions)}회 대비 클릭률 ${(p.ctr * 100).toFixed(1)}%로 낮아요. 검색어(${p.topQueries.slice(0, 3).map((q) => q.query).join(", ") || "상위 검색어"})를 제목 맨 앞에 넣고, 독자가 얻을 답(방법·조건·비교·가격)을 40자 안팎으로 분명히 해 보세요. 독자층 단어(직장인 등)·월·일 표기는 빼는 게 좋아요.`,
        data: { impressions: p.impressions, ctr: p.ctr },
      });
    }
    if (p.position !== null && p.position >= 8 && p.position <= 20 && p.impressions >= 50) {
      out.push({
        type: "REFRESH", priority: 1, postId: p.id,
        title: `2페이지 → 1페이지 끌어올리기: ${p.title}`,
        body: `평균 순위 ${p.position.toFixed(1)}위예요. FAQ 2~3개 추가, 최신 기준일 업데이트, 비교표·직접 캡처 이미지를 보강하면 1페이지 진입 가능성이 높아요.`,
        data: { position: p.position },
      });
    }
  }

  const topCut = [...published].sort((a, b) => b.pageviews - a.pageviews).slice(0, Math.max(3, Math.ceil(published.length * 0.2)));
  for (const p of topCut) {
    if (p.pageviews < 30) continue;
    if (!p.hasAffiliate) {
      out.push({
        type: "MONETIZE", priority: 2, postId: p.id,
        title: `수익화 링크 추가: ${p.title}`,
        body: `최근 조회수 ${formatNumber(p.pageviews)}회로 상위 글이에요. ${p.platform === "NAVER" ? "쇼핑커넥트" : "쿠팡파트너스 등 제휴"} 상품(노트북·키보드·AI 관련 도서 등)을 1~2개 자연스럽게 연결해 보세요.`,
      });
    }
    if (!p.hasCardNews) {
      out.push({
        type: "CARDNEWS", priority: 3, postId: p.id,
        title: `카드뉴스로 재활용: ${p.title}`,
        body: "검색에서 반응이 검증된 글이에요. 카드뉴스로 만들어 인스타그램·스레드로 확산하면 추가 유입과 브랜드 인지도를 얻을 수 있어요.",
      });
    }
  }

  for (const a of accounts) {
    const perWeek = a.publishedRecent / 4.3;
    if (perWeek < targetPerWeek) {
      out.push({
        type: "CADENCE", priority: 2,
        title: `발행 주기 부족: ${a.name}`,
        body: `최근 30일 주당 ${perWeek.toFixed(1)}개 발행했어요. 꾸준히 발행하면 독자가 다시 찾아올 이유가 생기고 주제 묶음(내부 링크)도 촘촘해져요. 정해 둔 리듬(주 ${targetPerWeek}개)은 운영 목표일 뿐 플랫폼 공식 기준은 아니니, 품질을 해치지 않는 선에서 맞춰 보세요.`,
        data: { accountId: a.id },
      });
    }
  }

  // 저성과 글 정리 후보 — 발행 90일이 지났는데 최근 28일 조회·검색 클릭이 거의 없음 (사이트 전체 품질 신호를 끌어내림)
  for (const p of published) {
    if (!p.publishedAt || p.publishedAt > daysAgo(90)) continue;
    if (p.pageviews >= 5 || p.clicks >= 2) continue;
    out.push({
      type: "PRUNE", priority: 3, postId: p.id,
      title: `저성과 글 정리: ${p.title}`,
      body: `발행 90일이 지났는데 최근 4주 조회 ${p.pageviews}회·검색 클릭 ${p.clicks}회예요. 검색엔진은 사이트 전체 품질을 보므로 개선·비슷한 글로 합치기·삭제 중 하나를 검토하세요. [AI 제안 만들기]로 판단을 도와받을 수 있어요.`,
    });
  }

  const stale = backlog.filter((b) => b.privateAt && b.privateAt < daysAgo(3));
  if (stale.length) {
    out.push({
      type: "GENERAL", priority: 1,
      title: `검수 대기 ${stale.length}건`,
      body: `비공개 발행 후 3일 넘게 검수를 기다리는 글이 있어요: ${stale.slice(0, 3).map((s) => s.title).join(" / ")}`,
    });
  }

  // 상위 검색어 중 전용 글이 없는 것 → 다음 주제 후보
  const titles = posts.map((p) => p.title.replace(/\s/g, ""));
  const gaps = new Map<string, number>();
  for (const p of published) {
    for (const q of p.topQueries) {
      if (q.impressions >= 20 && !titles.some((t) => t.includes(q.query.replace(/\s/g, "")))) {
        gaps.set(q.query, (gaps.get(q.query) ?? 0) + q.impressions);
      }
    }
  }
  const gapList = [...gaps].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (gapList.length) {
    out.push({
      type: "NEXT_TOPIC", priority: 2,
      title: "검색어 기반 신규 주제 후보",
      body: `이미 노출되고 있지만 전용 글이 없는 검색어예요: ${gapList.map(([q, n]) => `"${q}"(${n}회)`).join(", ")}. [주제 발굴]에서 시드 키워드로 넣어 보세요.`,
      data: { seeds: gapList.map(([q]) => q) },
    });
  }
  return out;
}

/**
 * 광고·상품 밀도 vs 체류시간 — 광고가 많은 글이 실제로 덜 읽히는지 데이터로 비교합니다 (블로거, GA4 참여 시간 기준).
 * 묶음마다 글 3개 이상, 차이 15% 이상일 때만 제안 (적은 표본으로 단정하지 않게).
 */
export function adDensityInsight(posts: PostPerf[]): NewInsight | null {
  const measured = posts.filter((p) => p.platform === "BLOGGER" && p.status === "PUBLISHED" && p.engagementSec != null && p.pageviews >= 20);
  const avg = (ps: PostPerf[]) => ps.reduce((a, p) => a + (p.engagementSec ?? 0), 0) / Math.max(1, ps.reduce((a, p) => a + p.pageviews, 0));
  const groups: { label: string; heavy: PostPerf[]; light: PostPerf[]; advice: string }[] = [
    {
      label: "광고 2개 이상",
      heavy: measured.filter((p) => p.adUnits >= 2),
      light: measured.filter((p) => p.adUnits <= 1),
      advice: "새 원고는 광고를 글 길이에 맞춰 1~2개만 넣고 있어요. 애드센스 콘솔의 자동광고(페이지 내 광고)가 켜져 있다면 줄이거나 끄는 것도 검토해 보세요.",
    },
    {
      label: "제휴 상품이 있는",
      heavy: measured.filter((p) => p.hasAffiliate),
      light: measured.filter((p) => !p.hasAffiliate),
      advice: "상품은 글당 1~2개, 실제로 관련 있는 섹션에만 두고 광고와 붙지 않게 하세요.",
    },
  ];
  const lines: string[] = [];
  for (const g of groups) {
    if (g.heavy.length < 3 || g.light.length < 3) continue;
    const h = avg(g.heavy);
    const l = avg(g.light);
    if (!l || (l - h) / l < 0.15) continue;
    lines.push(`${g.label} 글(${g.heavy.length}개)의 조회당 체류시간이 ${Math.round(h)}초로, 나머지(${g.light.length}개) ${Math.round(l)}초보다 ${Math.round(((l - h) / l) * 100)}% 짧아요. ${g.advice}`);
  }
  if (!lines.length) return null;
  return { type: "AD_DENSITY", priority: 2, title: "광고·상품이 많은 글의 체류시간이 짧아요", body: lines.join("\n") };
}

/**
 * 네이버 계정별 홈판형:검색형 비율 — 플레이북의 "홈판 7 : 검색 3"(홈판으로 방문자·이웃을 키우고 검색 글로 수익).
 * 이 비율은 실무자 경험칙(검증되지 않은 2차 자료)이라 목표값은 NAVER_HOMEFEED_RATIO 로 바꿀 수 있고, 차이가 클 때만 알립니다.
 */
export function homefeedMixInsights(rows: { accountId: string; accountName: string; format: string }[], target = 0.7): NewInsight[] {
  const byAccount = new Map<string, { name: string; home: number; total: number }>();
  for (const r of rows) {
    const cur = byAccount.get(r.accountId) ?? { name: r.accountName, home: 0, total: 0 };
    cur.total++;
    if (r.format === "HOMEFEED") cur.home++;
    byAccount.set(r.accountId, cur);
  }
  const out: NewInsight[] = [];
  for (const [accountId, a] of byAccount) {
    if (a.total < 4) continue; // 표본이 적으면 판단하지 않음
    const share = a.home / a.total;
    if (Math.abs(share - target) < 0.2) continue;
    const t = Math.round(target * 10);
    out.push({
      type: "HOMEFEED_MIX",
      priority: 3,
      title: `홈판형·검색형 비율: ${a.name}`,
      body:
        share < target
          ? `최근 30일 네이버 글 ${a.total}개 중 홈판형이 ${a.home}개(${Math.round(share * 100)}%)예요. 홈판형 글로 방문자·이웃을 키우고 검색형 글로 수익을 내는 배분(홈판 ${t} : 검색 ${10 - t}, 실무자 경험칙)에 비해 홈판형이 적어요. 실시간 트렌드 주제를 홈판형으로 써 보세요.`
          : `최근 30일 네이버 글 ${a.total}개 중 홈판형이 ${a.home}개(${Math.round(share * 100)}%)예요. 수익은 주로 검색형 글(쇼핑커넥트·AI 브리핑 인용)에서 나오니 검색형 글도 꾸준히 섞어 주세요.`,
      data: { accountId, share },
    });
  }
  return out;
}

export type TitlePerf = { id: string; title: string; focusKeyword: string; publishedAt: Date | null; plan: TitlePlan | null; pageviews: number; impressions: number; clicks: number };

/**
 * 제목 전략 제안 (제안만, 공개된 글을 자동으로 고치지 않음)
 * - 🔁 해마다 반복 글: 제목 연도가 지났거나 12월이면 다음 해 연도로 갱신 제안
 * - ⚡ 이슈형 글: 발행 2주 뒤 회차·연도를 뺀 '오래 남는 짝 주제' 제안 (이미 쓴 키워드면 생략)
 * - 제목 유형(상시·반복·이슈, 시간 표현 유무, 고른 제목 확정)별 유입 비교 — 발행 4주 지난 글, 묶음마다 3개 이상일 때만
 */
export function titleInsights(posts: TitlePerf[], writtenKeywords: Set<string>, now = new Date()): NewInsight[] {
  const out: NewInsight[] = [];
  const year = now.getFullYear();
  const age = (p: TitlePerf) => (p.publishedAt ? (now.getTime() - p.publishedAt.getTime()) / 86_400_000 : 0);
  for (const p of posts) {
    if (!p.plan) continue;
    const years = [...p.title.matchAll(/20\d\d/g)].map((m) => Number(m[0]));
    if (p.plan.lifespan === "recurring" && years.length) {
      const y = Math.max(...years);
      const next = now.getMonth() === 11 ? year + 1 : year;
      if (y < next) {
        out.push({
          type: "YEAR_REFRESH", priority: 1, postId: p.id,
          title: `연도 갱신: ${p.title}`,
          body: `해마다 반복되는 주제인데 제목이 ${y}년이에요. ${next}년 기준으로 내용(금액·일정·조건)을 확인해 제목 연도와 본문을 갱신하거나 ${next}년 글을 새로 쓰세요. 연도는 사람들이 검색하는 어순 그대로("${next} ${p.focusKeyword}" 형태가 검색되는지 확인).`,
          data: { year: y, next },
        });
      }
    }
    if (p.plan.lifespan === "issue" && age(p) >= 14) {
      const sib = evergreenSibling(p.focusKeyword);
      if (sib && !writtenKeywords.has(normalizeKeyword(sib))) {
        out.push({
          type: "EVERGREEN_SIBLING", priority: 2, postId: p.id,
          title: `오래 남는 짝 주제: ${sib}`,
          body: `"${p.title}"은 이슈형(소모품)이라 화제가 식으면 유입이 끝나요. 회차·시점을 뺀 "${sib}"(조건·방법·계산처럼 해마다 다시 찾는 내용)로 상시형 글을 하나 써 두면 다음 회차·다음 해에도 유입이 이어져요. 주제 발굴 ③에 시드로 넣어 보세요.`,
          data: { keyword: sib },
        });
      }
    }
  }
  const mature = posts.filter((p) => p.plan && age(p) >= 28);
  const groups: [string, (p: TitlePerf) => boolean][] = [
    ["🌲 상시형", (p) => p.plan!.lifespan === "evergreen"],
    ["🔁 해마다 반복", (p) => p.plan!.lifespan === "recurring"],
    ["⚡ 이슈형", (p) => p.plan!.lifespan === "issue"],
    ["제목에 연도·회차 있음", (p) => !!p.plan!.timeInTitle],
    ["제목에 시간 표현 없음", (p) => !p.plan!.timeInTitle],
    ["고른 제목 확정", (p) => p.plan!.locked],
    ["원고 AI 제목", (p) => !p.plan!.locked],
  ];
  const lines = groups
    .map(([label, f]) => [label, mature.filter(f)] as const)
    .filter(([, ps]) => ps.length >= 3)
    .map(([label, ps]) => {
      const n = ps.length;
      const pv = ps.reduce((a, p) => a + p.pageviews, 0) / n;
      const imp = ps.reduce((a, p) => a + p.impressions, 0);
      const clk = ps.reduce((a, p) => a + p.clicks, 0);
      return `${label} ${n}개: 글당 조회 ${Math.round(pv)}회${imp ? ` · 클릭률 ${((clk / imp) * 100).toFixed(1)}%` : ""}`;
    });
  if (lines.length >= 2) {
    out.push({
      type: "TITLE_EFFECT", priority: 3,
      title: "제목 유형별 유입 비교 (발행 4주 지난 글, 최근 28일)",
      body: `${lines.join("\n")}\n묶음마다 글 3개 이상일 때만 보여요. 차이가 계속 크면 제목 규칙(시간 표현·확정 제목)을 조정할 근거로 쓰세요. 주제·계정이 달라 생기는 차이도 섞여 있어요.`,
    });
  }
  return out;
}

export function hasProposal(data: unknown): boolean {
  return !!data && typeof data === "object" && "proposal" in (data as Record<string, unknown>);
}

export const StrategySchema = z.object({
  summary: z.string().describe("이번 기간 성과 요약 2~3문장"),
  directions: z.array(z.object({ title: z.string(), body: z.string(), priority: z.number().int() })).describe("발전 방향 3~5개"),
});

export async function generateInsights(ctx?: JobContext) {
  const brand = await getBrand();
  const [posts, accounts, revenue, backlog] = await Promise.all([
    postPerformance(28),
    accountPerformance(30),
    revenueBySource(30),
    db.post.findMany({ where: { status: "PRIVATE" }, select: { id: true, title: true, privateAt: true } }),
  ]);
  const density = adDensityInsight(posts);
  const naverPosts = await db.post.findMany({
    where: { platform: "NAVER", accountId: { not: null }, createdAt: { gte: daysAgo(30) }, status: { notIn: ["FAILED", "REJECTED"] } },
    select: { accountId: true, format: true, account: { select: { name: true } } },
  });
  const mix = homefeedMixInsights(
    naverPosts.map((p) => ({ accountId: p.accountId!, accountName: p.account?.name ?? "네이버", format: p.format })),
    Number(process.env.NAVER_HOMEFEED_RATIO) || 0.7,
  );
  const planned = await db.post.findMany({
    where: { status: "PUBLISHED", titlePlan: { not: Prisma.DbNull } },
    select: { id: true, title: true, focusKeyword: true, publishedAt: true, titlePlan: true },
  });
  const written = new Set((await db.post.findMany({ select: { normalizedKeyword: true } })).map((p) => p.normalizedKeyword).filter(Boolean));
  const titles = titleInsights(
    planned.map((p) => {
      const perf = posts.find((x) => x.id === p.id);
      return { ...p, plan: p.titlePlan as TitlePlan | null, pageviews: perf?.pageviews ?? 0, impressions: perf?.impressions ?? 0, clicks: perf?.clicks ?? 0 };
    }),
    written,
  );
  const rules = [...ruleInsights(posts, accounts, backlog), ...(density ? [density] : []), ...mix, ...titles];
  await ctx?.progress(40, `규칙 기반 제안 ${rules.length}건`);

  const published = posts.filter((p) => p.status === "PUBLISHED");
  const kpi = {
    publishedPosts: published.length,
    pageviews: published.reduce((a, p) => a + p.pageviews, 0),
    revenue: revenue.reduce((a, r) => a + r.amount, 0),
  };
  const topics = await db.topic.findMany({ where: { status: "USED" }, select: { tool: true, keyword: true, posts: { select: { id: true } } } });
  const clusterViews = new Map<string, number>();
  for (const t of topics) {
    const views = t.posts.reduce((a, tp) => a + (posts.find((p) => p.id === tp.id)?.pageviews ?? 0), 0);
    const key = t.tool || t.keyword;
    clusterViews.set(key, (clusterViews.get(key) ?? 0) + views);
  }
  const clusters = [...clusterViews].sort((a, b) => b[1] - a[1]).slice(0, 6);

  const strategy = await generateJson({
    name: "strategy",
    task: "light",
    title: "발전 제안 요약",
    system: `당신은 ${brand.name} 블로그 사업의 그로스 컨설턴트입니다. 데이터에 근거해 구체적이고 실행 가능한 발전 방향을 제시하세요. 브랜드 미션: ${brand.mission}`,
    prompt: `최근 30일 데이터입니다.
- 발행 글 ${kpi.publishedPosts}개, 조회수 ${kpi.pageviews}, 수익 ${Math.round(kpi.revenue)}원
- 수익원: ${revenue.map((r) => `${r.source} ${Math.round(r.amount)}원`).join(", ") || "없음"}
- 계정별: ${accounts.map((a) => `${a.name}(${a.platform}) 조회 ${a.pageviews}, 수익 ${Math.round(a.revenue)}원, RPM ${Math.round(a.rpm)}원, 30일 발행 ${a.publishedRecent}`).join(" / ")}
- 도구(또는 키워드)별 조회수: ${clusters.map(([k, v]) => `${k} ${v}`).join(", ") || "데이터 부족"}
- 상위 글: ${published.slice(0, 5).map((p) => `${p.title}(조회 ${p.pageviews}, CTR ${(p.ctr * 100).toFixed(1)}%)`).join(" / ")}
- 자동 진단: ${rules.map((r) => r.title).join(" / ") || "없음"}

콘텐츠 전략·수익화(애드센스/애드포스트/쇼핑커넥트)·채널 확장(카드뉴스/SNS)·계정 운영 관점에서 발전 방향을 제시하세요.`,
    schema: StrategySchema,
    effort: "medium",
    maxTokens: 6000,
    mock: () => ({
      summary: `최근 30일 동안 ${kpi.publishedPosts}개 글로 조회수 ${formatNumber(kpi.pageviews)}회, 수익 ${formatKRW(kpi.revenue)}을 기록했어요. ${clusters[0] ? `"${clusters[0][0]}" 조합이 가장 반응이 좋아요.` : "아직 데이터가 쌓이는 중이에요."}`,
      directions: [
        { title: "반응 좋은 주제 클러스터 확장", body: `${clusters[0]?.[0] ?? "Gemini·직장인"} 조합으로 '기초 → 실전 → 템플릿' 3단계 시리즈를 만들어 내부 링크로 묶으세요.`, priority: 1 },
        { title: "상위 글 수익화 강화", body: "조회수 상위 20% 글에 쇼핑커넥트/제휴 상품을 1~2개씩 추가하고, 블로거는 인아티클 광고 슬롯을 설정하세요.", priority: 1 },
        { title: "카드뉴스로 재유통", body: "검색 반응이 검증된 글부터 주 2회 카드뉴스를 발행해 인스타그램·스레드 유입을 확보하세요.", priority: 2 },
        { title: "계정별 콘셉트 차별화", body: "같은 키워드를 여러 계정에 쓸 때는 계정마다 서로 다른 보조 검색어(예: 가격 / 요금제 비교)로 제목과 구성을 나눠 유사문서를 피하세요.", priority: 2 },
      ],
    }),
  });

  // 기존 OPEN 제안은 새 분석으로 교체 — 단, 사람이 [AI 제안 만들기]로 만든 제안이 붙은 항목은 남김(다시 만들려면 토큰이 듦)
  const open = await db.insight.findMany({ where: { status: "OPEN" }, select: { id: true, type: true, postId: true, data: true } });
  const kept = open.filter((i) => hasProposal(i.data));
  await db.insight.deleteMany({ where: { status: "OPEN", id: { notIn: kept.map((i) => i.id) } } });
  const keptKey = new Set(kept.map((i) => `${i.type}:${i.postId ?? ""}`));
  const all: NewInsight[] = [
    { type: "GENERAL", priority: 0, title: "성과 요약", body: strategy.summary, data: kpi },
    ...strategy.directions.map((d) => ({ type: "STRATEGY", priority: d.priority, title: d.title, body: d.body })),
    ...rules.filter((r) => !keptKey.has(`${r.type}:${r.postId ?? ""}`)),
  ];
  await db.insight.createMany({
    data: all.map((i) => ({ ...i, data: (i.data ?? {}) as Prisma.InputJsonValue })),
  });
  await ctx?.progress(100, `제안 ${all.length}건 저장`);
  return { insights: all.length };
}
