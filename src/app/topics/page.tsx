import { db } from "@/lib/db";
import { ActionButton } from "@/components/ActionButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DiscoverForm, GenerateFromTopic, ManualPostForm } from "@/components/Forms";
import { Badge, Empty, PageHeader, PERSONA_LABEL, PLATFORM, ScoreBar, VERIFICATION } from "@/components/ui";
import { RelatedKeywords } from "@/components/RelatedKeywords";
import { INTENT_LABEL, type Intent } from "@/lib/topics/scoring";
import { formatNumber } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function TopicsPage({ searchParams }: { searchParams: Promise<{ status?: string; all?: string }> }) {
  const sp = await searchParams;
  const status = sp.status ?? "NEW";
  const showAll = sp.all === "1";
  const verificationFilter = showAll ? {} : { verification: { not: "UNVERIFIED" } };
  const sources = (
    await db.post.findMany({
      where: { status: { in: ["DRAFT", "PRIVATE", "APPROVED", "PUBLISHED"] } },
      select: { id: true, title: true, platform: true, account: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    })
  ).map((p) => ({ id: p.id, title: p.title, platform: p.platform, account: p.account?.name ?? "-" }));
  const [topics, hidden, accounts, running] = await Promise.all([
    db.topic.findMany({ where: { status, ...verificationFilter }, orderBy: [{ confidence: "desc" }, { totalScore: "desc" }], take: 100 }),
    showAll ? Promise.resolve(0) : db.topic.count({ where: { status, verification: "UNVERIFIED" } }),
    db.account.findMany({ where: { active: true, platform: { in: ["BLOGGER", "NAVER"] } }, select: { id: true, name: true, platform: true } }),
    db.job.count({ where: { type: "topic.discover", status: { in: ["QUEUED", "RUNNING"] } } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="주제 발굴"
        desc="자동완성으로 후보를 모으고, 네이버 검색광고(검색량·광고경쟁도)·블로그 문서수·데이터랩 트렌드 같은 공식 데이터로 검증해 우선순위를 매깁니다."
        actions={<AutoRefresh active={running > 0} />}
      />
      <DiscoverForm />

      <div className="flex gap-2 text-sm">
        {[["NEW", "신규"], ["USED", "원고 작성됨"], ["DISMISSED", "보류"]].map(([k, l]) => (
          <a key={k} href={`/topics?status=${k}${showAll ? "&all=1" : ""}`} className={`rounded-lg px-3 py-1.5 ${status === k ? "bg-indigo-600 text-white" : "bg-white text-gray-700 border"}`}>{l}</a>
        ))}
        <span className="mx-2 text-gray-300">|</span>
        <a href={`/topics?status=${status}${showAll ? "" : "&all=1"}`} className={`rounded-lg px-3 py-1.5 ${showAll ? "bg-gray-800 text-white" : "border bg-white text-gray-700"}`}>
          {showAll ? "미검증 키워드 숨기기" : `미검증 키워드 포함 보기${hidden ? ` (${hidden}개 숨김)` : ""}`}
        </a>
      </div>

      {topics.length === 0 ? (
        <Empty>
          {running ? "주제를 발굴하고 있어요…" : hidden ? `실제 검색 여부를 확인하지 못한 미검증 주제 ${hidden}개가 숨겨져 있어요. API 지연·실패로 검증을 놓친 후보도 [미검증 키워드 포함 보기]에서 직접 볼 수 있어요.` : "주제가 없습니다. 위에서 [주제 발굴]을 눌러 보세요."}
        </Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>우선순위</th>
                <th>주제 · 키워드</th>
                <th>검색량/문서수</th>
                <th>경쟁</th>
                <th>수익성</th>
                <th>트렌드</th>
                <th>플랫폼</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className="rounded-md bg-indigo-50 px-2 py-1 text-sm font-bold text-indigo-700">{Math.round(t.totalScore)}</span>
                    <div className="mt-1 text-[10px] text-gray-400" title="검색량·경쟁·트렌드 중 실제 데이터로 확인된 지표 수">확인 {t.confidence}/3</div>
                  </td>
                  <td className="max-w-md">
                    <div className="font-medium">{t.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                      <Badge map={VERIFICATION} value={t.verification} />
                      <b>{t.keyword}</b> · {t.tool} · {PERSONA_LABEL[t.persona] ?? t.persona} · {INTENT_LABEL[t.intent as Intent] ?? t.intent}
                    </div>
                    {t.angle && <div className="mt-1 text-xs text-gray-600">관점: {t.angle}</div>}
                    {t.rationale && <div className="mt-1 text-xs text-gray-600">📊 {t.rationale}</div>}
                  </td>
                  <td className="whitespace-nowrap text-xs tabular-nums">
                    <span className="whitespace-nowrap">월 {t.searchVolume != null ? formatNumber(t.searchVolume) : <span className="text-gray-400">미확인</span>}</span>
                    <br />
                    <span className="whitespace-nowrap">문서 {t.documentCount != null ? formatNumber(t.documentCount) : <span className="text-gray-400">미확인</span>}</span>
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
      <div className="grid gap-6 lg:grid-cols-2">
        <ManualPostForm accounts={accounts} sources={sources} />
        <RelatedKeywords />
      </div>
      <p className="text-xs text-gray-500">
        ⚠️ 우선순위 점수는 <b>무엇부터 쓸지 정하는 내부 정렬 지표</b>이며 수익·트래픽 예측이 아닙니다. 공식 데이터로 확인하지 못한 지표는 &quot;미확인&quot;으로 두고 점수에서 제외합니다.
        <br />
        경쟁: 문서수÷검색량(포화도)이 낮을수록 높음 · 수익화: 광고경쟁도(있을 때)·검색의도·제휴상품 연관성 · 트렌드: 데이터랩 최근 4주 추이.
      </p>
    </div>
  );
}
