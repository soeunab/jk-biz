import { handle, ok } from "@/lib/api";
import { enqueue } from "@/lib/jobs/queue";

/** 검색어 기반 발굴 — 사용자가 입력한 키워드로 롱테일 데이터를 모아 6가지 유형 제목까지 만듦 */
export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as { seeds?: string; limit?: number };
  const seeds = (body.seeds ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const job = await enqueue("topic.discover", { seeds, limit: Number(body.limit) || 12 });
  return ok({ jobId: job.id });
});
