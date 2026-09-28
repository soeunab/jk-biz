import { handle, ok } from "@/lib/api";
import { enqueue } from "@/lib/jobs/queue";

export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as { seeds?: string; platform?: string; persona?: string; limit?: number };
  const seeds = (body.seeds ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const job = await enqueue("topic.discover", { seeds, platform: body.platform ?? "BOTH", persona: body.persona ?? "ANY", limit: Number(body.limit) || 12 });
  return ok({ jobId: job.id });
});
