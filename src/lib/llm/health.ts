import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { claudeBin, runClaudeCode, subscriptionEnv } from "./claudeCode";
import { ollamaChat, ollamaModel, ollamaStatus, ollamaUrl } from "./ollama";
import { extractJson } from "./index";

const run = promisify(execFile);
const Ping = z.object({ ok: z.boolean(), word: z.string() });
const PING_SCHEMA = z.toJSONSchema(Ping) as object;
const PING_PROMPT = '연결 확인입니다. {"ok": true, "word": "안녕"} 형태의 JSON 만 출력하세요.';

export type CheckResult = { name: string; ok: boolean; detail: string; ms?: number };

/**
 * Claude Code(구독) 점검
 * - live=false: 설치·버전만 확인 (구독 한도를 쓰지 않음)
 * - live=true: 아주 짧은 JSON 응답을 실제로 받아 로그인 상태까지 확인 (구독 한도를 아주 조금 사용)
 */
export async function checkClaudeCode(live = false): Promise<CheckResult> {
  const bin = claudeBin();
  if (!bin) return { name: "Claude Code (구독)", ok: false, detail: "claude 명령을 찾지 못했어요. 설치 후 터미널에서 claude → /login 으로 구독 계정에 로그인하세요. 설치 위치가 다르면 CLAUDE_CODE_BIN 에 경로를 넣으세요." };
  let version = "";
  try {
    version = (await run(bin, ["--version"], { env: subscriptionEnv(), timeout: 15_000 })).stdout.trim();
  } catch (e) {
    return { name: "Claude Code (구독)", ok: false, detail: `실행 실패 (${bin}): ${(e as Error).message.split("\n")[0]}` };
  }
  if (!live) return { name: "Claude Code (구독)", ok: true, detail: `설치됨 ${version} · ${bin} — 로그인까지 확인하려면 '응답 테스트'를 누르세요.` };
  const t = Date.now();
  try {
    const out = await runClaudeCode({ system: "짧게 답하세요.", prompt: PING_PROMPT, jsonSchema: PING_SCHEMA, tools: [], timeoutMs: 120_000 });
    const parsed = Ping.safeParse(out.structured ?? extractJson(out.text));
    if (!parsed.success) return { name: "Claude Code (구독)", ok: false, detail: `응답은 왔지만 JSON 형식이 달라요: ${out.text.slice(0, 120)}`, ms: Date.now() - t };
    return { name: "Claude Code (구독)", ok: true, detail: `구독 로그인으로 응답 성공 (${version})`, ms: Date.now() - t };
  } catch (e) {
    return { name: "Claude Code (구독)", ok: false, detail: (e as Error).message, ms: Date.now() - t };
  }
}

/** 로컬 Ollama 점검 — live=true 면 짧은 JSON 생성까지 확인 */
export async function checkOllama(live = false): Promise<CheckResult> {
  const name = `로컬 Ollama (${ollamaModel()})`;
  const s = await ollamaStatus();
  if (!s.reachable) return { name, ok: false, detail: `${ollamaUrl()} 에 연결할 수 없어요. Ollama 앱이 실행 중인지 확인하세요 (다른 주소면 OLLAMA_URL).` };
  if (!s.hasModel) return { name, ok: false, detail: `연결됐지만 ${ollamaModel()} 모델이 없어요. 설치된 모델: ${s.models.join(", ") || "없음"} — ollama pull ${ollamaModel()} 또는 OLLAMA_MODEL 변경` };
  if (!live) return { name, ok: true, detail: `연결됨 · 모델 ${s.models.length}개 설치` };
  const t = Date.now();
  try {
    const text = await ollamaChat({ system: "짧게 답하세요.", prompt: PING_PROMPT, jsonSchema: PING_SCHEMA, timeoutMs: 180_000 });
    const parsed = Ping.safeParse(extractJson(text));
    if (!parsed.success) return { name, ok: false, detail: `응답은 왔지만 JSON 형식이 달라요: ${text.slice(0, 120)}`, ms: Date.now() - t };
    return { name, ok: true, detail: "JSON 응답 성공", ms: Date.now() - t };
  } catch (e) {
    return { name, ok: false, detail: (e as Error).message, ms: Date.now() - t };
  }
}
