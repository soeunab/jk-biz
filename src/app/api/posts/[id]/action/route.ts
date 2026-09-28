import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { enqueue } from "@/lib/jobs/queue";
import { createCardNews } from "@/lib/cardnews";
import { getBrand } from "@/lib/brand";
import { readManuscript, researchNotesOf } from "@/lib/content/service";
import { readinessIssues } from "@/lib/content/readiness";

type Action = "regenerate" | "images" | "publishPrivate" | "approve" | "publishPublic" | "markPublished" | "cardnews" | "unapprove" | "reject" | "reopen";

/**
 * 원고 워크플로
 * DRAFT → (publishPrivate) → PRIVATE[검수 대기] → (approve) → APPROVED → (publishPublic) → PUBLISHED
 *                                    └─ (reject) → REJECTED[반려] → (reopen) → DRAFT
 * 모든 상태 전환은 사람이 버튼으로 명시적으로 호출할 때만 일어납니다.
 */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = (await params).id;
  const { action, url, force, reason } = (await req.json()) as { action: Action; url?: string; force?: boolean; reason?: string };
  const post = await db.post.findUniqueOrThrow({ where: { id } });

  switch (action) {
    case "regenerate": {
      await db.post.update({ where: { id }, data: { status: "GENERATING", error: null } });
      return ok({ jobId: (await enqueue("post.generate", { postId: id })).id });
    }
    case "images":
      return ok({ jobId: (await enqueue("post.images", { postId: id })).id });
    case "publishPrivate":
      if (!post.accountId) return fail("발행할 계정을 먼저 지정하세요.");
      if (!["DRAFT", "PRIVATE", "FAILED"].includes(post.status) || !post.html) return fail("원고가 완성된 뒤에 발행할 수 있어요.");
      return ok({ jobId: (await enqueue("post.publishPrivate", { postId: id })).id });
    case "approve": {
      if (post.status !== "PRIVATE") return fail("비공개 발행(검수 대기) 상태에서만 승인할 수 있어요.");
      const m = readManuscript(post.content);
      const sim = (post.seoReport as { similarity?: { warn: boolean; max: number; with: { title: string } | null } } | null)?.similarity;
      const issues = m ? readinessIssues(m, { brand: await getBrand(), similarity: sim, renderedHtml: post.html, researchNotes: researchNotesOf(post.research) }) : [];
      // 확인 사유가 있으면 한 번 알려 주고, 검수자가 확인한 뒤(force) 승인
      if (issues.length && !force) return ok({ needsConfirm: true, issues: issues.map((i) => i.message) });
      await db.post.update({ where: { id }, data: { status: "APPROVED", reviewerNote: issues.length ? `${post.reviewerNote}\n[승인 시 확인한 사유] ${issues.map((i) => i.message).join(" / ")}`.trim() : post.reviewerNote } });
      return ok();
    }
    case "reject":
      if (!["PRIVATE", "APPROVED", "DRAFT"].includes(post.status)) return fail("검수 중인 원고만 반려할 수 있어요.");
      await db.post.update({ where: { id }, data: { status: "REJECTED", reviewerNote: `${post.reviewerNote}\n[반려] ${reason ?? ""}`.trim() } });
      return ok();
    case "reopen":
      if (post.status !== "REJECTED") return fail("반려된 원고만 다시 열 수 있어요.");
      await db.post.update({ where: { id }, data: { status: "DRAFT" } });
      return ok();
    case "unapprove":
      await db.post.update({ where: { id }, data: { status: "PRIVATE" } });
      return ok();
    case "publishPublic":
      if (post.status !== "APPROVED") return fail("사람 검수(승인) 후에만 공개 발행할 수 있어요.");
      return ok({ jobId: (await enqueue("post.publishPublic", { postId: id })).id });
    case "markPublished":
      // 네이버 등에서 사람이 직접 공개한 경우
      await db.post.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date(), remoteUrl: url?.trim() || post.remoteUrl } });
      return ok();
    case "cardnews": {
      const card = await createCardNews({ postId: id });
      const job = await enqueue("cardnews.generate", { cardNewsId: card.id });
      return ok({ jobId: job.id, redirect: `/cardnews/${card.id}` });
    }
    default:
      return fail("알 수 없는 작업");
  }
});
