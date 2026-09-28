import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { readManuscript, researchNotesOf } from "@/lib/content/service";
import type { SeoReport } from "@/lib/content/seo";
import { ActionButton } from "@/components/ActionButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { AssetCard } from "@/components/AssetCard";
import { ManuscriptEditor } from "@/components/ManuscriptEditor";
import { ReviewPanel, MarkPublished } from "@/components/ReviewPanel";
import { Badge, PLATFORM, POST_STATUS } from "@/components/ui";
import { ApproveButton, RejectButton } from "@/components/ApproveButton";
import { AiReviewCard } from "@/components/AiReviewCard";
import { getBrand } from "@/lib/brand";
import { readinessIssues } from "@/lib/content/readiness";

export const dynamic = "force-dynamic";

const STEPS = [
  { key: "DRAFT", label: "원고 완료" },
  { key: "PRIVATE", label: "비공개 발행" },
  { key: "APPROVED", label: "사람 검수·승인" },
  { key: "PUBLISHED", label: "공개 발행" },
];

type Report = SeoReport & { similarity?: { max: number; with: { id: string; title: string } | null; warn: boolean } };

export default async function PostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const tab = (await searchParams).tab ?? "preview";
  const post = await db.post.findUnique({
    where: { id },
    include: { account: true, topic: true, assets: { where: { kind: { not: "CARD_SLIDE" } }, orderBy: { order: "asc" } }, cardNews: true },
  });
  if (!post) notFound();
  const m = readManuscript(post.content);
  const report = (post.seoReport ?? null) as Report | null;
  const jobs = (
    await db.job.findMany({ where: { type: { startsWith: "post." }, createdAt: { gte: post.createdAt } }, orderBy: { createdAt: "desc" }, take: 200 })
  )
    .filter((j) => (j.payload as { postId?: string } | null)?.postId === id)
    .slice(0, 5);
  const busy = post.status === "GENERATING" || jobs.some((j) => j.status === "QUEUED" || j.status === "RUNNING");
  const stepIndex = STEPS.findIndex((s) => s.key === post.status);
  const issues = m && ["DRAFT", "PRIVATE", "APPROVED"].includes(post.status) ? readinessIssues(m, { brand: await getBrand(), similarity: report?.similarity, renderedHtml: post.html, researchNotes: researchNotesOf(post.research) }) : [];
  const demo = (post.account?.settings as { demo?: boolean } | null)?.demo;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/posts" className="text-xs text-gray-500">← 원고 목록</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge map={PLATFORM} value={post.platform} />
          <Badge map={POST_STATUS} value={post.status} />
          <span className="text-xs text-gray-500">{post.account?.name ?? "계정 미지정"}{demo ? " (데모: 실제 발행 안 함)" : ""}</span>
          <AutoRefresh active={busy} />
        </div>
        <h1 className="mt-2 text-2xl font-bold">{post.title || post.focusKeyword}</h1>
        {post.remoteUrl && (
          <a href={post.remoteUrl} target="_blank" className="text-xs text-indigo-600 underline">{post.remoteUrl}</a>
        )}
      </div>

      {/* 워크플로 */}
      <div className="card flex flex-wrap items-center justify-between gap-4">
        <ol className="flex flex-wrap items-center gap-2 text-sm">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i <= stepIndex ? "bg-indigo-600 text-white" : "bg-gray-200 text-gray-500"}`}>{i + 1}</span>
              <span className={i <= stepIndex ? "font-semibold" : "text-gray-400"}>{s.label}</span>
              {i < STEPS.length - 1 && <span className="text-gray-300">—</span>}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          {["DRAFT", "FAILED"].includes(post.status) && m && (
            <ActionButton url={`/api/posts/${id}/action`} body={{ action: "publishPrivate" }} className="btn-primary"
              label={post.platform === "BLOGGER" ? "🔒 블로거에 초안(비공개) 저장" : "🔒 네이버에 비공개 발행"} />
          )}
          {post.status === "PRIVATE" && (
            <>
              <ApproveButton postId={id} />
              <ActionButton url={`/api/posts/${id}/action`} body={{ action: "publishPrivate" }} label="🔁 수정본 다시 올리기" />
              <RejectButton postId={id} />
            </>
          )}
          {post.status === "APPROVED" && (
            <>
              <ActionButton url={`/api/posts/${id}/action`} body={{ action: "publishPublic" }} className="btn-primary" label="🚀 공개 발행" confirm="블로그에 공개 발행합니다. 계속할까요?" />
              <ActionButton url={`/api/posts/${id}/action`} body={{ action: "unapprove" }} label="승인 취소" />
            </>
          )}
          {["PRIVATE", "APPROVED"].includes(post.status) && <MarkPublished postId={id} />}
          {post.status === "DRAFT" && <RejectButton postId={id} />}
          {post.status === "REJECTED" && <ActionButton url={`/api/posts/${id}/action`} body={{ action: "reopen" }} label="↩️ 다시 검토하기" />}
          {post.status !== "GENERATING" && (
            <ActionButton url={`/api/posts/${id}/action`} body={{ action: "cardnews" }} label="🖼️ 카드뉴스 만들기" />
          )}
        </div>
      </div>

      {issues.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="mb-1 font-semibold">승인 전 확인할 사항 {issues.length}건</div>
          <ul className="list-disc space-y-0.5 pl-5">{issues.map((i) => <li key={i.id}>{i.message}</li>)}</ul>
          <p className="mt-1 text-xs text-amber-700">자동 점검은 판단을 돕는 용도예요. 확인 후 승인 여부는 검수자가 결정합니다.</p>
        </div>
      )}

      {post.error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm whitespace-pre-wrap text-red-700">⚠️ {post.error}</div>}

      {!m ? (
        <div className="card text-sm text-gray-500">
          {post.status === "GENERATING" ? "AI가 조사하고 원고를 쓰고 있어요… (1~3분)" : "원고가 없습니다."}
          <JobLogs jobs={jobs} />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="card min-w-0">
            <div className="-mx-5 -mt-5 mb-5 flex gap-1 border-b px-3">
              {[["preview", "미리보기"], ["edit", "원고 편집"], ["images", `이미지 (${post.assets.length})`], ["html", "HTML 코드"]].map(([k, l]) => (
                <Link key={k} href={`/posts/${id}?tab=${k}`} className={`px-3 py-3 text-sm ${tab === k ? "border-b-2 border-indigo-600 font-semibold text-indigo-700" : "text-gray-500"}`}>{l}</Link>
              ))}
            </div>
            {tab === "preview" && (
              <article className="post-preview mx-auto max-w-3xl">
                <h1 className="mb-4 text-3xl font-extrabold leading-tight">{m.title}</h1>
                <div dangerouslySetInnerHTML={{ __html: post.html }} />
                {post.platform === "NAVER" && (
                  <p className="mt-6 text-sm text-green-700">{m.tags.map((t) => `#${t}`).join(" ")}</p>
                )}
              </article>
            )}
            {tab === "edit" && <ManuscriptEditor postId={id} initial={m} />}
            {tab === "images" && (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm text-gray-500">AI 도구 사용법 글은 <b>직접 캡처한 화면</b>으로 교체하면 신뢰도(E-E-A-T)와 네이버 독창성 평가에 유리해요.</p>
                  <ActionButton url={`/api/posts/${id}/action`} body={{ action: "images" }} label="🎨 이미지 전체 다시 만들기" confirm="기존 이미지를 모두 새로 만듭니다." />
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {post.assets.map((a) => (
                    <AssetCard key={a.id} a={{ id: a.id, slot: a.slot, src: a.publicUrl ?? "", alt: a.alt, source: a.source, credit: a.credit }} />
                  ))}
                </div>
              </div>
            )}
            {tab === "html" && (
              <div>
                <p className="mb-2 text-sm text-gray-500">블로거 HTML 보기나 다른 곳에 붙여 넣을 때 사용하세요.</p>
                <textarea readOnly className="input h-[60vh] font-mono text-xs" value={post.html} />
              </div>
            )}
          </div>

          <aside className="flex flex-col gap-4">
            <AiReviewCard
              postId={id}
              review={(post.aiReview ?? null) as Parameters<typeof AiReviewCard>[0]["review"]}
              atLabel={(post.aiReview as { at?: string } | null)?.at ? new Date((post.aiReview as { at: string }).at).toLocaleString("ko-KR") : undefined}
            />
            <ReviewPanel
              postId={id}
              report={report}
              checklist={m.reviewChecklist}
              reviewerNote={post.reviewerNote}
              meta={{ keyword: m.focusKeyword, description: m.metaDescription, slug: m.slug, tags: m.tags, sources: m.sources }}
            />
            <div className="card flex flex-col gap-2 text-sm">
              <h3 className="font-semibold">원고 관리</h3>
              <ActionButton url={`/api/posts/${id}/action`} body={{ action: "regenerate" }} label="🤖 AI로 원고 다시 쓰기" confirm="현재 원고와 이미지를 새로 생성합니다. 수정 내용은 사라져요." />
              {post.cardNews.map((c) => (
                <Link key={c.id} href={`/cardnews/${c.id}`} className="text-xs text-indigo-600">🖼️ 카드뉴스: {c.title}</Link>
              ))}
              <ActionButton url={`/api/posts/${id}`} method="DELETE" label="🗑️ 원고 삭제" className="btn-danger" confirm="원고를 삭제할까요? (블로그에 올라간 글은 삭제되지 않습니다)" />
              <JobLogs jobs={jobs} />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function JobLogs({ jobs }: { jobs: { id: string; type: string; status: string; log: string; error: string | null }[] }) {
  if (!jobs.length) return null;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-gray-500">작업 로그</summary>
      {jobs.map((j) => (
        <pre key={j.id} className="mt-2 max-h-48 overflow-auto rounded bg-gray-50 p-2 whitespace-pre-wrap">
          [{j.type} · {j.status}]{"\n"}{j.log}{j.error ? `\n❌ ${j.error.split("\n")[0]}` : ""}
        </pre>
      ))}
    </details>
  );
}
