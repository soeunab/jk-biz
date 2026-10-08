import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { enqueue } from "@/lib/jobs/queue";

/** 프로그램 없이 직접 작성해 발행한 글을 등록 — 본문을 가져와 미리보기·개선 제안·조회수 분석에 쓰고, [원고로 변환]하면 검수·카드뉴스·재발행까지 */
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
    data: { accountId, platform: account.platform, title, remoteUrl, status: "PUBLISHED", publishedAt, origin: "imported" },
  });
  // 등록하면서 블로그에 올라간 본문·제목·발행일을 바로 가져옴 (글은 바꾸지 않음)
  await enqueue("post.syncRemote", { postId: post.id });
  return ok({ id: post.id });
});
