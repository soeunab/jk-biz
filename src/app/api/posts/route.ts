import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { createPostsFromTopic, createRepublish, generationWarnings } from "@/lib/content/service";
import { normalizeKeyword, scoreKeyword } from "@/lib/topics/scoring";
import { guessTool } from "@/lib/topics/discover";

/** 주제 발굴 없이 키워드를 직접 입력해 원고 만들기 */
export const POST = handle(async (req: Request) => {
  const b = (await req.json()) as { keyword: string; title?: string; persona?: string; tool?: string; angle?: string; accountIds: string[]; sourcePostId?: string };
  // 재발행 원본을 지정하면 원본의 주제·키워드를 이어받아 계정별로 재발행 원고 생성
  if (b.sourcePostId) {
    if (!b.accountIds?.length) return fail("블로그 계정을 1개 이상 선택하세요.");
    const created: string[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const accountId of b.accountIds) {
      try {
        const r = await createRepublish(b.sourcePostId, accountId);
        created.push(r.post.id);
        warnings.push(...r.warnings);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (!created.length) return fail(errors.join(" / "));
    return ok({ posts: created, skipped: errors, warnings, redirect: created.length === 1 ? `/posts/${created[0]}` : "/posts" });
  }
  if (!b.keyword?.trim() && !b.sourcePostId) return fail("키워드를 입력하세요.");
  const accounts = await db.account.findMany({ where: { id: { in: b.accountIds ?? [] }, platform: { in: ["BLOGGER", "NAVER"] } } });
  if (!accounts.length) return fail("블로그 계정을 1개 이상 선택하세요.");
  const norm = normalizeKeyword(b.keyword);
  const s = scoreKeyword({ keyword: b.keyword, sources: ["manual"] });
  // 같은 키워드 주제가 이미 있으면 재사용 (중복 주제 방지)
  const topic =
    (await db.topic.findFirst({ where: { normalizedKeyword: norm } })) ??
    (await db.topic.create({
    data: {
      keyword: b.keyword.trim(),
      normalizedKeyword: norm,
      title: b.title?.trim() || b.keyword.trim(),
      angle: b.angle ?? "",
      persona: b.persona ?? "GENERAL",
      tool: b.tool || guessTool(b.keyword),
      intent: s.intent,
      totalScore: s.total,
      monetizationScore: s.monetizationScore,
      confidence: 0,
      verification: "UNVERIFIED",
      rationale: "직접 입력한 키워드 (검색 데이터 미확인)",
      signals: { sources: ["manual"] },
      status: "SELECTED",
    },
    }));
  const { posts, skipped } = await createPostsFromTopic(topic.id, accounts.map((a) => ({ platform: a.platform as "BLOGGER" | "NAVER", accountId: a.id })));
  if (!posts.length) return fail(`중복이라 만들지 않았어요 — ${skipped.join(" / ")}`);
  return ok({ posts: posts.map((p) => p.id), skipped, warnings: await generationWarnings(posts.flatMap((p) => (p.accountId ? [p.accountId] : []))), redirect: posts.length === 1 ? `/posts/${posts[0].id}` : "/posts" });
});
