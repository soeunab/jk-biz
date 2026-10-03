import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { enqueueOnce } from "@/lib/jobs/queue";
import { editLockedMessage, isEditLocked } from "@/lib/content/postStatus";

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = (await params).id;
  const { index, instruction } = (await req.json()) as { index: number; instruction?: string };
  if (!Number.isInteger(index) || index < 0) return fail("섹션 번호가 올바르지 않습니다.");
  const post = await db.post.findUniqueOrThrow({ where: { id }, select: { status: true } });
  if (isEditLocked(post.status)) return fail(editLockedMessage(post.status));
  const job = await enqueueOnce("post.rewriteSection", { postId: id, index, instruction: instruction ?? "" });
  // 한 원고의 섹션 다시 쓰기는 한 번에 하나씩 — 동시에 돌면 나중 결과가 앞 결과를 덮어씀
  if ((job.payload as { index?: number } | null)?.index !== index) return fail("다른 섹션을 다시 쓰는 중이에요. 끝난 뒤 다시 시도하세요.");
  return ok({ jobId: job.id });
});
