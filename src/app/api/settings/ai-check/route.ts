import { handle, ok } from "@/lib/api";
import { checkClaudeCode, checkOllama } from "@/lib/llm/health";

/** AI 연결 점검 — live=true 면 짧은 응답까지 받아 봅니다 (Claude 구독 한도를 아주 조금 사용) */
export const POST = handle(async (req: Request) => {
  const { live } = (await req.json().catch(() => ({}))) as { live?: boolean };
  const [claude, ollama] = await Promise.all([checkClaudeCode(!!live), checkOllama(!!live)]);
  return ok({ results: [claude, ollama] });
});
