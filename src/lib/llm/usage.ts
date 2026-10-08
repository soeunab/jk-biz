import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { runClaudeCode, type UsageWindows } from "./claudeCode";

/**
 * Claude 구독 사용량 — claude -p 응답에 함께 오는 rate_limit_event 값을 Setting 에 저장해 대시보드에 보여 줍니다.
 * - 원고 작성 등 실제 작업이 돌 때마다 자동으로 갱신되고, 대시보드 [새로고침]은 아주 짧은 요청(haiku)으로 값을 받아 옵니다.
 * - 계정 토큰을 직접 읽지 않고 Claude Code 가 주는 값만 씁니다. 그래서 Claude Code 가 주는 창(5시간·7일 등)만 볼 수 있어요.
 */
const KEY = "claudeUsage";

export type ClaudeUsage = { windows: UsageWindows; at: string };

/** 창 이름 → 대시보드 표시 이름 (모르는 창은 이름 그대로 표시) */
export const USAGE_WINDOW_LABEL: Record<string, string> = {
  five_hour: "현재 세션",
  seven_day: "이번 주 (전체)",
  seven_day_opus: "이번 주 (Opus)",
  seven_day_sonnet: "이번 주 (Sonnet)",
};

export async function saveClaudeUsage(windows: UsageWindows) {
  const value = { windows, at: new Date().toISOString() } satisfies ClaudeUsage;
  await db.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: value as unknown as Prisma.InputJsonValue },
    update: { value: value as unknown as Prisma.InputJsonValue },
  });
}

export async function readClaudeUsage(): Promise<ClaudeUsage | null> {
  const row = await db.setting.findUnique({ where: { key: KEY } });
  const v = row?.value as ClaudeUsage | null | undefined;
  return v?.windows ? v : null;
}

/** 지금 사용량을 받아 옴 — 가장 가벼운 모델로 한 글자 응답만 받음 (구독 한도를 아주 조금 사용) */
export async function refreshClaudeUsage(): Promise<ClaudeUsage | null> {
  await runClaudeCode({ system: "한 글자로만 답하세요.", prompt: "1", tools: [], model: "haiku", timeoutMs: 90_000 });
  return readClaudeUsage();
}

/** 0~1 비율(utilization) → 0~100 퍼센트. 재설정 시각이 지난 창은 0% 로 봄 */
export function usagePercent(w: { utilization: number; resetsAt: number | null }, now = Date.now()) {
  if (w.resetsAt && w.resetsAt * 1000 <= now) return 0;
  return Math.max(0, Math.min(100, Math.round(w.utilization * 100)));
}
