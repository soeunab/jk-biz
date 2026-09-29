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
