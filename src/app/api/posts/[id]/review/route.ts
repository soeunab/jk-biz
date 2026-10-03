import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { enqueueOnce } from "@/lib/jobs/queue";
import { applyAiReview } from "@/lib/content/review";
import { editLockedMessage, isEditLocked } from "@/lib/content/postStatus";

type Ctx = { params: Promise<{ id: string }> };

/** AI 사실 검수 실행 */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const id = (await params).id;
  const post = await db.post.findUniqueOrThrow({ where: { id }, select: { status: true } });
  if (isEditLocked(post.status)) return fail(editLockedMessage(post.status));
  return ok({ jobId: (await enqueueOnce("post.aiReview", { postId: id })).id });
});

/** 사람이 선택한 제안 적용 */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const id = (await params).id;
  const { indices } = (await req.json()) as { indices: number[] };
  const post = await db.post.findUniqueOrThrow({ where: { id }, select: { status: true } });
  if (isEditLocked(post.status)) return fail(editLockedMessage(post.status));
  return ok(await applyAiReview(id, indices ?? []));
});
