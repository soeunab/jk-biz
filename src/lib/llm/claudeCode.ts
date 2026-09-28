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
    "--output-format", "json",
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

/** claude -p 실행 → 구조화 결과(있으면) 또는 응답 텍스트 반환 */
export async function runClaudeCode(req: ClaudeCodeRequest): Promise<{ text: string; structured?: unknown }> {
  const bin = claudeBin();
  if (!bin) throw new ClaudeCodeError("Claude Code(claude 명령)가 설치되어 있지 않아요. https://claude.com/claude-code 에서 설치 후 구독 계정으로 로그인하세요.", "not-installed");
  const cwd = mkdtempSync(path.join(tmpdir(), "jiwon4u-claude-"));
  try {
    const out = await new Promise<string>((resolve, reject) => {
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
        resolve(stdout);
      });
      child.stdin.end(req.prompt);
    });
    let parsed: { is_error?: boolean; result?: string; structured_output?: unknown; subtype?: string };
    try {
      parsed = JSON.parse(out);
    } catch {
      return { text: out };
    }
    if (parsed.is_error) throw classifyClaudeError(`${parsed.subtype ?? ""} ${parsed.result ?? ""}`);
    return { text: parsed.result ?? "", structured: parsed.structured_output };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
