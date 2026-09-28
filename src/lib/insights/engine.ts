import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { getBrand } from "../brand";
import { generateJson } from "../llm";
import { accountPerformance, postPerformance, revenueBySource, type PostPerf } from "../analytics/queries";
import { daysAgo, formatKRW, formatNumber } from "../util";
import type { JobContext } from "../jobs/queue";

type NewInsight = { type: string; priority: number; title: string; body: string; postId?: string; data?: Record<string, unknown> };

/** 규칙 기반 개선 제안 — 데이터로 바로 판단 가능한 항목 */
export function ruleInsights(
  posts: PostPerf[],
  accounts: Awaited<ReturnType<typeof accountPerformance>>,
  backlog: { id: string; title: string; privateAt: Date | null }[],
  targetPerWeek = 3,
): NewInsight[] {
  const out: NewInsight[] = [];
  const published = posts.filter((p) => p.status === "PUBLISHED");

  for (const p of published) {
    if (p.impressions >= 200 && p.ctr < 0.02) {
      out.push({
        type: "RETITLE", priority: 1, postId: p.id,
        title: `제목·설명 개선: ${p.title}`,
        body: `노출 ${formatNumber(p.impressions)}회 대비 클릭률 ${(p.ctr * 100).toFixed(1)}%로 낮아요. 검색어(${p.topQueries.slice(0, 3).map((q) => q.query).join(", ") || "상위 검색어"})를 제목 앞쪽에 넣고 숫자·대상 독자를 명확히 해 보세요.`,
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
        body: `최근 30일 주당 ${perWeek.toFixed(1)}개 발행했어요. ${a.platform === "NAVER" ? "네이버는 꾸준한 발행이 C-Rank(블로그 신뢰도)에 중요해요" : "구글은 주제 클러스터를 촘촘히 채울수록 전체 노출이 올라가요"}. 주 ${targetPerWeek}개를 목표로 해 보세요.`,
        data: { accountId: a.id },
      });
    }
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

const StrategySchema = z.object({
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
  const rules = ruleInsights(posts, accounts, backlog);
  await ctx?.progress(40, `규칙 기반 제안 ${rules.length}건`);

  const published = posts.filter((p) => p.status === "PUBLISHED");
  const kpi = {
    publishedPosts: published.length,
    pageviews: published.reduce((a, p) => a + p.pageviews, 0),
    revenue: revenue.reduce((a, r) => a + r.amount, 0),
  };
  const topics = await db.topic.findMany({ where: { status: "USED" }, select: { tool: true, persona: true, posts: { select: { id: true } } } });
  const clusterViews = new Map<string, number>();
  for (const t of topics) {
    const views = t.posts.reduce((a, tp) => a + (posts.find((p) => p.id === tp.id)?.pageviews ?? 0), 0);
    const key = `${t.tool}·${t.persona}`;
    clusterViews.set(key, (clusterViews.get(key) ?? 0) + views);
  }
  const clusters = [...clusterViews].sort((a, b) => b[1] - a[1]).slice(0, 6);

  const strategy = await generateJson({
    system: `당신은 ${brand.name} 블로그 사업의 그로스 컨설턴트입니다. 데이터에 근거해 구체적이고 실행 가능한 발전 방향을 제시하세요. 브랜드 미션: ${brand.mission}`,
    prompt: `최근 30일 데이터입니다.
- 발행 글 ${kpi.publishedPosts}개, 조회수 ${kpi.pageviews}, 수익 ${Math.round(kpi.revenue)}원
- 수익원: ${revenue.map((r) => `${r.source} ${Math.round(r.amount)}원`).join(", ") || "없음"}
- 계정별: ${accounts.map((a) => `${a.name}(${a.platform}) 조회 ${a.pageviews}, 수익 ${Math.round(a.revenue)}원, RPM ${Math.round(a.rpm)}원, 30일 발행 ${a.publishedRecent}`).join(" / ")}
- 도구·독자 클러스터별 조회수: ${clusters.map(([k, v]) => `${k} ${v}`).join(", ") || "데이터 부족"}
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
        { title: "계정별 콘셉트 차별화", body: "계정을 늘릴 때는 같은 주제라도 독자층(1인 가구/프리랜서/직장인)으로 계정을 나눠 유사문서를 피하세요.", priority: 2 },
      ],
    }),
  });

  // 기존 OPEN 제안은 새 분석으로 교체
  await db.insight.deleteMany({ where: { status: "OPEN" } });
  const all: NewInsight[] = [
    { type: "GENERAL", priority: 0, title: "성과 요약", body: strategy.summary, data: kpi },
    ...strategy.directions.map((d) => ({ type: "STRATEGY", priority: d.priority, title: d.title, body: d.body })),
    ...rules,
  ];
  await db.insight.createMany({
    data: all.map((i) => ({ ...i, data: (i.data ?? {}) as Prisma.InputJsonValue })),
  });
  await ctx?.progress(100, `제안 ${all.length}건 저장`);
  return { insights: all.length };
}
