import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";

/** 프로그램 없이 직접 작성해 발행한 글을 등록 — AI 원고 없이 분석(조회수·수익) 매칭 대상으로만 추가 */
export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as { accountId?: string; title?: string; remoteUrl?: string; publishedAt?: string };
  const accountId = body.accountId?.trim();
  const title = body.title?.trim();
  const remoteUrl = body.remoteUrl?.trim();
  if (!accountId || !title || !remoteUrl) return fail("계정·제목·글 URL을 모두 입력해 주세요.");
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) return fail("계정을 찾을 수 없습니다.");
  if (await db.post.findFirst({ where: { remoteUrl } })) return fail("이미 등록된 글 URL입니다.");
  const publishedAt = body.publishedAt ? new Date(body.publishedAt) : new Date();
  if (isNaN(publishedAt.getTime())) return fail("발행일 형식이 올바르지 않습니다.");
  const post = await db.post.create({
    data: { accountId, platform: account.platform, title, remoteUrl, status: "PUBLISHED", publishedAt },
  });
  return ok({ id: post.id });
});
