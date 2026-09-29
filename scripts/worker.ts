/**
 * 백그라운드 워커: 작업 큐 처리 + 정기 스케줄 (주제 발굴 / 분석 동기화 / 인사이트)
 * 실행: npm run worker   (npm run dev 에 포함되어 있음)
 */
import "./load-env";
import { Cron } from "croner";
import { claimNext, completeJob, enqueue, failJob, JobContext, recoverStaleJobs, waitForManual, type JobType } from "../src/lib/jobs/queue";
import { jobStore } from "../src/lib/jobs/context";
import { ManualPendingError } from "../src/lib/llm/manual";
import { handlers } from "../src/lib/jobs/handlers";
import { closeBrowser } from "../src/lib/browser";
import { env, type CronName } from "../src/lib/env";
import { providerLabel, routeFor } from "../src/lib/llm";
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
      const payload = (job.payload ?? {}) as Record<string, unknown>;
      const result = await jobStore.run({ jobId: job.id, jobType: job.type, payload, calls: 0 }, () => handler(payload, ctx));
      await completeJob(job.id, result);
      await ctx.log("완료");
    } catch (e) {
      if (e instanceof ManualPendingError) {
        // 실패가 아니라 "수동 입력 대기" — 결과를 붙여 넣으면 같은 작업이 이어서 실행됩니다.
        await waitForManual(job.id, e.title);
        continue;
      }
      console.error(`[job ${job.id}] 실패`, e);
      await failJob(job.id, e);
    }
  }
}

function schedule(name: CronName, type: JobType, payload: Record<string, unknown> = {}) {
  const expr = env.cron(name);
  if (!expr) return;
  new Cron(expr, { timezone: "Asia/Seoul" }, async () => {
    // 같은 유형이 이미 대기/실행 중이거나 수동 입력을 기다리면 중복 등록하지 않음
    const pending = await db.job.count({ where: { type, status: { in: ["QUEUED", "RUNNING", "WAITING"] } } });
    if (!pending) await enqueue(type, payload);
  });
  console.log(`⏰ ${type} 스케줄: ${expr} (Asia/Seoul)`);
}

async function main() {
  console.log(`🛠  워커 시작 — 원고: ${providerLabel(await routeFor("write"))} · 가벼운 작업: ${providerLabel(await routeFor("light"))}`);
  await recoverStaleJobs();
  schedule("CRON_TOPIC_DISCOVERY", "topic.discover");
  schedule("CRON_CHANNEL_DISCOVERY", "topic.channels", { category: env.channelDiscoveryCategory });
  schedule("CRON_ANALYTICS_SYNC", "analytics.sync");
  schedule("CRON_INSIGHTS", "insights.generate");
  schedule("CRON_TOPIC_CLEANUP", "topic.cleanup");
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
