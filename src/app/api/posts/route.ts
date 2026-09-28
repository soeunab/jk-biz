import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { createPostsFromTopic } from "@/lib/content/service";
import { scoreKeyword } from "@/lib/topics/scoring";
import { guessTool } from "@/lib/topics/discover";

/** 주제 발굴 없이 키워드를 직접 입력해 원고 만들기 */
export const POST = handle(async (req: Request) => {
  const b = (await req.json()) as { keyword: string; title?: string; persona?: string; tool?: string; angle?: string; accountIds: string[] };
  if (!b.keyword?.trim()) return fail("키워드를 입력하세요.");
  const accounts = await db.account.findMany({ where: { id: { in: b.accountIds ?? [] }, platform: { in: ["BLOGGER", "NAVER"] } } });
  if (!accounts.length) return fail("블로그 계정을 1개 이상 선택하세요.");
  const s = scoreKeyword({ keyword: b.keyword, sources: ["manual"] });
  const topic = await db.topic.create({
    data: {
      keyword: b.keyword.trim(),
      title: b.title?.trim() || b.keyword.trim(),
      angle: b.angle ?? "",
      persona: b.persona ?? "GENERAL",
      tool: b.tool || guessTool(b.keyword),
      intent: s.intent,
      totalScore: s.total,
      monetizationScore: s.monetizationScore,
      rationale: "직접 입력한 키워드",
      signals: { sources: ["manual"] },
      status: "SELECTED",
    },
  });
  const posts = await createPostsFromTopic(topic.id, accounts.map((a) => ({ platform: a.platform as "BLOGGER" | "NAVER", accountId: a.id })));
  return ok({ posts: posts.map((p) => p.id), redirect: posts.length === 1 ? `/posts/${posts[0].id}` : "/posts" });
});
