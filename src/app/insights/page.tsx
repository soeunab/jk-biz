import Link from "next/link";
import { db } from "@/lib/db";
import { ActionButton } from "@/components/ActionButton";
import { Empty, PageHeader } from "@/components/ui";
import { INSIGHT_TYPE } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const insights = await db.insight.findMany({ where: { status: "OPEN" }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }] });
  const summary = insights.find((i) => i.type === "GENERAL" && i.title === "성과 요약");
  const strategy = insights.filter((i) => i.type === "STRATEGY");
  const actions = insights.filter((i) => i !== summary && i.type !== "STRATEGY");
  const posts = new Map((await db.post.findMany({ where: { id: { in: actions.flatMap((a) => (a.postId ? [a.postId] : [])) } }, select: { id: true } })).map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="발전 제안"
        desc="유입·수익 데이터를 분석해 제목 개선, 글 보강, 수익화, 다음 주제, 발행 주기, 카드뉴스 확산을 제안합니다. (매일 자동 갱신)"
        actions={<ActionButton url="/api/insights/generate" label="🧭 지금 분석하기" className="btn-primary" />}
      />
      {insights.length === 0 && <Empty>아직 제안이 없어요. [지금 분석하기]를 눌러 보세요.</Empty>}
      {summary && (
        <div className="card border-indigo-200 bg-indigo-50/50">
          <div className="text-xs font-bold text-indigo-700">📊 성과 요약</div>
          <p className="mt-1 text-sm">{summary.body}</p>
        </div>
      )}
      {strategy.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {strategy.map((s) => (
            <div key={s.id} className="card">
              <div className="text-xs font-bold text-gray-500">🧭 발전 방향 · 우선순위 {s.priority}</div>
              <h3 className="mt-1 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-gray-600">{s.body}</p>
            </div>
          ))}
        </div>
      )}
      {actions.length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-semibold">실행 과제</h2>
          <ul className="divide-y">
            {actions.map((a) => {
              const t = INSIGHT_TYPE[a.type] ?? { label: a.type, icon: "•" };
              const seeds = (a.data as { seeds?: string[] } | null)?.seeds;
              return (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-gray-500">{t.icon} {t.label}</div>
                    <div className="font-medium">{a.title}</div>
                    <p className="text-sm text-gray-600">{a.body}</p>
                  </div>
                  <div className="flex gap-2">
                    {a.postId && posts.has(a.postId) && <Link className="btn-secondary" href={`/posts/${a.postId}?tab=edit`}>글 열기</Link>}
                    {a.type === "CARDNEWS" && a.postId && <ActionButton url={`/api/posts/${a.postId}/action`} body={{ action: "cardnews" }} label="카드뉴스 생성" />}
                    {seeds && <ActionButton url="/api/topics/discover" body={{ seeds: seeds.join(","), limit: 8 }} label="이 검색어로 주제 발굴" redirect="/topics" />}
                    <ActionButton url={`/api/insights/${a.id}`} method="PATCH" body={{ status: "DONE" }} label="완료" className="btn-success" />
                    <ActionButton url={`/api/insights/${a.id}`} method="PATCH" body={{ status: "DISMISSED" }} label="무시" />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
