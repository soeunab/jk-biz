import { db } from "@/lib/db";
import { handle, ok } from "@/lib/api";
import { enqueue } from "@/lib/jobs/queue";

/** 제목 재작성·보강·정리 제안을 AI 로 만들기 (제안만 — 글은 바뀌지 않음) */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const job = await enqueue("post.optimize", { insightId: (await params).id });
  return ok({ jobId: job.id });
});

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { status } = (await req.json()) as { status: "OPEN" | "DONE" | "DISMISSED" };
  await db.insight.update({ where: { id: (await params).id }, data: { status } });
  return ok();
});
