import type { Prisma } from "@prisma/client";
import { db } from "../db";

/**
 * DB 기반 작업 큐. 대시보드(API)는 enqueue 만 하고,
 * 오래 걸리는 작업(원고 생성·이미지·발행·분석 동기화)은 워커(scripts/worker.ts)가 처리합니다.
 */
export type JobType =
  | "topic.discover"
  | "post.generate"
  | "post.images"
  | "post.aiReview"
  | "post.rewriteSection"
  | "post.publishPrivate"
  | "post.publishPublic"
  | "cardnews.generate"
  | "cardnews.publish"
  | "analytics.sync"
  | "insights.generate";

export async function enqueue(type: JobType, payload: Record<string, unknown> = {}, runAt?: Date) {
  return db.job.create({ data: { type, payload: payload as Prisma.InputJsonValue, runAt: runAt ?? new Date() } });
}

/** 가장 오래된 대기 작업 하나를 원자적으로 가져옵니다. */
export async function claimNext() {
  const next = await db.job.findFirst({
    where: { status: "QUEUED", runAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
  });
  if (!next) return null;
  const claimed = await db.job.updateMany({
    where: { id: next.id, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
  });
  return claimed.count === 1 ? db.job.findUnique({ where: { id: next.id } }) : null;
}

export class JobContext {
  constructor(public readonly jobId: string) {}

  async log(message: string) {
    const line = `[${new Date().toLocaleTimeString("ko-KR", { hour12: false })}] ${message}\n`;
    console.log(`[job ${this.jobId.slice(-6)}] ${message}`);
    const job = await db.job.findUnique({ where: { id: this.jobId }, select: { log: true } });
    await db.job.update({ where: { id: this.jobId }, data: { log: (job?.log ?? "") + line } });
  }

  async progress(pct: number, message?: string) {
    await db.job.update({ where: { id: this.jobId }, data: { progress: Math.round(pct) } });
    if (message) await this.log(message);
  }
}

export async function completeJob(id: string, result: unknown) {
  await db.job.update({
    where: { id },
    data: { status: "DONE", progress: 100, finishedAt: new Date(), result: (result ?? {}) as Prisma.InputJsonValue },
  });
}

export async function failJob(id: string, error: unknown) {
  const msg = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  await db.job.update({ where: { id }, data: { status: "FAILED", finishedAt: new Date(), error: msg.slice(0, 4000) } });
}

/** 워커가 비정상 종료되어 RUNNING 으로 남은 작업을 재시작 시 정리합니다. */
export async function recoverStaleJobs(olderThanMinutes = 30) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  return db.job.updateMany({
    where: { status: "RUNNING", startedAt: { lt: cutoff } },
    data: { status: "FAILED", error: "워커 중단으로 작업이 완료되지 않았습니다. 다시 실행해 주세요.", finishedAt: new Date() },
  });
}
