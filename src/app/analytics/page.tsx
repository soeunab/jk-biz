import Link from "next/link";
import { db } from "@/lib/db";
import { accountPerformance, dailySeries, postPerformance, revenueBySource } from "@/lib/analytics/queries";
import { ActionButton } from "@/components/ActionButton";
import { CsvImport, ImportPostForm, RevenueForm } from "@/components/AnalyticsForms";
import { RevenueChart, SearchChart, SourceBars, TrafficChart } from "@/components/Charts";
import { Badge, PageHeader, PLATFORM, Stat } from "@/components/ui";
import { REVENUE_SOURCE } from "@/lib/labels";
import { formatKRW, formatNumber } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string; account?: string }> }) {
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const [series, sources, accounts, posts, allAccounts] = await Promise.all([
    dailySeries(days, sp.account),
    revenueBySource(days),
    accountPerformance(days),
    postPerformance(days),
    db.account.findMany({ where: { platform: { in: ["BLOGGER", "NAVER"] } }, select: { id: true, name: true } }),
  ]);
  const filteredPosts = sp.account ? posts.filter((p) => allAccounts.find((a) => a.id === sp.account)?.name === p.account) : posts;
  const pv = series.reduce((a, p) => a + p.pageviews, 0);
  const clicks = series.reduce((a, p) => a + p.clicks, 0);
  const impressions = series.reduce((a, p) => a + p.impressions, 0);
  const revenue = series.reduce((a, p) => a + p.revenue, 0);
  const q = (d: number, acc?: string) => `/analytics?days=${d}${acc ? `&account=${acc}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="유입 · 수익 분석"
        desc="구글: GA4·서치콘솔·애드센스 자동 동기화 / 네이버: RSS 발행 확인 + CSV·직접 입력"
        actions={<ActionButton url="/api/analytics/sync" label="🔄 지금 동기화" className="btn-primary" />}
      />
      <div className="flex flex-wrap gap-2 text-sm">
        {[7, 30, 90].map((d) => (
          <Link key={d} href={q(d, sp.account)} className={`rounded-lg px-3 py-1.5 ${days === d ? "bg-indigo-600 text-white" : "border bg-white"}`}>{d}일</Link>
        ))}
        <span className="mx-2 text-gray-300">|</span>
        <Link href={q(days)} className={`rounded-lg px-3 py-1.5 ${!sp.account ? "bg-gray-800 text-white" : "border bg-white"}`}>전체 계정</Link>
        {allAccounts.map((a) => (
          <Link key={a.id} href={q(days, a.id)} className={`rounded-lg px-3 py-1.5 ${sp.account === a.id ? "bg-gray-800 text-white" : "border bg-white"}`}>{a.name}</Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="조회수" value={formatNumber(pv)} />
        <Stat label="검색 클릭 (구글)" value={formatNumber(clicks)} sub={`노출 ${formatNumber(impressions)} · CTR ${impressions ? ((clicks / impressions) * 100).toFixed(1) : 0}%`} />
        <Stat label="수익" value={formatKRW(revenue)} />
        <Stat label="RPM (1천 조회당 수익)" value={pv ? formatKRW((revenue / pv) * 1000) : "-"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card"><h2 className="mb-2 font-semibold">일별 조회수</h2><TrafficChart data={series} /></div>
        <div className="card"><h2 className="mb-2 font-semibold">구글 검색 클릭</h2><SearchChart data={series} /></div>
        <div className="card"><h2 className="mb-2 font-semibold">일별 수익</h2><RevenueChart data={series} /></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2 overflow-x-auto">
          <h2 className="mb-1 font-semibold">계정별 성과</h2>
          <p className="mb-3 text-xs text-gray-500">같은 애드포스트로 묶인 네이버 계정들은 합산 수익을 조회수 비중으로 나눠 표시해요 (계정 관리 → 애드포스트 정산 계정).</p>
          <table className="table">
            <thead><tr><th>계정</th><th>발행(기간)</th><th>조회수</th><th>애드포스트(배분)</th><th>총 수익</th><th>RPM</th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td><Badge map={PLATFORM} value={a.platform} /> <span className="ml-1">{a.name}</span></td>
                  <td className="tabular-nums">{a.published} ({a.publishedRecent})</td>
                  <td className="tabular-nums">{formatNumber(a.pageviews)}</td>
                  <td className="text-xs">
                    {a.adpost ? (
                      <>
                        <span className="tabular-nums">{formatKRW(a.adpost.allocated)}</span>
                        {a.adpost.groupSize > 1 && (
                          <div className="text-gray-500">
                            {a.adpost.groupName} 그룹 {formatKRW(a.adpost.groupRevenue)} × 조회수 {(a.adpost.share * 100).toFixed(0)}%
                          </div>
                        )}
                        {a.adpost.note && <div className="text-amber-600">{a.adpost.note}</div>}
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="tabular-nums">{formatKRW(a.revenue)}</td>
                  <td className="tabular-nums">{a.pageviews ? formatKRW(a.rpm) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="mb-3 font-semibold">수익원별</h2>
          <SourceBars rows={sources.map((s) => ({ label: REVENUE_SOURCE[s.source] ?? s.source, amount: s.amount }))} />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-3 font-semibold">글별 성과</h2>
        <table className="table">
          <thead><tr><th>글</th><th>조회수</th><th>클릭/노출</th><th>CTR</th><th>평균 순위</th><th>수익</th><th>상위 검색어</th></tr></thead>
          <tbody>
            {filteredPosts.slice(0, 50).map((p) => (
              <tr key={p.id}>
                <td className="max-w-sm">
                  <Link href={`/posts/${p.id}`} className="font-medium hover:text-indigo-700">{p.title}</Link>
                  <div className="text-xs text-gray-500">{p.account} · {p.platform === "NAVER" ? "네이버" : "블로거"}</div>
                </td>
                <td className="tabular-nums">{formatNumber(p.pageviews)}</td>
                <td className="tabular-nums text-xs">{formatNumber(p.clicks)} / {formatNumber(p.impressions)}</td>
                <td className="tabular-nums">{p.impressions ? `${(p.ctr * 100).toFixed(1)}%` : "-"}</td>
                <td className="tabular-nums">{p.position ? p.position.toFixed(1) : "-"}</td>
                <td className="tabular-nums">{p.revenue ? formatKRW(p.revenue) : "-"}</td>
                <td className="max-w-xs text-xs text-gray-500">{p.topQueries.slice(0, 3).map((q) => q.query).join(", ") || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="mb-1 font-semibold">기존 글 등록</h2>
        <p className="mb-3 text-xs text-gray-500">프로그램 없이 직접 작성해 올린 글도 등록해두면, GA4·서치콘솔·조회수 CSV 가 이 글 URL로 매칭돼 &quot;글별 성과&quot;에 나타납니다. AI 원고는 없어서 SEO 점수는 계산되지 않습니다.</p>
        <ImportPostForm accounts={allAccounts} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card"><h2 className="mb-3 font-semibold">CSV 가져오기</h2><CsvImport /></div>
        <div className="card"><h2 className="mb-3 font-semibold">수익 직접 입력</h2><RevenueForm accounts={allAccounts} /></div>
      </div>
    </div>
  );
}
