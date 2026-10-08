import { spawn } from "node:child_process";
import { accessSync, constants, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Claude Code(구독) 공급자 — 맥에 설치된 `claude` CLI 를 헤드리스(-p)로 실행합니다.
 * - API 키가 아니라 Claude 구독 로그인으로 동작하도록, 자식 프로세스 환경에서 API 키 변수를 제거합니다.
 *   (API 과금 없음, 대신 데스크탑·Claude Code 와 같은 구독 사용 한도를 함께 씁니다)
 * - 원고 작성은 도구를 모두 끄고(--tools ""), 조사는 웹 검색·웹 페이지 읽기만 허용합니다.
 * - 빈 임시 폴더에서 실행해 이 프로젝트 파일·설정·MCP 를 건드리지 않습니다.
 * - stream-json 으로 받아, 응답과 함께 오는 구독 사용량(rate_limit_event)을 대시보드용으로 기록합니다.
 */
export class ClaudeCodeError extends Error {
  constructor(message: string, readonly kind: "not-installed" | "login" | "limit" | "timeout" | "failed") {
    super(message);
  }
}

export function claudeBin(): string | null {
  const configured = process.env.CLAUDE_CODE_BIN?.trim();
  const candidates = configured ? [configured] : (process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "claude"));
  for (const c of [...candidates, "/opt/homebrew/bin/claude", "/usr/local/bin/claude", path.join(process.env.HOME ?? "", ".claude/local/claude")]) {
    try {
      accessSync(c, constants.X_OK);
      return c;
    } catch {}
  }
  return null;
}

/** 구독 로그인으로 실행되도록 API 과금 경로의 환경변수를 제거 (CLAUDE_CODE_OAUTH_TOKEN 같은 구독 토큰은 유지) */
export function subscriptionEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const e = { ...base };
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]) delete e[k];
  return e;
}

export type ClaudeCodeRequest = {
  system: string;
  prompt: string;
  jsonSchema?: object;
  /** 허용할 내장 도구. 빈 배열 = 도구 없음 */
  tools?: string[];
  model?: string;
  timeoutMs?: number;
};

export function claudeCodeArgs(req: ClaudeCodeRequest): string[] {
  const tools = req.tools ?? [];
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose", // stream-json 은 -p 에서 --verbose 가 있어야 동작
    "--no-session-persistence",
    "--strict-mcp-config",
    "--model", req.model || process.env.CLAUDE_CODE_MODEL?.trim() || "sonnet",
    "--system-prompt", req.system,
    "--tools", tools.join(","),
  ];
  if (tools.length) args.push("--allowedTools", ...tools);
  if (req.jsonSchema && process.env.CLAUDE_CODE_JSON_SCHEMA !== "0") {
    // zod의 toJSONSchema() 가 넣는 $schema 메타 필드를 Claude Code CLI 가 해석하지 못해
    // "no schema with key or ref ..." 오류를 내므로 제거하고 전달합니다.
    const { $schema: _drop, ...schema } = req.jsonSchema as Record<string, unknown>;
    args.push("--json-schema", JSON.stringify(schema));
  }
  return args;
}

/** CLI 오류 문구를 사람이 이해할 수 있는 한국어로 */
export function classifyClaudeError(text: string): ClaudeCodeError {
  if (/usage limit|rate limit|limit reached|quota|too many requests|429/i.test(text)) {
    return new ClaudeCodeError("Claude 구독 사용 한도에 도달했어요. 한도가 풀리면 다시 시도하거나, 수동 모드로 진행하세요.", "limit");
  }
  if (/log ?in|authenticat|unauthori[sz]ed|not logged|invalid api key|oauth|credential|401/i.test(text)) {
    return new ClaudeCodeError("Claude Code 로그인이 필요해요. 터미널에서 claude 를 실행해 /login 으로 구독 계정에 로그인하세요.", "login");
  }
  return new ClaudeCodeError(`Claude Code 실행 실패: ${text.slice(0, 300)}`, "failed");
}

export type UsageWindows = Record<string, { utilization: number; resetsAt: number | null }>;
type ResultLine = { is_error?: boolean; result?: string; structured_output?: unknown; subtype?: string };

/** stream-json 출력(줄마다 JSON)에서 최종 result 와 마지막 사용량 이벤트를 꺼냄. 예전 json 출력(한 덩어리)도 받아 줌 */
export function parseClaudeStream(out: string): { result: ResultLine | null; usage: UsageWindows | null } {
  let result: ResultLine | null = null;
  let usage: UsageWindows | null = null;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    let d: { type?: string; rate_limit_info?: { unifiedWindows?: UsageWindows } } & ResultLine;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.type === "result") result = d;
    else if (d.type === "rate_limit_event" && d.rate_limit_info?.unifiedWindows) usage = d.rate_limit_info.unifiedWindows;
  }
  if (!result) {
    try {
      const whole = JSON.parse(out);
      if (whole && typeof whole === "object" && !Array.isArray(whole)) result = whole;
    } catch {}
  }
  return { result, usage };
}

/** claude -p 실행 → 구조화 결과(있으면) 또는 응답 텍스트 반환 */
export async function runClaudeCode(req: ClaudeCodeRequest): Promise<{ text: string; structured?: unknown }> {
  const bin = claudeBin();
  if (!bin) throw new ClaudeCodeError("Claude Code(claude 명령)가 설치되어 있지 않아요. https://claude.com/claude-code 에서 설치 후 구독 계정으로 로그인하세요.", "not-installed");
  const cwd = mkdtempSync(path.join(tmpdir(), "jiwon4u-claude-"));
  try {
    const { out, code, stderr: errText } = await new Promise<{ out: string; code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(bin, claudeCodeArgs(req), { cwd, env: subscriptionEnv(), stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new ClaudeCodeError(`Claude Code 응답이 ${Math.round((req.timeoutMs ?? 600_000) / 60000)}분 안에 오지 않았어요.`, "timeout"));
      }, req.timeoutMs ?? 600_000);
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new ClaudeCodeError(`Claude Code 실행 실패: ${e.message}`, "failed"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 && !stdout.trim()) return reject(classifyClaudeError(stderr || `종료 코드 ${code}`));
        resolve({ out: stdout, code, stderr });
      });
      child.stdin.end(req.prompt);
    });
    const { result: parsed, usage } = parseClaudeStream(out);
    // 사용량 기록은 부가 기능 — DB 가 없거나 실패해도 원래 작업에는 영향 없게
    if (usage) await import("./usage").then((u) => u.saveClaudeUsage(usage)).catch(() => {});
    // stream-json 은 실패해도 시작 줄(init)이 먼저 찍혀 stdout 이 비지 않음 — 결과 줄이 없으면 오류로 판단
    if (!parsed) {
      if (code !== 0) throw classifyClaudeError(errText || `종료 코드 ${code}`);
      return { text: out };
    }
    if (parsed.is_error) throw classifyClaudeError(`${parsed.subtype ?? ""} ${parsed.result ?? ""}`);
    return { text: parsed.result ?? "", structured: parsed.structured_output };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
