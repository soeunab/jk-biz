/**
 * 백그라운드 워커: 작업 큐 처리 + 정기 스케줄 (주제 발굴 / 분석 동기화 / 인사이트)
 * 실행: npm run worker   (npm run dev 에 포함되어 있음)
 */
import "./load-env";
import { Cron } from "croner";
import { claimNext, completeJob, enqueue, failJob, JobContext, recoverStaleJobs, type JobType } from "../src/lib/jobs/queue";
import { handlers } from "../src/lib/jobs/handlers";
import { closeBrowser } from "../src/lib/browser";
import { env } from "../src/lib/env";
import { providerLabel } from "../src/lib/llm";
import { db } from "../src/lib/db";

const POLL_MS = 2000;
let running = true;

async function loop() {
  while (running) {
    const job = await claimNext().catch((e) => {
      console.error("큐 조회 실패", e);
      return null;
    });
    if (!job) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    const ctx = new JobContext(job.id);
    const handler = handlers[job.type as JobType];
    try {
      if (!handler) throw new Error(`알 수 없는 작업 유형: ${job.type}`);
      await ctx.log(`시작: ${job.type}`);
      const result = await handler((job.payload ?? {}) as Record<string, unknown>, ctx);
      await completeJob(job.id, result);
      await ctx.log("완료");
    } catch (e) {
      console.error(`[job ${job.id}] 실패`, e);
      await failJob(job.id, e);
    }
  }
}

function schedule(name: "CRON_TOPIC_DISCOVERY" | "CRON_ANALYTICS_SYNC" | "CRON_INSIGHTS", type: JobType) {
  const expr = env.cron(name);
  if (!expr) return;
  new Cron(expr, { timezone: "Asia/Seoul" }, async () => {
    // 같은 유형이 이미 대기/실행 중이면 중복 등록하지 않음
    const pending = await db.job.count({ where: { type, status: { in: ["QUEUED", "RUNNING"] } } });
    if (!pending) await enqueue(type, {});
  });
  console.log(`⏰ ${type} 스케줄: ${expr} (Asia/Seoul)`);
}

async function main() {
  console.log(`🛠  워커 시작 — 글쓰기 AI: ${providerLabel()}`);
  await recoverStaleJobs();
  schedule("CRON_TOPIC_DISCOVERY", "topic.discover");
  schedule("CRON_ANALYTICS_SYNC", "analytics.sync");
  schedule("CRON_INSIGHTS", "insights.generate");
  await loop();
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    running = false;
    await closeBrowser();
    await db.$disconnect();
    process.exit(0);
  });
}

main();
