import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { enqueue } from "@/lib/jobs/queue";

/** 원고에서 만든 카드뉴스는 원고가 사람 승인(또는 공개)된 뒤에만 SNS 로 내보냄 */
const SOCIAL_ALLOWED_POST_STATUS = ["APPROVED", "PUBLISHED"];

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const cardNewsId = (await params).id;
  const { accountIds } = (await req.json()) as { accountIds: string[] };
  const card = await db.cardNews.findUniqueOrThrow({ where: { id: cardNewsId }, include: { post: { select: { status: true } } } });
  if (card.postId && !SOCIAL_ALLOWED_POST_STATUS.includes(card.post?.status ?? "")) return fail("원고 승인 후 SNS 발행할 수 있어요.");
  const accounts = await db.account.findMany({ where: { id: { in: accountIds ?? [] }, platform: { in: ["INSTAGRAM", "THREADS", "FACEBOOK"] } } });
  if (!accounts.length) return fail("발행할 SNS 계정을 선택하세요.");
  const jobIds: string[] = [];
  for (const a of accounts) {
    const sp = await db.socialPost.create({ data: { cardNewsId, accountId: a.id, platform: a.platform } });
    jobIds.push((await enqueue("cardnews.publish", { socialPostId: sp.id })).id);
  }
  return ok({ jobIds });
});
