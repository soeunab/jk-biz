import type { Prisma } from "@prisma/client";
import { db } from "../db";

/**
 * DB 기반 작업 큐. 대시보드(API)는 enqueue 만 하고,
 * 오래 걸리는 작업(원고 생성·이미지·발행·분석 동기화)은 워커(scripts/worker.ts)가 처리합니다.
 */
export type JobType =
  | "topic.discover"
  | "topic.channels"
  | "topic.titles"
  | "topic.cleanup"
  | "post.generate"
  | "post.images"
  | "post.aiReview"
  | "post.rewriteSection"
  | "post.publishPrivate"
  | "post.publishPublic"
  | "cardnews.generate"
  | "cardnews.publish"
  | "analytics.sync"
  | "insights.generate"
  | "post.optimize"
  | "topic.golden"
  | "post.syncRemote"
  | "post.convertRemote";

export async function enqueue(type: JobType, payload: Record<string, unknown> = {}, runAt?: Date) {
  return db.job.create({ data: { type, payload: payload as Prisma.InputJsonValue, runAt: runAt ?? new Date() } });
}

/** 같은 대상(원고·카드뉴스·SNS 글)을 가리키는 작업 식별 키 */
function targetKey(payload: unknown): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  for (const k of ["postId", "socialPostId", "cardNewsId"]) if (typeof p[k] === "string") return `${k}:${p[k]}`;
  return null;
}

/**
 * 같은 종류·같은 대상의 작업이 이미 대기·실행·수동 대기 중이면 새로 넣지 않고 그 작업을 돌려줍니다.
 * (발행 버튼 두 번 누름 → 네이버 비공개 글 두 개 같은 중복 실행 방지)
 */
export async function enqueueOnce(type: JobType, payload: Record<string, unknown> = {}) {
  const key = targetKey(payload);
  if (key) {
    const active = await db.job.findMany({ where: { type, status: { in: ["QUEUED", "RUNNING", "WAITING"] } }, orderBy: { createdAt: "asc" } });
    const same = active.find((j) => targetKey(j.payload) === key);
    if (same) return same;
  }
  return enqueue(type, payload);
}


/**
 * 오래 걸리는 백그라운드 작업 — 워커가 별도 줄(lane)에서 처리해, 원고 생성·제목 만들기 같은 일반 작업을 막지 않음.
 * (황금키워드 발굴은 블로그 섹션 화면을 초당 2회로 천천히 조회해 한 번에 1시간 이상 걸림)
 */
export const BACKGROUND_JOBS: JobType[] = ["topic.golden"];

/** 가장 오래된 대기 작업 하나를 원자적으로 가져옵니다. lane: background 면 BACKGROUND_JOBS 만, main 이면 그 외만 */
export async function claimNext(lane: "main" | "background" = "main") {
  const next = await db.job.findFirst({
    where: { status: "QUEUED", runAt: { lte: new Date() }, type: lane === "background" ? { in: BACKGROUND_JOBS } : { notIn: BACKGROUND_JOBS } },
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

/** 수동(복사·붙여넣기) 입력을 기다리는 상태로 멈춤 */
export async function waitForManual(id: string, title: string) {
  const job = await db.job.findUnique({ where: { id }, select: { log: true } });
  const line = `[${new Date().toLocaleTimeString("ko-KR", { hour12: false })}] ✋ 수동 입력 대기: ${title} — [수동 작업함]에서 지시문을 복사해 결과를 붙여 넣으세요.\n`;
  await db.job.update({ where: { id }, data: { status: "WAITING", log: (job?.log ?? "") + line } });
}

/** 붙여 넣은 결과가 저장되면 같은 작업을 다시 실행 (저장된 답을 사용) */
export async function resumeJob(id: string) {
  await db.job.update({ where: { id }, data: { status: "QUEUED", runAt: new Date(), error: null } });
}
