import { fail, handle, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";

/** 황금키워드 발굴 실행 (이미 돌고 있으면 새로 만들지 않음) */
export const POST = handle(async () => {
  const running = await db.job.findFirst({ where: { type: "topic.golden", status: { in: ["QUEUED", "RUNNING"] } } });
  if (running) return fail("황금키워드 발굴이 이미 진행 중이에요. 끝나면 결과가 자동으로 보여요.");
  return ok({ jobId: (await enqueue("topic.golden", {})).id });
});
