import { fail, handle, ok } from "@/lib/api";
import { createRepublish } from "@/lib/content/service";

/** 크로스플랫폼 재발행: 이 글을 원본으로 다른 계정용 원고 생성 */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { accountId } = (await req.json()) as { accountId?: string };
  if (!accountId) return fail("재발행할 계정을 선택하세요.");
  try {
    const { post, warnings } = await createRepublish((await params).id, accountId);
    return ok({ postId: post.id, warnings, redirect: `/posts/${post.id}` });
  } catch (e) {
    return fail((e as Error).message);
  }
});
