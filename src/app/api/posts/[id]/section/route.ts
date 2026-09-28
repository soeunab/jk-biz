import { fail, handle, ok } from "@/lib/api";
import { enqueue } from "@/lib/jobs/queue";

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { index, instruction } = (await req.json()) as { index: number; instruction?: string };
  if (!Number.isInteger(index) || index < 0) return fail("섹션 번호가 올바르지 않습니다.");
  return ok({ jobId: (await enqueue("post.rewriteSection", { postId: (await params).id, index, instruction: instruction ?? "" })).id });
});
