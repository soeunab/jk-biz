import { handle, ok } from "@/lib/api";
import { enqueue } from "@/lib/jobs/queue";

export const POST = handle(async () => ok({ jobId: (await enqueue("insights.generate", {})).id }));
