import { handle, ok } from "@/lib/api";
import { enqueue } from "@/lib/jobs/queue";
import { applyAiReview } from "@/lib/content/review";

type Ctx = { params: Promise<{ id: string }> };

/** AI 사실 검수 실행 */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  return ok({ jobId: (await enqueue("post.aiReview", { postId: (await params).id })).id });
});

/** 사람이 선택한 제안 적용 */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { indices } = (await req.json()) as { indices: number[] };
  return ok(await applyAiReview((await params).id, indices ?? []));
});
