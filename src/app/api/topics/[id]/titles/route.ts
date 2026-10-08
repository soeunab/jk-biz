import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { enqueue } from "@/lib/jobs/queue";

/** 고른 롱테일 키워드 하나에 6가지 유형 제목 만들기 (상위 글 벤치마킹 포함, 워커가 브라우저로 진행) */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const topic = await db.topic.findUnique({ where: { id: (await params).id }, select: { id: true, origin: true } });
  if (!topic) return fail("주제를 찾을 수 없습니다.");
  if (topic.origin === "channels") return fail("실시간 트렌드 키워드는 제목 만들기 없이 바로 원고를 생성해요.");
  const job = await enqueue("topic.titles", { topicId: topic.id });
  return ok({ jobId: job.id });
});
