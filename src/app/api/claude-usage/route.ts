import { handle, ok } from "@/lib/api";
import { refreshClaudeUsage } from "@/lib/llm/usage";

/** Claude 구독 사용량 새로고침 — 아주 짧은 요청으로 현재 값을 받아 저장 (구독 한도를 아주 조금 사용) */
export const POST = handle(async () => {
  return ok({ usage: await refreshClaudeUsage() });
});
