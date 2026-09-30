import Link from "next/link";
import { db } from "@/lib/db";
import { dailySeries, revenueBySource, statusCounts } from "@/lib/analytics/queries";
import { ActionButton } from "@/components/ActionButton";
import { TrafficChart, RevenueChart, SourceBars } from "@/components/Charts";
import { Badge, PageHeader, PLATFORM, Stat, ScoreBar } from "@/components/ui";
import { formatKRW, formatNumber } from "@/lib/util";
import { INSIGHT_TYPE, REVENUE_SOURCE } from "@/lib/labels";
import { costLabel, providerLabel, routeFor } from "@/lib/llm";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [series, sources, counts, review, topics, insights] = await Promise.all([
    dailySeries(30),
    revenueBySource(30),
    statusCounts(),
    db.post.findMany({ where: { status: { in: ["PRIVATE", "APPROVED", "DRAFT"] } }, include: { account: true }, orderBy: { updatedAt: "desc" }, take: 6 }),
    // totalScore 가 우선순위 정렬용 지표(scoring.ts)라 이걸 1순위로 정렬하고, confidence(확인된 지표 개수)는
    // 점수가 같을 때만 2순위로 씀 — confidence 를 1순위로 두면 "확인된 지표가 많다"는 이유만으로
    // 점수가 나쁜 주제가 점수 좋은 주제보다 위로 올라가는 문제가 있었음
    db.topic.findMany({ where: { status: "NEW", verification: { not: "UNVERIFIED" } }, orderBy: [{ totalScore: "desc" }, { confidence: "desc" }], take: 5 }),
    db.insight.findMany({ where: { status: "OPEN" }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }], take: 5 }),
  ]);
  const [writeP, lightP, manualPending] = await Promise.all([routeFor("write"), routeFor("light"), db.manualRequest.count({ where: { status: "PENDING" } })]);
  const pv = series.reduce((a, p) => a + p.pageviews, 0);
  const rev = series.reduce((a, p) => a + p.revenue, 0);
  const pv7 = series.slice(-7).reduce((a, p) => a + p.pageviews, 0);

  return (
    <div>
      <PageHeader
        title="대시보드"
        desc="주제 발굴 → 원고 생성 → 비공개 발행 → 사람 검수 → 공개 발행 → 성과 분석 → 발전 제안"
        actions={
          <>
            <Link href="/topics" className="btn-primary">🔎 주제 발굴하기</Link>
            <ActionButton url="/api/analytics/sync" label="📈 분석 동기화" />
            <ActionButton url="/api/insights/generate" label="🧭 발전 제안 갱신" />
          </>
        }
      />
      {writeP === "mock" ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          현재 <b>데모 모드</b>(LLM_PROVIDER=mock)입니다. 샘플 원고로 전체 흐름을 체험할 수 있어요. 실제 원고는 Claude 구독(Claude Code)·로컬 Ollama·수동 모드로
          추가 비용 없이 만들 수 있어요. (<Link className="underline" href="/settings">설정 확인</Link>)
        </div>
      ) : (
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-900">
          <span>✍️ 원고: <b>{providerLabel(writeP)}</b> <span className="text-xs text-indigo-700/80">({costLabel(writeP)})</span></span>
          <span>⚡ 가벼운 작업: <b>{providerLabel(lightP)}</b></span>
          {manualPending > 0 && (
            <Link href="/manual" className="rounded-full bg-amber-100 px-3 py-0.5 font-medium text-amber-800 hover:bg-amber-200">✋ 수동 입력 대기 {manualPending}건</Link>
          )}
          <Link href="/settings" className="ml-auto text-xs text-indigo-600 underline">AI 설정·점검</Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="30일 조회수" value={formatNumber(pv)} sub={`최근 7일 ${formatNumber(pv7)}`} />
        <Stat label="30일 수익" value={formatKRW(rev)} sub={pv ? `RPM ${formatKRW((rev / pv) * 1000)}` : "RPM -"} />
        <Stat label="검수 대기" value={(counts.PRIVATE ?? 0) + (counts.APPROVED ?? 0)} sub={`원고 완료 ${counts.DRAFT ?? 0}`} />
        <Stat label="발행 완료" value={counts.PUBLISHED ?? 0} sub={`생성 중 ${counts.GENERATING ?? 0}`} />
        <Stat label="신규 주제 후보" value={await db.topic.count({ where: { status: "NEW" } })} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h2 className="mb-2 font-semibold">일별 조회수 (30일)</h2>
          <TrafficChart data={series} />
        </div>
        <div className="card">
          <h2 className="mb-3 font-semibold">수익원별 (30일)</h2>
          <SourceBars rows={sources.map((s) => ({ label: REVENUE_SOURCE[s.source] ?? s.source, amount: s.amount }))} />
          <div className="mt-4 border-t pt-3">
            <h3 className="mb-1 text-sm font-semibold">일별 수익</h3>
            <RevenueChart data={series} />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">검수가 필요한 원고</h2>
            <Link href="/posts" className="text-xs text-indigo-600">전체 보기</Link>
          </div>
          {review.length === 0 && <p className="text-sm text-gray-500">대기 중인 원고가 없어요.</p>}
          <ul className="flex flex-col gap-3">
            {review.map((p) => (
              <li key={p.id}>
                <Link href={`/posts/${p.id}`} className="block rounded-lg p-2 hover:bg-gray-50">
                  <div className="flex items-center gap-2"><Badge map={PLATFORM} value={p.platform} /><span className="text-xs text-gray-500">{p.account?.name}</span></div>
                  <div className="mt-1 line-clamp-1 text-sm font-medium">{p.title}</div>
                  <div className="mt-1"><ScoreBar value={p.seoScore} /></div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">우선순위 주제 TOP 5</h2>
            <Link href="/topics" className="text-xs text-indigo-600">주제 발굴</Link>
          </div>
          {topics.length === 0 && <p className="text-sm text-gray-500">[주제 발굴]에서 돈 되는 주제를 찾아보세요.</p>}
          <ul className="flex flex-col gap-2">
            {topics.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-gray-50">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{t.title}</div>
                  <div className="text-xs text-gray-500">{t.keyword}{t.searchVolume != null ? ` · 월 ${formatNumber(t.searchVolume)}회` : " · 검색량 미확인"}</div>
                </div>
                <span className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-bold text-indigo-700">{Math.round(t.totalScore)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">발전 제안</h2>
            <Link href="/insights" className="text-xs text-indigo-600">전체 보기</Link>
          </div>
          {insights.length === 0 && <p className="text-sm text-gray-500">[발전 제안 갱신]을 눌러 분석을 받아보세요.</p>}
          <ul className="flex flex-col gap-3">
            {insights.map((i) => (
              <li key={i.id} className="text-sm">
                <div className="font-medium">{INSIGHT_TYPE[i.type]?.icon} {i.title}</div>
                <p className="line-clamp-2 text-xs text-gray-500">{i.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
