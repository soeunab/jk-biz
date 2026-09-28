/**
 * AI 공급자 라우팅 테스트 — 실제 claude CLI·Ollama 대신
 * 가짜 claude 실행파일(스텁)과 가짜 Ollama HTTP 서버로 실제 프로세스/HTTP 경로를 끝까지 실행합니다.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

// 수동 모드가 쓰는 DB 테이블만 메모리로 흉내
const store = new Map<string, Record<string, unknown>>();
vi.mock("@/lib/db", () => ({
  db: {
    manualRequest: {
      findUnique: async ({ where }: { where: { key: string } }) => store.get(where.key) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `mr_${store.size + 1}`, status: "PENDING", response: null, ...data };
        store.set(String(data.key), row);
        return row;
      },
      update: async ({ where, data }: { where: { key: string }; data: Record<string, unknown> }) => {
        const row = { ...store.get(where.key)!, ...data };
        store.set(where.key, row);
        return row;
      },
    },
  },
}));

const dir = mkdtempSync(path.join(tmpdir(), "jk-llm-test-"));
const stub = path.join(dir, "claude");
const stubLog = path.join(dir, "calls.jsonl");
const counter = path.join(dir, "count");

// 가짜 claude: 인자·환경·stdin 을 기록하고 STUB_MODE 에 따라 응답
writeFileSync(
  stub,
  `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("9.9.9 (Claude Code stub)"); process.exit(0); }
let stdin = "";
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  const n = fs.existsSync(${JSON.stringify(counter)}) ? Number(fs.readFileSync(${JSON.stringify(counter)}, "utf8")) + 1 : 1;
  fs.writeFileSync(${JSON.stringify(counter)}, String(n));
  fs.appendFileSync(${JSON.stringify(stubLog)}, JSON.stringify({ args, stdin, cwd: process.cwd(), apiKey: process.env.ANTHROPIC_API_KEY ?? null, baseUrl: process.env.ANTHROPIC_BASE_URL ?? null }) + "\\n");
  const mode = process.env.STUB_MODE;
  const good = JSON.parse(process.env.STUB_OUTPUT || "{}");
  const out = (o) => { process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, ...o })); };
  if (mode === "structured") return out({ result: "", structured_output: good });
  if (mode === "text") return out({ result: "네, 결과입니다.\\n\`\`\`json\\n" + JSON.stringify(good) + "\\n\`\`\`\\n참고하세요." });
  if (mode === "repair") return out(n === 1 ? { result: JSON.stringify({ wrong: true }) } : { result: JSON.stringify(good) });
  if (mode === "limit") { process.stderr.write("Claude AI usage limit reached. Your limit will reset at 5pm"); process.exit(1); }
  if (mode === "login") return out({ is_error: true, subtype: "error", result: "Invalid API key · Please run /login" });
  out({ result: "?" });
});
`,
);
chmodSync(stub, 0o755);

// 가짜 Ollama
let ollama: Server;
let ollamaPort = 0;
const ollamaBodies: Record<string, unknown>[] = [];
let ollamaReply = "";

beforeAll(async () => {
  ollama = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "gemma4:12b" }, { name: "qwen3:8b" }] }));
      if (req.url === "/api/chat") {
        ollamaBodies.push(JSON.parse(body));
        return res.end(JSON.stringify({ message: { role: "assistant", content: ollamaReply } }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => ollama.listen(0, "127.0.0.1", () => r()));
  ollamaPort = (ollama.address() as { port: number }).port;
});

afterAll(() => {
  ollama.close();
  rmSync(dir, { recursive: true, force: true });
});

const ENV_KEYS = ["LLM_PROVIDER", "LLM_WRITE", "LLM_LIGHT", "LLM_RESEARCH", "LLM_FALLBACK", "CLAUDE_CODE_BIN", "CLAUDE_CODE_MODEL", "CLAUDE_CODE_JSON_SCHEMA", "OLLAMA_URL", "OLLAMA_MODEL", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "GEMINI_API_KEY", "STUB_MODE", "STUB_OUTPUT"];

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.CLAUDE_CODE_BIN = stub;
  process.env.OLLAMA_URL = `http://127.0.0.1:${ollamaPort}`;
  rmSync(stubLog, { force: true });
  rmSync(counter, { force: true });
  ollamaBodies.length = 0;
  store.clear();
  vi.resetModules(); // Ollama 연결 캐시 초기화
});

const calls = () => (existsSync(stubLog) ? readFileSync(stubLog, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const argAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

const Schema = z.object({ title: z.string(), points: z.array(z.string()).min(1) });
const good = { title: "제미나이 사용법", points: ["무료로 시작", "한국어 지원"] };
const req = (task: "write" | "light" = "write") => ({ name: "manuscript", task, title: "테스트 원고", system: "규칙: 지어내지 말 것", prompt: "원고를 써 주세요", schema: Schema, mock: () => ({ title: "mock", points: ["mock"] }) });

async function llm() {
  return import("@/lib/llm");
}

describe("작업별 라우팅", () => {
  it("자동: Claude Code 설치 + Ollama 실행 중 → 원고·조사=구독, 가벼운 작업=로컬", async () => {
    const { routeFor } = await llm();
    expect(await routeFor("write")).toBe("claude-code");
    expect(await routeFor("research")).toBe("claude-code");
    expect(await routeFor("light")).toBe("ollama");
  });

  it("자동: Ollama 에 모델이 없으면 가벼운 작업도 구독으로", async () => {
    process.env.OLLAMA_MODEL = "llama9:70b";
    const { routeFor } = await llm();
    expect(await routeFor("light")).toBe("claude-code");
  });

  it("자동: 아무것도 없으면 수동 (API 키가 없으면 과금 경로로 가지 않음)", async () => {
    process.env.CLAUDE_CODE_BIN = path.join(dir, "없는-claude");
    process.env.OLLAMA_URL = "http://127.0.0.1:9";
    const { routeFor, costLabel } = await llm();
    for (const t of ["write", "light", "research"] as const) expect(await routeFor(t)).toBe("manual");
    expect(costLabel("manual")).toContain("무료");
  });

  it("자동: Claude Code 가 있으면 API 키가 있어도 구독이 우선", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const { routeFor } = await llm();
    expect(await routeFor("write")).toBe("claude-code");
  });

  it("명시 지정: LLM_WRITE/LLM_LIGHT 가 LLM_PROVIDER 보다 우선", async () => {
    process.env.LLM_PROVIDER = "mock";
    process.env.LLM_LIGHT = "manual";
    const { routeFor } = await llm();
    expect(await routeFor("write")).toBe("mock");
    expect(await routeFor("light")).toBe("manual");
  });

  it("routingSummary 에 비용 표시", async () => {
    const { routingSummary } = await llm();
    const rows = await routingSummary();
    expect(rows.find((r) => r.task === "write")?.cost).toContain("구독");
    expect(rows.find((r) => r.task === "light")?.cost).toContain("무료");
  });
});

describe("Claude Code (구독) 공급자 — 가짜 claude 로 실제 실행", () => {
  it("API 키 제거·도구 차단·임시 폴더·JSON 스키마로 실행하고 구조화 결과를 사용", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-should-not-leak";
    process.env.ANTHROPIC_BASE_URL = "https://proxy.example";
    process.env.STUB_MODE = "structured";
    process.env.STUB_OUTPUT = JSON.stringify(good);
    const { generateJson } = await llm();
    expect(await generateJson(req())).toEqual(good);
    const [c] = calls();
    expect(c.apiKey).toBeNull();
    expect(c.baseUrl).toBeNull();
    expect(c.args).toContain("-p");
    expect(argAfter(c.args, "--tools")).toBe("");
    expect(c.args).not.toContain("--allowedTools");
    expect(c.args).toContain("--strict-mcp-config");
    expect(c.args).toContain("--no-session-persistence");
    expect(argAfter(c.args, "--model")).toBe("sonnet");
    expect(argAfter(c.args, "--system-prompt")).toBe("규칙: 지어내지 말 것");
    expect(JSON.parse(argAfter(c.args, "--json-schema")).properties.points).toBeTruthy();
    expect(c.stdin).toContain("원고를 써 주세요");
    expect(c.cwd).not.toBe(process.cwd());
    expect(existsSync(c.cwd)).toBe(false); // 임시 폴더는 실행 후 삭제
  });

  it("설명·코드블록이 섞인 텍스트 응답에서도 JSON 추출", async () => {
    process.env.STUB_MODE = "text";
    process.env.STUB_OUTPUT = JSON.stringify(good);
    process.env.CLAUDE_CODE_JSON_SCHEMA = "0";
    process.env.CLAUDE_CODE_MODEL = "opus";
    const { generateJson } = await llm();
    expect(await generateJson(req())).toEqual(good);
    const [c] = calls();
    expect(c.args).not.toContain("--json-schema");
    expect(argAfter(c.args, "--model")).toBe("opus");
  });

  it("형식이 틀리면 오류를 알려 한 번 다시 요청(repair)", async () => {
    process.env.STUB_MODE = "repair";
    process.env.STUB_OUTPUT = JSON.stringify(good);
    process.env.CLAUDE_CODE_JSON_SCHEMA = "0";
    const { generateJson } = await llm();
    expect(await generateJson(req())).toEqual(good);
    const cs = calls();
    expect(cs).toHaveLength(2);
    expect(cs[1].stdin).toContain("형식 오류");
    expect(cs[1].stdin).toContain("title");
  });

  it("조사: 웹 검색·웹 페이지 읽기만 허용", async () => {
    process.env.STUB_MODE = "structured";
    process.env.STUB_OUTPUT = JSON.stringify({ notes: "2026-09 기준 요금", sources: [{ title: "공식", url: "https://gemini.google.com" }] });
    const { research } = await llm();
    const r = await research("제미나이 요금제");
    expect(r.sources[0].url).toBe("https://gemini.google.com");
    const [c] = calls();
    expect(argAfter(c.args, "--tools")).toBe("WebSearch,WebFetch");
    expect(c.args.slice(c.args.indexOf("--allowedTools") + 1, c.args.indexOf("--allowedTools") + 3)).toEqual(["WebSearch", "WebFetch"]);
  });

  it("구독 한도 초과 → 수동 모드로 전환(대기 요청 생성, 사유 기록)", async () => {
    process.env.STUB_MODE = "limit";
    const { generateJson, ManualPendingError } = await llm();
    const { jobStore } = await import("@/lib/jobs/context");
    const err = await jobStore.run({ jobId: "job1", jobType: "post.generate", payload: { postId: "p1" }, calls: 0 }, () => generateJson(req()).catch((e) => e));
    expect(err).toBeInstanceOf(ManualPendingError);
    const row = store.get("job1:0")!;
    expect(row.status).toBe("PENDING");
    expect(row.postId).toBe("p1");
    expect(String(row.error)).toContain("한도");
  });

  it("LLM_FALLBACK=none 이면 전환하지 않고 오류", async () => {
    process.env.STUB_MODE = "login";
    process.env.LLM_FALLBACK = "none";
    const { generateJson } = await llm();
    await expect(generateJson(req())).rejects.toThrow(/로그인/);
  });
});

describe("Claude Code 보조 함수", () => {
  it("subscriptionEnv 는 API 과금 경로 변수만 제거", async () => {
    const { subscriptionEnv } = await import("@/lib/llm/claudeCode");
    const e = subscriptionEnv({ ANTHROPIC_API_KEY: "a", ANTHROPIC_AUTH_TOKEN: "b", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_OAUTH_TOKEN: "keep", PATH: "/bin" } as unknown as NodeJS.ProcessEnv);
    expect(e).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: "keep", PATH: "/bin" });
  });

  it("오류 문구 분류", async () => {
    const { classifyClaudeError } = await import("@/lib/llm/claudeCode");
    expect(classifyClaudeError("Claude AI usage limit reached").kind).toBe("limit");
    expect(classifyClaudeError("Invalid API key · Please run /login").kind).toBe("login");
    expect(classifyClaudeError("segfault").kind).toBe("failed");
  });

  it("빈 CLAUDE_CODE_MODEL 은 sonnet 으로", async () => {
    process.env.CLAUDE_CODE_MODEL = "  ";
    const { claudeCodeArgs } = await import("@/lib/llm/claudeCode");
    const a = claudeCodeArgs({ system: "s", prompt: "p" });
    expect(a[a.indexOf("--model") + 1]).toBe("sonnet");
  });
});

describe("Ollama (로컬) 공급자 — 가짜 서버", () => {
  it("Gemma 는 system 을 user 메시지에 합치고, 스키마 format·think 끔·<think> 제거", async () => {
    ollamaReply = `<think>생각 중</think>${JSON.stringify(good)}`;
    const { generateJson } = await llm();
    expect(await generateJson(req("light"))).toEqual(good);
    const b = ollamaBodies[0] as { model: string; messages: { role: string; content: string }[]; format: { properties: object }; think: boolean; stream: boolean; options: { num_ctx: number } };
    expect(b.model).toBe("gemma4:12b");
    expect(b.messages).toHaveLength(1);
    expect(b.messages[0].role).toBe("user");
    expect(b.messages[0].content).toContain("규칙: 지어내지 말 것");
    expect(b.format.properties).toHaveProperty("points");
    expect(b.think).toBe(false);
    expect(b.stream).toBe(false);
    expect(b.options.num_ctx).toBe(16384);
    expect(calls()).toHaveLength(0); // 구독 한도를 쓰지 않음
  });

  it("Gemma 가 아닌 모델은 system 역할 유지", async () => {
    const { ollamaMessages, stripThink } = await import("@/lib/llm/ollama");
    expect(ollamaMessages("qwen3:8b", "S", "P").map((m) => m.role)).toEqual(["system", "user"]);
    expect(stripThink("<think>a\nb</think>\n{}")).toBe("{}");
  });

  it("Ollama 는 웹 검색을 못 하므로 조사는 건너뜀", async () => {
    process.env.LLM_RESEARCH = "ollama";
    const { research } = await llm();
    expect(await research("q")).toEqual({ notes: "", sources: [] });
    expect(ollamaBodies).toHaveLength(0);
  });

  it("상태 점검: 연결·모델 확인", async () => {
    const { checkOllama, checkClaudeCode } = await import("@/lib/llm/health");
    expect((await checkOllama(false)).ok).toBe(true);
    ollamaReply = JSON.stringify({ ok: true, word: "안녕" });
    expect((await checkOllama(true)).detail).toContain("JSON 응답 성공");
    const cc = await checkClaudeCode(false);
    expect(cc.ok).toBe(true);
    expect(cc.detail).toContain("9.9.9");
    expect(calls()).toHaveLength(0); // 빠른 점검은 구독 한도를 쓰지 않음
    process.env.STUB_MODE = "structured";
    process.env.STUB_OUTPUT = JSON.stringify({ ok: true, word: "안녕" });
    expect((await checkClaudeCode(true)).detail).toContain("구독 로그인으로 응답 성공");
  });
});

describe("수동(복사·붙여넣기) 모드", () => {
  const run = async <T>(fn: () => Promise<T>) => {
    const { jobStore } = await import("@/lib/jobs/context");
    return jobStore.run({ jobId: "jobM", jobType: "post.generate", payload: { postId: "pM" }, calls: 0 }, fn);
  };

  it("요청 생성 → 대기 → 답 저장 후 같은 작업 재실행 시 그 답 사용", async () => {
    process.env.LLM_WRITE = "manual";
    const { generateJson, ManualPendingError } = await llm();
    const e = await run(() => generateJson(req()).catch((x) => x));
    expect(e).toBeInstanceOf(ManualPendingError);
    expect(store.get("jobM:0")?.schemaName).toBe("manuscript");
    // 같은 작업을 다시 실행해도 요청이 중복 생성되지 않음
    await run(() => generateJson(req()).catch((x) => x));
    expect(store.size).toBe(1);
    store.set("jobM:0", { ...store.get("jobM:0")!, status: "DONE", response: good });
    expect(await run(() => generateJson(req()))).toEqual(good);
  });

  it("저장된 답이 스키마와 다르면 다시 대기로 돌리고 오류 위치 기록", async () => {
    process.env.LLM_WRITE = "manual";
    const { generateJson, ManualPendingError } = await llm();
    await run(() => generateJson(req()).catch(() => null));
    store.set("jobM:0", { ...store.get("jobM:0")!, status: "DONE", response: { title: 1 } });
    expect(await run(() => generateJson(req()).catch((x) => x))).toBeInstanceOf(ManualPendingError);
    expect(store.get("jobM:0")?.status).toBe("PENDING");
    expect(String(store.get("jobM:0")?.error)).toContain("title");
  });

  it("작업(워커) 밖에서는 안내 오류", async () => {
    process.env.LLM_WRITE = "manual";
    const { generateJson } = await llm();
    await expect(generateJson(req())).rejects.toThrow(/워커/);
  });

  it("지시문에 규칙·작업·스키마·JSON 만 출력 안내 포함", async () => {
    const { buildManualPrompt } = await import("@/lib/llm/manual");
    const text = buildManualPrompt({ system: "규칙A", prompt: "작업B", schemaJson: z.toJSONSchema(Schema) });
    expect(text).toContain("규칙A");
    expect(text).toContain("작업B");
    expect(text).toContain('"points"');
    expect(text).toContain("JSON 만 출력");
    expect(text).toContain("웹 검색");
  });

  it("붙여 넣은 답에서 앞뒤 설명·코드블록을 걸러 JSON 추출", async () => {
    const { extractJson } = await llm();
    expect(extractJson('네! 결과입니다\n```json\n{"a":1}\n```\n도움이 되길')).toEqual({ a: 1 });
    expect(extractJson('결과: {"a":{"b":2}} 끝')).toEqual({ a: { b: 2 } });
  });
});

describe("붙여넣기 형식 오류 메시지", () => {
  it("빠진 항목·타입·허용값을 한국어로", async () => {
    const { formatZodError } = await import("@/lib/llm/manual");
    const S = z.object({ title: z.string(), n: z.number(), kind: z.enum(["A", "B"]), list: z.array(z.string()).min(1) });
    const r = S.safeParse({ n: "x", kind: "C", list: [] });
    const msg = formatZodError(r.error!);
    expect(msg).toContain("title: 항목이 빠졌어요 (문자열 필요)");
    expect(msg).toContain("n: 숫자 형식이어야 해요");
    expect(msg).toContain("kind: A, B 중 하나여야 해요");
    expect(msg).toContain("list: 너무 짧거나 개수가 부족해요");
  });
});
