import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { enqueue } from "@/lib/jobs/queue";
import { createCardNews } from "@/lib/cardnews";

type Action = "regenerate" | "images" | "publishPrivate" | "approve" | "publishPublic" | "markPublished" | "cardnews" | "unapprove";

/**
 * 원고 워크플로
 * DRAFT → (publishPrivate) → PRIVATE[검수 대기] → (approve) → APPROVED → (publishPublic) → PUBLISHED
 */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = (await params).id;
  const { action, url } = (await req.json()) as { action: Action; url?: string };
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
    case "approve":
      if (post.status !== "PRIVATE") return fail("비공개 발행(검수 대기) 상태에서만 승인할 수 있어요.");
      await db.post.update({ where: { id }, data: { status: "APPROVED" } });
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
