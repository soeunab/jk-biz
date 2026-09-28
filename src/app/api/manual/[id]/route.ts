import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { extractJson } from "@/lib/llm";
import { formatZodError } from "@/lib/llm/manual";
import { SCHEMAS } from "@/lib/llm/schemas";
import { resumeJob } from "@/lib/jobs/queue";

type Ctx = { params: Promise<{ id: string }> };

/** 붙여 넣은 결과 제출 → 즉시 형식 검증 → 저장 후 원래 작업 이어서 실행 */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const id = (await params).id;
  const { text } = (await req.json()) as { text?: string };
  const mr = await db.manualRequest.findUniqueOrThrow({ where: { id } });
  if (mr.status !== "PENDING") return fail("이미 처리된 요청이에요.");
  if (!text?.trim()) return fail("AI 가 준 결과를 붙여 넣어 주세요.");

  let json: unknown;
  try {
    json = extractJson(text);
  } catch {
    return fail("붙여 넣은 내용에서 JSON 을 찾지 못했어요. AI 답변 전체(중괄호 { } 로 시작하고 끝나는 부분)를 복사해 주세요.");
  }
  const schema = SCHEMAS[mr.schemaName];
  if (!schema) return fail(`알 수 없는 형식: ${mr.schemaName}`);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return fail(`형식이 맞지 않는 항목이 있어요. AI 에게 "아래 항목을 스키마에 맞게 고쳐서 JSON 전체를 다시 출력해 줘"라고 요청한 뒤 다시 붙여 넣으세요.\n${formatZodError(parsed.error)}`);
  }

  await db.manualRequest.update({ where: { id }, data: { status: "DONE", response: parsed.data as Prisma.InputJsonValue, error: null } });
  if (mr.postId) await db.post.updateMany({ where: { id: mr.postId, status: "WAITING_MANUAL" }, data: { status: "GENERATING" } });
  if (mr.cardNewsId) await db.cardNews.updateMany({ where: { id: mr.cardNewsId, status: "WAITING_MANUAL" }, data: { status: "GENERATING" } });
  await resumeJob(mr.jobId);
  return ok({ jobId: mr.jobId });
});

/** 취소 — 작업을 실패로 정리 */
export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const mr = await db.manualRequest.update({ where: { id: (await params).id }, data: { status: "CANCELED" } });
  await db.job.update({ where: { id: mr.jobId }, data: { status: "FAILED", error: "수동 입력을 취소했어요.", finishedAt: new Date() } });
  if (mr.postId) await db.post.updateMany({ where: { id: mr.postId, status: "WAITING_MANUAL" }, data: { status: "FAILED", error: "수동 입력을 취소했어요. [AI로 원고 다시 쓰기]로 다시 시작할 수 있어요." } });
  if (mr.cardNewsId) await db.cardNews.updateMany({ where: { id: mr.cardNewsId, status: "WAITING_MANUAL" }, data: { status: "FAILED", error: "수동 입력을 취소했어요." } });
  return ok();
});
