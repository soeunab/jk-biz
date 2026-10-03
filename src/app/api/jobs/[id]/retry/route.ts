import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { enqueueOnce, type JobType } from "@/lib/jobs/queue";

/** 실패한 작업만 다시 실행 (끝난 발행 작업을 다시 돌리면 같은 글이 또 올라갈 수 있음) */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const job = await db.job.findUniqueOrThrow({ where: { id: (await params).id } });
  if (job.status !== "FAILED") return fail("실패한 작업만 다시 실행할 수 있어요.");
  const next = await enqueueOnce(job.type as JobType, (job.payload ?? {}) as Record<string, unknown>);
  return ok({ jobId: next.id });
});
