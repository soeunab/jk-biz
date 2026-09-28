import { db } from "@/lib/db";
import { handle, ok } from "@/lib/api";
import { enqueue, type JobType } from "@/lib/jobs/queue";

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const job = await db.job.findUniqueOrThrow({ where: { id: (await params).id } });
  const next = await enqueue(job.type as JobType, (job.payload ?? {}) as Record<string, unknown>);
  return ok({ jobId: next.id });
});
