import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { rerenderPost } from "@/lib/content/service";
import { ManuscriptSchema } from "@/lib/content/types";
import { editLockedMessage, isEditLocked } from "@/lib/content/postStatus";

type Ctx = { params: Promise<{ id: string }> };

/** 검수자가 수정한 원고 저장 → HTML·SEO 점수 재계산 */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const id = (await params).id;
  const body = (await req.json()) as { manuscript?: unknown; reviewerNote?: string; accountId?: string | null };
  const data: Prisma.PostUpdateInput = {};
  // 승인·공개 후에는 원고·계정을 바꾸지 않음(공개 단계는 승인된 내용을 그대로 내보내므로 어긋남). 검수 메모는 언제든 저장 가능
  if (body.manuscript !== undefined || body.accountId !== undefined) {
    const cur = await db.post.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (isEditLocked(cur.status)) return fail(editLockedMessage(cur.status));
  }
  if (body.manuscript !== undefined) {
    const parsed = ManuscriptSchema.safeParse(body.manuscript);
    if (!parsed.success) return fail(`원고 형식 오류: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
    const m = parsed.data;
    Object.assign(data, { content: m as unknown as Prisma.InputJsonValue, title: m.title, slug: m.slug, metaDescription: m.metaDescription, focusKeyword: m.focusKeyword, tags: m.tags });
  }
  if (body.reviewerNote !== undefined) data.reviewerNote = body.reviewerNote;
  if (body.accountId !== undefined) data.account = body.accountId ? { connect: { id: body.accountId } } : { disconnect: true };
  await db.post.update({ where: { id }, data });
  const report = await rerenderPost(id);
  return ok({ seoScore: report.score });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const post = await db.post.delete({ where: { id: (await params).id } });
  if (post.topicId) {
    const remaining = await db.post.count({ where: { topicId: post.topicId } });
    // 이 주제로 만든 원고를 마지막 하나까지 지웠으면 "원고 작성됨" 표시를 되돌려 다시 주제로 쓸 수 있게 합니다.
    if (remaining === 0) await db.topic.updateMany({ where: { id: post.topicId, status: "USED" }, data: { status: "NEW" } });
  }
  return ok({ redirect: "/posts" });
});
