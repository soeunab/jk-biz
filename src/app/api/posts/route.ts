import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { createPostsFromTopic, createRepublish, generationWarnings } from "@/lib/content/service";
import { normalizeKeyword, scoreKeyword } from "@/lib/topics/scoring";
import { guessTool } from "@/lib/topics/discover";
import { ensureKeywordInTitle, expandKeyword, isHeadKeyword, relatedOf } from "@/lib/topics/longtail";
import { asObject } from "@/lib/util";

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
  const input = b.keyword.trim();
  // 롱테일 확장: 입력 키워드를 자동완성·"함께 많이 찾는"으로 넓히고 문구마다 네이버 공식 검색량 확인.
  // 입력이 헤드 키워드(ai·클로드처럼 과포화된 짧은 단어)면 검색량이 확인된 최적 롱테일로 바꿔 씁니다 — 상위 노출이 목적.
  const lt = await expandKeyword(input, { docs: 8 }).catch(() => null);
  const inputMetric = lt?.candidates.find((c) => normalizeKeyword(c.keyword) === normalizeKeyword(input)) ?? null;
  const switched = isHeadKeyword(input) && lt?.best ? lt.best : null;
  const focus = switched?.keyword ?? input;
  const metric = switched ?? inputMetric;
  const norm = normalizeKeyword(focus);
  const s = scoreKeyword(
    { keyword: focus, monthlySearch: metric?.volume ?? null, documentCount: metric?.documentCount ?? null, compIdx: metric?.compIdx ?? null, sources: ["manual", ...(metric?.sources ?? [])] },
    [],
    true,
  );
  const related = (lt?.candidates ?? []).filter((c) => normalizeKeyword(c.keyword) !== norm).slice(0, 12).map((c) => ({ keyword: c.keyword, volume: c.volume }));
  const vol = metric?.volume != null ? `월 검색 ${metric.volume.toLocaleString("ko-KR")}회` : null;
  const rationale = switched
    ? `입력한 "${input}"은 문서가 과포화된 헤드 키워드라, 실제로 검색되는 롱테일 "${focus}"(${vol})로 작성합니다.`
    : vol
      ? `직접 입력한 키워드 — 네이버 ${vol}`
      : "직접 입력한 키워드 (검색 데이터 미확인)";
  // 같은 키워드 주제가 이미 있으면 재사용 (중복 주제 방지). 연관 롱테일이 없던 주제면 채워 둠
  const found = await db.topic.findFirst({ where: { normalizedKeyword: norm } });
  if (found && !relatedOf(found.signals) && related.length) {
    await db.topic.update({ where: { id: found.id }, data: { signals: { ...asObject<Record<string, unknown>>(found.signals, {}), related } as Prisma.InputJsonValue } });
  }
  const topic =
    found ??
    (await db.topic.create({
      data: {
        keyword: focus,
        normalizedKeyword: norm,
        title: b.title?.trim() ? ensureKeywordInTitle(b.title, focus) : focus,
        angle: b.angle ?? "",
        persona: b.persona ?? "GENERAL",
        tool: b.tool || guessTool(focus),
        intent: s.intent,
        searchVolume: metric?.volume ?? null,
        documentCount: metric?.documentCount ?? null,
        competitionScore: s.competitionScore,
        totalScore: s.total,
        monetizationScore: s.monetizationScore,
        confidence: s.confidence,
        verification: s.verification,
        rationale,
        signals: { sources: ["manual"], input, longtail: lt ? { base: input, best: lt.best?.keyword ?? null, candidates: lt.candidates.slice(0, 10) } : null, related } as Prisma.InputJsonValue,
        status: "SELECTED",
      },
    }));
  const { posts, skipped } = await createPostsFromTopic(topic.id, accounts.map((a) => ({ platform: a.platform as "BLOGGER" | "NAVER", accountId: a.id })));
  if (!posts.length) return fail(`중복이라 만들지 않았어요 — ${skipped.join(" / ")}`);
  const warnings = await generationWarnings(posts.flatMap((p) => (p.accountId ? [p.accountId] : [])));
  if (switched) warnings.unshift(rationale);
  return ok({ posts: posts.map((p) => p.id), skipped, warnings, redirect: posts.length === 1 ? `/posts/${posts[0].id}` : "/posts" });
});
