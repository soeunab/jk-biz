import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { enqueue } from "@/lib/jobs/queue";

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const cardNewsId = (await params).id;
  const { accountIds } = (await req.json()) as { accountIds: string[] };
  const accounts = await db.account.findMany({ where: { id: { in: accountIds ?? [] }, platform: { in: ["INSTAGRAM", "THREADS", "FACEBOOK"] } } });
  if (!accounts.length) return fail("발행할 SNS 계정을 선택하세요.");
  const jobIds: string[] = [];
  for (const a of accounts) {
    const sp = await db.socialPost.create({ data: { cardNewsId, accountId: a.id, platform: a.platform } });
    jobIds.push((await enqueue("cardnews.publish", { socialPostId: sp.id })).id);
  }
  return ok({ jobIds });
});
