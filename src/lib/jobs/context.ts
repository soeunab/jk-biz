import { AsyncLocalStorage } from "node:async_hooks";

/** 실행 중인 작업 정보 — 수동 모드가 "어느 원고의 몇 번째 AI 호출인지" 알기 위해 사용 */
export type JobRun = { jobId: string; jobType: string; payload: Record<string, unknown>; calls: number };

export const jobStore = new AsyncLocalStorage<JobRun>();

export function currentJob() {
  return jobStore.getStore();
}
