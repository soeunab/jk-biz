import { db } from "@/lib/db";
import { ActionButton } from "@/components/ActionButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DiscoverForm, GenerateFromTopic, ManualPostForm } from "@/components/Forms";
import { Badge, Empty, PageHeader, PERSONA_LABEL, PLATFORM, ScoreBar } from "@/components/ui";
import { formatNumber } from "@/lib/util";

export const dynamic = "force-dynamic";

const INTENT: Record<string, string> = { informational: "정보형", commercial: "비교·구매 고려", transactional: "구매", navigational: "탐색" };

export default async function TopicsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const status = (await searchParams).status ?? "NEW";
  const [topics, accounts, running] = await Promise.all([
    db.topic.findMany({ where: { status }, orderBy: { totalScore: "desc" }, take: 100 }),
    db.account.findMany({ where: { active: true, platform: { in: ["BLOGGER", "NAVER"] } }, select: { id: true, name: true, platform: true } }),
    db.job.count({ where: { type: "topic.discover", status: { in: ["QUEUED", "RUNNING"] } } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="주제 발굴"
        desc="네이버·구글 자동완성, 네이버 검색광고(검색량·광고경쟁도), 블로그 문서수, 데이터랩 트렌드를 종합해 '돈 되는 주제'를 점수화합니다."
        actions={<AutoRefresh active={running > 0} />}
      />
      <DiscoverForm />

      <div className="flex gap-2 text-sm">
        {[["NEW", "신규"], ["USED", "원고 작성됨"], ["DISMISSED", "보류"]].map(([k, l]) => (
          <a key={k} href={`/topics?status=${k}`} className={`rounded-lg px-3 py-1.5 ${status === k ? "bg-indigo-600 text-white" : "bg-white text-gray-700 border"}`}>{l}</a>
        ))}
      </div>

      {topics.length === 0 ? (
        <Empty>{running ? "주제를 발굴하고 있어요…" : "주제가 없습니다. 위에서 [주제 발굴]을 눌러 보세요."}</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>종합</th>
                <th>주제 · 키워드</th>
                <th>검색량/문서수</th>
                <th>경쟁</th>
                <th>수익성</th>
                <th>트렌드</th>
                <th>추천</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => (
                <tr key={t.id}>
                  <td><span className="rounded-md bg-indigo-50 px-2 py-1 text-sm font-bold text-indigo-700">{Math.round(t.totalScore)}</span></td>
                  <td className="max-w-md">
                    <div className="font-medium">{t.title}</div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      <b>{t.keyword}</b> · {t.tool} · {PERSONA_LABEL[t.persona] ?? t.persona} · {INTENT[t.intent] ?? t.intent}
                    </div>
                    {t.angle && <div className="mt-1 text-xs text-gray-600">관점: {t.angle}</div>}
                    {t.rationale && <div className="mt-1 text-xs text-emerald-700">💰 {t.rationale}</div>}
                  </td>
                  <td className="whitespace-nowrap text-xs tabular-nums">
                    월 {t.searchVolume ? formatNumber(t.searchVolume) : "-"}
                    <br />
                    문서 {t.documentCount ? formatNumber(t.documentCount) : "-"}
                  </td>
                  <td><ScoreBar value={t.competitionScore} /></td>
                  <td><ScoreBar value={t.monetizationScore} /></td>
                  <td><ScoreBar value={t.trendScore} /></td>
                  <td><Badge map={PLATFORM} value={t.targetPlatform} /></td>
                  <td className="min-w-48">
                    <div className="flex flex-col items-start gap-2">
                      {t.status !== "USED" && <GenerateFromTopic topicId={t.id} accounts={accounts} defaultPlatform={t.targetPlatform} />}
                      {t.status === "NEW" && <ActionButton url={`/api/topics/${t.id}`} method="PATCH" body={{ status: "DISMISSED" }} label="보류" className="btn-secondary text-xs" />}
                      {t.status === "DISMISSED" && <ActionButton url={`/api/topics/${t.id}`} method="PATCH" body={{ status: "NEW" }} label="복원" className="btn-secondary text-xs" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ManualPostForm accounts={accounts} />
      <p className="text-xs text-gray-500">
        점수 기준 — 경쟁: 문서수÷검색량(포화도)이 낮을수록 높음 · 수익성: 광고경쟁도(CPC 단가)·구매의도·제휴상품 연관성 · 트렌드: 최근 4주 검색 추이.
        네이버 API 키가 없으면 자동완성·휴리스틱 기반으로 계산돼요.
      </p>
    </div>
  );
}
