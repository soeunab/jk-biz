import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { accountSettings, readManuscript, researchNotesOf, userSourcesOf } from "@/lib/content/service";
import type { SeoReport } from "@/lib/content/seo";
import { ActionButton } from "@/components/ActionButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { AssetCard } from "@/components/AssetCard";
import { ManuscriptEditor } from "@/components/ManuscriptEditor";
import { ReviewPanel, MarkPublished } from "@/components/ReviewPanel";
import { Badge, PLATFORM, POST_STATUS } from "@/components/ui";
import { ApproveButton, RejectButton } from "@/components/ApproveButton";
import { RepublishButton } from "@/components/RepublishButton";
import { UserSourcesForm } from "@/components/UserSourcesForm";
import { AffiliateAdder } from "@/components/AffiliateAdder";
import { PublishPrivateButton } from "@/components/PublishPrivateButton";
import { actionableItems } from "@/lib/content/checklist";
import { AiReviewCard } from "@/components/AiReviewCard";
import { getBrand } from "@/lib/brand";
import { alignmentFrom, readinessIssues } from "@/lib/content/readiness";
import { ManualTaskCard } from "@/components/ManualTaskCard";
import { pendingManualTasks } from "@/lib/manualTasks";
import { canMarkPublished, canRegenerate, editLockedMessage, isEditLocked, NAVER_UNCONFIRMED, UNLINK_ALLOWED } from "@/lib/content/postStatus";
import { TitleChecklist } from "@/components/TitleChecklist";
import { lifespanOf, titleChecks, type TitlePlan } from "@/lib/topics/titleRules";
import type { AnswerType } from "@/lib/topics/scoring";

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
  const tabParam = (await searchParams).tab;
  const post = await db.post.findUnique({
    where: { id },
    include: {
      account: true,
      topic: true,
      assets: { where: { kind: { not: "CARD_SLIDE" } }, orderBy: { order: "asc" } },
      cardNews: true,
      source: { select: { id: true, title: true, platform: true, remoteUrl: true, account: { select: { name: true } } } },
      republishes: { select: { id: true, title: true, platform: true, status: true, account: { select: { name: true } } } },
    },
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
  const manualTasks = await pendingManualTasks({ postId: id });
  const partners = accountSettings(post.account?.settings).republishPartnerIds ?? [];
  const republishTargets = (
    await db.account.findMany({ where: { active: true, platform: { in: ["BLOGGER", "NAVER"] }, id: { not: post.accountId ?? "" } }, select: { id: true, name: true, platform: true } })
  )
    .map((a) => ({ ...a, partner: partners.includes(a.id) }))
    .sort((a, b) => Number(b.partner) - Number(a.partner));
  const issues = m && ["DRAFT", "PRIVATE", "APPROVED"].includes(post.status) ? readinessIssues(m, { brand: await getBrand(), similarity: report?.similarity, renderedHtml: post.html, researchNotes: researchNotesOf(post.research), republish: (post.seoReport as { republish?: null | { sourceTitle: string; sourceUrl: string | null; similarity: number; warn: boolean } } | null)?.republish ?? null, accountConcept: post.account ? post.account.concept : undefined, alignment: alignmentFrom(post.aiReview) }) : [];
  const demo = (post.account?.settings as { demo?: boolean } | null)?.demo;
  // 승인·공개 후에는 원고·이미지를 프로그램에서 바꾸지 않음 (공개 단계가 승인된 내용을 그대로 내보냄)
  const locked = isEditLocked(post.status);
  const canUnlinkNaver = post.platform === "NAVER" && !!post.remoteId && (UNLINK_ALLOWED as readonly string[]).includes(post.status);
  const bloggerEdit =
    post.platform === "BLOGGER" && post.remoteId && post.status !== "PUBLISHED" && post.account?.externalId
      ? `https://www.blogger.com/blog/post/edit/${post.account.externalId}/${post.remoteId}`
      : null;
  // 블로그에 올라가 있는 본문(블로그에서 가져오기) — [기존 글 등록] 글이거나 블로그에서 고쳤으면 미리보기 기본을 '블로그 현재본'으로
  const remoteDiff = (post.remoteDiff ?? null) as { edited?: boolean; similarity?: number | null; chars?: number; images?: number; baseImages?: number | null; title?: string; titleChanged?: boolean } | null;
  const showRemote = !!post.remoteHtml && (post.origin === "imported" || !!remoteDiff?.edited);
  const tab = tabParam ?? (showRemote ? "remote" : "preview");
  const onBlog = !!(post.remoteId || post.remoteUrl) && !post.remoteId?.startsWith("demo-");
  // 제목 점검 — 지금 제목으로 매번 다시 계산(사람이 제목을 고쳐도 바로 반영). 기존 글 등록 글은 제외
  const topicSig = (post.topic?.signals ?? {}) as { seasonality?: string | null; answerType?: AnswerType | null; related?: { keyword: string }[] };
  const titlePlan = (post.titlePlan ?? null) as TitlePlan | null;
  const titleLifespan = titlePlan?.lifespan ?? lifespanOf({ origin: post.topic?.origin, seasonality: topicSig.seasonality });
  const titleCheckList =
    post.origin !== "imported" && post.title && post.focusKeyword
      ? titleChecks(post.title, {
          keyword: post.topic?.keyword ?? post.focusKeyword,
          lifespan: titleLifespan,
          timeForms: titlePlan?.timeForms,
          answerType: topicSig.answerType,
          intent: post.topic?.intent,
          related: topicSig.related?.map((r) => r.keyword),
        })
      : null;
  const affiliateProducts = await db.affiliateProduct.findMany({
    where: { active: true, platform: { in: [post.platform, "BOTH"] } },
    select: { id: true, name: true, program: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/posts" className="text-xs text-gray-500">← 원고 목록</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge map={PLATFORM} value={post.platform} />
          <Badge map={POST_STATUS} value={post.status} />
          {post.format === "HOMEFEED" && <span className="badge bg-orange-50 text-orange-700" title="네이버 홈피드 노출용 — 궁금증 제목·첫 문장 후킹·댓글 유도">🏠 홈판형</span>}
          <span className="text-xs text-gray-500">{post.account?.name ?? "계정 미지정"}{demo ? " (데모: 실제 발행 안 함)" : ""}</span>
          <AutoRefresh active={busy} />
        </div>
        <h1 className="mt-2 text-2xl font-bold">{post.title || post.focusKeyword}</h1>
        {titleCheckList && (
          <details className="mt-1" open={titleCheckList.some((c) => c.pass === false) || !!titlePlan?.changeReason}>
            <summary className="cursor-pointer text-xs text-gray-500">
              📝 제목 점검 {titleCheckList.filter((c) => c.pass === false).length ? `✖ ${titleCheckList.filter((c) => c.pass === false).length}개` : "✔ 통과"}
              {titlePlan?.locked && " · 🔒 고른 제목으로 확정"}
              {titlePlan?.secondaryKeyword && ` · 보조 검색어 "${titlePlan.secondaryKeyword}"`}
            </summary>
            <div className="mt-1 rounded-lg border bg-gray-50 p-2">
              {titlePlan?.changeReason && (
                <p className="mb-1 text-xs text-amber-700">
                  ✎ 확정 제목 &quot;{titlePlan.lockedTitle}&quot;을 원고 AI 가 바꿨어요 — 이유: {titlePlan.changeReason}
                </p>
              )}
              <TitleChecklist checks={titleCheckList} lifespan={titleLifespan} timeForms={titlePlan?.timeForms ?? null} />
              {titleLifespan === "recurring" && <p className="mt-1 text-[11px] text-gray-500">🔁 해마다 반복되는 주제 — 해가 바뀌면 연도를 갱신하라는 제안이 발전 제안에 올라와요.</p>}
              {titleLifespan === "issue" && <p className="mt-1 text-[11px] text-gray-500">⚡ 이슈형(소모품) — 화제가 식으면 유입이 끝나요. 회차·연도를 뺀 오래 남는 짝 주제를 발전 제안에서 알려 드려요.</p>}
            </div>
          </details>
        )}
        {post.remoteUrl && (
          <a href={post.remoteUrl} target="_blank" className="text-xs text-indigo-600 underline">{post.remoteUrl}</a>
        )}
        {bloggerEdit && (
          <a href={bloggerEdit} target="_blank" className="text-xs text-indigo-600 underline">블로거 편집 화면에서 보기 (초안)</a>
        )}
        {post.source && (
          <div className="mt-2 text-xs">
            <span className="badge bg-violet-50 text-violet-700">🔁 재발행</span>{" "}
            원본: <Link className="text-indigo-600 underline" href={`/posts/${post.source.id}`}>{post.source.title}</Link>
            <span className="text-gray-500"> ({post.source.platform === "NAVER" ? "네이버" : "블로거"} · {post.source.account?.name})</span>
            {(post.seoReport as { republish?: { similarity: number } } | null)?.republish && (
              <span className="ml-2 text-gray-500">원본과 유사도 {Math.round(((post.seoReport as { republish: { similarity: number } }).republish.similarity) * 100)}%</span>
            )}
          </div>
        )}
        {post.republishes.length > 0 && (
          <div className="mt-2 text-xs text-gray-600">
            🔁 이 글의 재발행:{" "}
            {post.republishes.map((r, i) => (
              <span key={r.id}>
                {i > 0 && " · "}
                <Link className="text-indigo-600 underline" href={`/posts/${r.id}`}>{r.account?.name ?? r.platform}</Link> ({r.status})
              </span>
            ))}
          </div>
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
          {["DRAFT", "FAILED"].includes(post.status) && m && post.remoteId !== NAVER_UNCONFIRMED && (
            <PublishPrivateButton postId={id} className="btn-primary" label={post.platform === "BLOGGER" ? "🔒 블로거에 초안(비공개) 저장" : "🔒 네이버에 비공개 발행"} />
          )}
          {post.status === "PRIVATE" && (
            <>
              <ApproveButton postId={id} />
              <PublishPrivateButton postId={id} label="🔁 수정본 다시 올리기" />
              <RejectButton postId={id} />
            </>
          )}
          {post.status === "APPROVED" && (
            <>
              <ActionButton url={`/api/posts/${id}/action`} body={{ action: "publishPublic" }} className="btn-primary" label="🚀 공개 발행" confirm="블로그에 공개 발행합니다. 계속할까요?" />
              <ActionButton url={`/api/posts/${id}/action`} body={{ action: "unapprove" }} label="승인 취소" />
            </>
          )}
          {canMarkPublished(post) && <MarkPublished postId={id} />}
          {canUnlinkNaver && (
            <ActionButton
              url={`/api/posts/${id}/action`}
              body={{ action: "unlinkRemote" }}
              label="🔗 네이버 연결 해제"
              confirm={
                post.remoteId === NAVER_UNCONFIRMED
                  ? "네이버 '내 글'에 이 글이 없는 것을 확인했나요? 연결을 해제하면 다시 올릴 수 있어요(있는데 해제하면 같은 글이 두 개 생겨요)."
                  : "네이버에서 이 글을 먼저 삭제했나요? 연결을 해제하면 다시 올릴 수 있어요(삭제하지 않고 다시 올리면 같은 글이 두 개 생겨요)."
              }
            />
          )}
          {post.status === "DRAFT" && <RejectButton postId={id} />}
          {post.status === "REJECTED" && <ActionButton url={`/api/posts/${id}/action`} body={{ action: "reopen" }} label="↩️ 다시 검토하기" />}
          {post.status !== "GENERATING" && (
            <ActionButton url={`/api/posts/${id}/action`} body={{ action: "cardnews" }} label="🖼️ 카드뉴스 만들기" />
          )}
          {m && post.status !== "GENERATING" && <RepublishButton postId={id} accounts={republishTargets} />}
        </div>
      </div>

      {onBlog && (
        <div className={`card flex flex-wrap items-center justify-between gap-3 text-sm ${remoteDiff?.edited ? "border-amber-300 bg-amber-50/60" : ""}`}>
          <div>
            <div className="font-semibold">🌐 블로그에 올라간 글 {post.origin === "imported" && <span className="badge ml-1 bg-gray-100 text-gray-600">기존 글 등록</span>}</div>
            <div className="text-xs text-gray-600">
              {post.remoteSyncedAt
                ? `마지막으로 가져온 시각 ${post.remoteSyncedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 본문 ${(remoteDiff?.chars ?? 0).toLocaleString("ko-KR")}자 · 사진 ${remoteDiff?.images ?? 0}장`
                : "아직 블로그 본문을 가져오지 않았어요."}
              {remoteDiff?.edited && (
                <b className="ml-1 text-amber-700">
                  · 블로그에서 고친 내용이 있어요 (스튜디오가 올린 것과 유사도 {remoteDiff.similarity != null ? `${Math.round(remoteDiff.similarity * 100)}%` : "–"}, 사진 {remoteDiff.baseImages ?? "?"} → {remoteDiff.images}장{remoteDiff.titleChanged ? `, 제목 "${remoteDiff.title}"` : ""}) — [수정본 다시 올리기]를 누르면 이 수정이 사라져요
                </b>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton url={`/api/posts/${id}/action`} body={{ action: "syncRemote" }} label="🔄 블로그에서 가져오기" />
            {(post.origin === "imported" || remoteDiff?.edited || !m) && (
              <ActionButton
                url={`/api/posts/${id}/action`}
                body={{ action: "convertRemote" }}
                label={m ? "📄 블로그 본문으로 원고 다시 만들기" : "📄 원고로 변환"}
                confirm={m ? "지금 원고를 블로그에 올라간 본문으로 바꿉니다(내용은 그대로, Claude 1번). 스튜디오에서만 바뀌고 블로그 글은 바뀌지 않아요. 계속할까요?" : undefined}
              />
            )}
          </div>
        </div>
      )}

      {manualTasks.map((t) => <ManualTaskCard key={t.id} {...t} link={undefined} />)}

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
          {post.status === "GENERATING" ? (
            "AI가 조사하고 원고를 쓰고 있어요… (1~3분)"
          ) : post.remoteHtml ? (
            <>
              <p className="mb-2">블로그에 올라간 본문이에요. [📄 원고로 변환]을 누르면 AI 사실 검수·SEO 점검·카드뉴스·다른 계정 재발행을 쓸 수 있어요.</p>
              <RemoteFrame html={post.remoteHtml} />
            </>
          ) : (
            "원고가 없습니다."
          )}
          <JobLogs jobs={jobs} />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="card min-w-0">
            <div className="-mx-5 -mt-5 mb-5 flex gap-1 border-b px-3">
              {[...(post.remoteHtml ? [["remote", "🌐 블로그 현재본"]] : []), ["preview", "스튜디오 미리보기"], ["edit", "원고 편집"], ["images", `이미지 (${post.assets.length})`], ["html", "HTML 코드"]].map(([k, l]) => (
                <Link key={k} href={`/posts/${id}?tab=${k}`} className={`px-3 py-3 text-sm ${tab === k ? "border-b-2 border-indigo-600 font-semibold text-indigo-700" : "text-gray-500"}`}>{l}</Link>
              ))}
            </div>
            {tab === "remote" && post.remoteHtml && (
              <div>
                <p className="mb-2 text-xs text-gray-500">
                  블로그에 실제로 올라가 있는 본문이에요({post.remoteSyncedAt?.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 기준). 블로그 서식 없이 보여서 모양은 다를 수 있어요.
                  {post.platform === "NAVER" && " 네이버 사진은 외부에서 열리지 않아 빈칸으로 보일 수 있어요."}
                </p>
                <RemoteFrame html={post.remoteHtml} />
              </div>
            )}
            {tab === "preview" && (
              <article className="post-preview mx-auto max-w-3xl">
                <h1 className="mb-4 text-3xl font-extrabold leading-tight">{m.title}</h1>
                {/* 블로거 원고는 테마의 jw-post 디자인(.entry-text .jw-post)을 미리보기에도 똑같이 적용 */}
                <div className={post.platform === "BLOGGER" ? "entry-text" : undefined} dangerouslySetInnerHTML={{ __html: post.html }} />
                {post.platform === "NAVER" && (
                  <p className="mt-6 text-sm text-green-700">{m.tags.map((t) => `#${t}`).join(" ")}</p>
                )}
              </article>
            )}
            {tab === "edit" && (locked ? <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">🔒 {editLockedMessage(post.status)}</p> : <ManuscriptEditor postId={id} initial={m} />)}
            {tab === "images" && (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm text-gray-500">AI 도구 사용법 글은 <b>직접 캡처한 화면</b>으로 교체하면 신뢰도(E-E-A-T)와 네이버 독창성 평가에 유리해요.</p>
                  {!locked && <ActionButton url={`/api/posts/${id}/action`} body={{ action: "images" }} label="🎨 이미지 전체 다시 만들기" confirm="기존 이미지를 모두 새로 만듭니다." />}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {post.assets.map((a) => (
                    <AssetCard key={a.id} locked={locked} a={{ id: a.id, slot: a.slot, src: a.publicUrl ?? "", alt: a.alt, source: a.source, credit: a.credit }} />
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
            {(() => {
              const r = (post.research ?? {}) as { facts?: { status: string }[]; selfCheck?: { before: string; after: string; evidence: string }[] };
              if (!r.facts && !r.selfCheck) return null;
              const n = (st: string) => (r.facts ?? []).filter((f) => f.status === st).length;
              return (
                <details className="card text-xs">
                  <summary className="cursor-pointer text-sm font-semibold">
                    🔎 작성 전·후 사실 확인 <span className="font-normal text-gray-500">— 핵심 수치 확인 {n("confirmed")} · 정정 {n("corrected")} · 미확인 {n("unverified")} · 작성 직후 고침 {r.selfCheck?.length ?? 0}</span>
                  </summary>
                  {r.selfCheck?.length ? (
                    <ul className="mt-2 flex flex-col gap-1">
                      {r.selfCheck.map((c, i) => (
                        <li key={i} className="rounded bg-gray-50 p-1.5">
                          <del className="text-red-600">{c.before}</del> → <ins className="text-emerald-700 no-underline">{c.after}</ins>
                          <div className="text-gray-400">{c.evidence}</div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-gray-500">작성 직후 점검에서 고친 곳은 없어요.</p>
                  )}
                </details>
              );
            })()}
            <AiReviewCard
              postId={id}
              locked={locked}
              review={(() => {
                const r = (post.aiReview ?? null) as Parameters<typeof AiReviewCard>[0]["review"];
                if (!r) return r;
                const lc = (post.aiReview as { linkCheck?: { broken: string[] } } | null)?.linkCheck;
                // 예전 검수 결과도 '사람이 할 일'만 보이게 (원고에 없는 내용·이미 유보한 내용·링크 확인 등은 뺌)
                const keepBroken = r.concerns.filter((c) => c.startsWith("깨진 내부 링크"));
                return { ...r, concerns: [...actionableItems(r.concerns.filter((c) => !c.startsWith("깨진 내부 링크")), { linksOk: !lc?.broken.length, hasScreenshots: !!m?.sections.some((s) => s.image?.source === "screenshot") }), ...keepBroken] };
              })()}
              atLabel={(post.aiReview as { at?: string } | null)?.at ? new Date((post.aiReview as { at: string }).at).toLocaleString("ko-KR") : undefined}
            />
            <ReviewPanel
              postId={id}
              report={report}
              checklist={[
                ...actionableItems(m.reviewChecklist, {
                  linksOk: !((post.aiReview as { linkCheck?: { broken: string[] } } | null)?.linkCheck?.broken.length),
                  hasScreenshots: m.sections.some((s) => s.image?.source === "screenshot"),
                }),
                ...(m.affiliate.length ? ["제휴 링크와 대가성 문구가 맞는지 확인"] : []),
              ]}
              tip={post.platform === "NAVER" ? "클립(숏폼)을 30초 안팎으로 만들어 넣으면 검색·홈피드 노출 면적이 넓어져요(선택)." : undefined}
              reviewerNote={post.reviewerNote}
              meta={{ keyword: m.focusKeyword, description: m.metaDescription, slug: m.slug, tags: m.tags, sources: m.sources }}
            />
            <div className="card flex flex-col gap-2 text-sm">
              <h3 className="font-semibold">원고 관리</h3>
              {canRegenerate(post.status) ? (
                <>
                  <ActionButton url={`/api/posts/${id}/action`} body={{ action: "regenerate" }} label="🤖 AI로 원고 다시 쓰기" confirm="현재 원고와 이미지를 새로 생성합니다. 수정 내용은 사라져요." />
                  <UserSourcesForm postId={id} initial={userSourcesOf(post.research)} />
                </>
              ) : (
                post.status !== "GENERATING" && <p className="text-xs text-gray-500">🔒 {editLockedMessage(post.status)}</p>
              )}
              {!locked && <AffiliateAdder postId={id} products={affiliateProducts} sections={m.sections.map((s) => s.heading)} used={m.affiliate.length} />}
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

/** 블로그 본문 미리보기 — 블로그의 스크립트·스타일이 대시보드에 섞이지 않게 격리된 iframe 으로 */
function RemoteFrame({ html: raw }: { html: string }) {
  // 블로그 스크립트는 미리보기에 필요 없고 격리 iframe 에서 막혀 오류만 남기므로 미리 뺌
  const html = raw.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son[a-z]+="[^"]*"/gi, "");
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;line-height:1.7;padding:16px;color:#111;max-width:760px;margin:auto}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px}</style></head><body>${html}</body></html>`;
  return <iframe title="블로그 현재본" sandbox="allow-popups" srcDoc={doc} className="h-[70vh] w-full rounded-lg border bg-white" />;
}
