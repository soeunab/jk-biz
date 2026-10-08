import { db } from "../db";
import type { JobContext } from "../jobs/queue";

/** 보류(DISMISSED) 상태로 며칠 지난 주제를 정리할지 (기본 7일) */
const DISMISSED_DAYS = 7;

/** 7일 넘게 보류 상태로 남아 있는 주제를 삭제합니다. 복원(NEW로 되돌림)하면 dismissedAt 이 지워져 대상에서 빠집니다. */
export async function cleanupDismissedTopics(ctx?: JobContext) {
  const cutoff = new Date(Date.now() - DISMISSED_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await db.topic.deleteMany({ where: { status: "DISMISSED", dismissedAt: { lt: cutoff } } });
  await ctx?.log(`보류 ${DISMISSED_DAYS}일 지난 주제 ${count}개 삭제`);
  return { deleted: count };
}

/** 황금키워드: 마지막 수집보다 30일 넘게 다시 안 나온 키워드, 30일 지난 작업 기록을 정리 */
const GOLDEN_UNSEEN_DAYS = 30;
const GOLDEN_JOB_KEEP_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/**
 * 황금키워드 표가 끝없이 커지지 않게 정리합니다.
 * - 업종 수집·자동완성에서 30일 넘게 다시 나오지 않은 키워드 삭제 — 기준은 '지금'이 아니라 **마지막 수집 시각**이라,
 *   한동안 발굴을 안 돌려도 멀쩡한 키워드가 지워지지 않습니다. 주제·원고로 쓴 키워드는 남김.
 * - 검색량이 월 100 아래로 떨어진 키워드는 수집할 때 바로 정리됨(golden.ts dropBelowMin).
 * - 황금키워드 작업 기록(조각마다 1줄)은 30일 치만 보관.
 */
export async function cleanupGolden(ctx?: JobContext) {
  const latest = await db.goldenKeyword.findFirst({ where: { source: "industry", seenAt: { not: null } }, orderBy: { seenAt: "desc" }, select: { seenAt: true } });
  let keywords = 0;
  if (latest?.seenAt) {
    const cutoff = new Date(latest.seenAt.getTime() - GOLDEN_UNSEEN_DAYS * DAY);
    const [posts, topics] = await Promise.all([db.post.findMany({ select: { normalizedKeyword: true } }), db.topic.findMany({ select: { normalizedKeyword: true } })]);
    const used = [...new Set([...posts, ...topics].map((x) => x.normalizedKeyword).filter(Boolean))];
    keywords = (await db.goldenKeyword.deleteMany({ where: { seenAt: { lt: cutoff }, normalized: { notIn: used } } })).count;
  }
  const jobs = (
    await db.job.deleteMany({ where: { type: "topic.golden", status: { in: ["DONE", "FAILED"] }, createdAt: { lt: new Date(Date.now() - GOLDEN_JOB_KEEP_DAYS * DAY) } } })
  ).count;
  await ctx?.log(`황금키워드 정리: ${GOLDEN_UNSEEN_DAYS}일 넘게 다시 안 나온 키워드 ${keywords}개 · ${GOLDEN_JOB_KEEP_DAYS}일 지난 작업 기록 ${jobs}개 삭제`);
  return { keywords, jobs };
}
