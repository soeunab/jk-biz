import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { createPostsFromTopic } from "@/lib/content/service";

/** 주제 → 선택한 계정들에 대한 원고 생성 작업 등록 */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { accountIds } = (await req.json()) as { accountIds: string[] };
  const accounts = await db.account.findMany({ where: { id: { in: accountIds ?? [] }, platform: { in: ["BLOGGER", "NAVER"] } } });
  if (!accounts.length) return fail("원고를 만들 블로그 계정을 1개 이상 선택하세요.");
  const posts = await createPostsFromTopic(
    (await params).id,
    accounts.map((a) => ({ platform: a.platform as "BLOGGER" | "NAVER", accountId: a.id })),
  );
  return ok({ posts: posts.map((p) => p.id), redirect: posts.length === 1 ? `/posts/${posts[0].id}` : "/posts" });
});
