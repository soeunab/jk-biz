import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { guessTool } from "@/lib/topics/discover";
import { normalizeKeyword, scoreKeyword } from "@/lib/topics/scoring";

/** 연관 키워드 표에서 "주제로 추가" — 공식 데이터가 있는 키워드만 VERIFIED 로 저장 */
export const POST = handle(async (req: Request) => {
  const b = (await req.json()) as { keyword: string; monthlySearch?: number; documentCount?: number | null; compIdx?: string };
  if (!b.keyword?.trim()) return fail("키워드가 없습니다.");
  const norm = normalizeKeyword(b.keyword);
  const dup = await db.topic.findFirst({ where: { normalizedKeyword: norm } });
  if (dup) return fail(`이미 주제 목록에 있는 키워드예요: ${dup.keyword}`);
  const metrics = { keyword: b.keyword.trim(), monthlySearch: b.monthlySearch ?? null, documentCount: b.documentCount ?? null, compIdx: b.compIdx ?? null, sources: ["naver-searchad"] };
  const s = scoreKeyword(metrics);
  await db.topic.create({
    data: {
      keyword: metrics.keyword,
      normalizedKeyword: norm,
      title: metrics.keyword,
      tool: guessTool(metrics.keyword),
      intent: s.intent,
      targetPlatform: s.targetPlatform,
      searchVolume: metrics.monthlySearch,
      documentCount: metrics.documentCount,
      competitionScore: s.competitionScore,
      trendScore: s.trendScore,
      monetizationScore: s.monetizationScore,
      totalScore: s.total,
      confidence: s.confidence,
      verification: s.verification,
      rationale: "연관 키워드 도구에서 직접 추가 (네이버 검색광고 공식 데이터)",
      signals: { ...s, sources: metrics.sources, compIdx: metrics.compIdx },
    },
  });
  return ok();
});
