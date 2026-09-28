import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { env } from "../env";
import { currentJob } from "../jobs/context";
import { claudeBin, ClaudeCodeError, runClaudeCode } from "./claudeCode";
import { ollamaChat, ollamaModel, ollamaStatus } from "./ollama";
import { manualJson, ManualPendingError } from "./manual";

/**
 * AI 공급자
 * - claude-code: 맥에 설치된 Claude Code 를 구독 로그인으로 실행 (API 과금 없음, 구독 한도 사용)
 * - ollama: 로컬 LLM (무료·무제한, 가벼운 작업용)
 * - manual: 지시문을 복사해 데스크탑 Claude 등에 붙여 넣고 결과를 붙여 넣는 방식 (비용 0)
 * - anthropic / gemini: API 키 방식 (사용량만큼 별도 과금)
 * - mock: 데모용 샘플
 */
export type LLMProviderName = "anthropic" | "gemini" | "claude-code" | "ollama" | "manual" | "mock";
/** write = 원고·검수처럼 품질이 중요한 작업 / light = 기획 문구·카드뉴스·요약 같은 짧은 작업 */
export type Task = "write" | "light";
export type RouteTask = Task | "research";

const PROVIDERS: LLMProviderName[] = ["anthropic", "gemini", "claude-code", "ollama", "manual", "mock"];

export type JsonRequest<T> = {
  /** 스키마 이름 (수동 모드에서 붙여 넣은 결과 검증에 사용, src/lib/llm/schemas.ts) */
  name: string;
  task?: Task;
  /** 수동 작업함에 보일 제목 */
  title?: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** 데모(mock) 모드에서 돌려줄 샘플 데이터 */
  mock: () => T;
  /** low | medium | high — 글 원고처럼 품질이 중요한 작업은 high */
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
};

function envProvider(v: string | undefined): LLMProviderName | undefined {
  const x = v?.trim() as LLMProviderName | undefined;
  return x && PROVIDERS.includes(x) ? x : undefined;
}

function explicitFor(task: RouteTask): LLMProviderName | undefined {
  const key = task === "write" ? "LLM_WRITE" : task === "light" ? "LLM_LIGHT" : "LLM_RESEARCH";
  return envProvider(process.env[key]) ?? envProvider(env.llmProvider);
}

let ollamaCache: { at: number; ok: boolean } | null = null;
async function ollamaReady() {
  if (ollamaCache && Date.now() - ollamaCache.at < 60_000) return ollamaCache.ok;
  const s = await ollamaStatus();
  ollamaCache = { at: Date.now(), ok: s.reachable && s.hasModel };
  return ollamaCache.ok;
}

/** 작업별 담당 공급자 (설정이 없으면 자동 감지: 구독 Claude Code → 로컬 Ollama → API 키 → 수동) */
export async function routeFor(task: RouteTask): Promise<LLMProviderName> {
  const explicit = explicitFor(task);
  if (explicit) return explicit;
  if (task === "light" && (await ollamaReady())) return "ollama";
  if (claudeBin()) return "claude-code";
  if (env.anthropicKey) return "anthropic";
  if (env.geminiKey) return "gemini";
  return "manual";
}

/** 화면 표시용 (동기) — 원고 작성 담당 */
export function activeProvider(): LLMProviderName {
  return explicitFor("write") ?? (claudeBin() ? "claude-code" : env.anthropicKey ? "anthropic" : env.geminiKey ? "gemini" : "manual");
}

export function providerLabel(p: LLMProviderName = activeProvider()) {
  switch (p) {
    case "claude-code":
      return `Claude 구독 (Claude Code · ${process.env.CLAUDE_CODE_MODEL?.trim() || "sonnet"})`;
    case "ollama":
      return `로컬 Ollama (${ollamaModel()})`;
    case "manual":
      return "수동 (복사·붙여넣기)";
    case "anthropic":
      return `Claude API (${env.anthropicModel})`;
    case "gemini":
      return `Gemini API (${env.geminiTextModel})`;
    default:
      return "데모(mock)";
  }
}

/** 비용 성격 */
export function costLabel(p: LLMProviderName) {
  return {
    "claude-code": "추가 요금 없음 · 구독 사용 한도 사용",
    ollama: "무료 · 로컬 실행",
    manual: "무료 · 직접 복사·붙여넣기",
    anthropic: "API 사용량만큼 별도 과금",
    gemini: "API 사용량 과금 (무료 등급 한도 내 무료)",
    mock: "없음 (샘플)",
  }[p];
}

export async function routingSummary() {
  const rows: { task: RouteTask; label: string; provider: LLMProviderName }[] = [];
  for (const [task, label] of [
    ["write", "원고·섹션 다시 쓰기·AI 사실 검수"],
    ["research", "최신 정보 조사 (웹 검색)"],
    ["light", "주제 기획 문구·카드뉴스·발전 제안 요약"],
  ] as const) {
    rows.push({ task, label, provider: await routeFor(task) });
  }
  return rows.map((r) => ({ ...r, providerLabel: providerLabel(r.provider), cost: costLabel(r.provider) }));
}

export function fallbackProvider(): LLMProviderName | undefined {
  const v = process.env.LLM_FALLBACK?.trim();
  if (v === "none") return undefined;
  return envProvider(v) ?? "manual";
}

let anthropic: Anthropic | undefined;
let gemini: GoogleGenAI | undefined;

export class LLMError extends Error {}
export { ManualPendingError, ClaudeCodeError };

/**
 * 구조화된 JSON 결과를 생성합니다. 공급자에 관계없이 zod 스키마로 검증됩니다.
 * 형식이 틀리면 오류를 알려 한 번 다시 요청하고, 공급자가 실패하면(한도 초과·미설치 등) 대체 공급자(기본: 수동)로 넘깁니다.
 */
export async function generateJson<T>(req: JsonRequest<T>): Promise<T> {
  const provider = await routeFor(req.task ?? "write");
  if (provider === "mock") return req.schema.parse(req.mock());
  if (provider === "manual") return manualJson(req);
  try {
    return await viaProvider(provider, req);
  } catch (e) {
    if (e instanceof ManualPendingError) throw e;
    const fb = fallbackProvider();
    if (!fb || fb === provider || fb === "mock") throw e;
    const reason = `${providerLabel(provider)} 실패 → ${providerLabel(fb)}(으)로 전환: ${(e as Error).message.split("\n")[0]}`;
    console.warn(reason);
    if (fb === "manual") return manualJson(req, reason);
    return viaProvider(fb, req);
  }
}

async function viaProvider<T>(provider: LLMProviderName, req: JsonRequest<T>): Promise<T> {
  let candidate = await callProvider(provider, req, "");
  let parsed = req.schema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  // 형식 오류: 무엇이 틀렸는지 알려 주고 한 번만 다시 요청 (로컬 모델에서 특히 유용)
  const problems = parsed.error.issues.slice(0, 8).map((i) => `- ${i.path.join(".") || "(전체)"}: ${i.message}`).join("\n");
  candidate = await callProvider(provider, req, `\n\n[이전 응답의 형식 오류 — 아래를 고쳐 스키마에 맞는 JSON 전체를 다시 출력하세요]\n${problems}`);
  parsed = req.schema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  throw new LLMError(`AI 응답 형식이 올바르지 않습니다: ${parsed.error.message.slice(0, 500)}`);
}

async function callProvider<T>(provider: LLMProviderName, req: JsonRequest<T>, suffix: string): Promise<unknown> {
  const r = { ...req, prompt: req.prompt + suffix };
  switch (provider) {
    case "anthropic":
      return extractJson(await viaAnthropic(r));
    case "gemini":
      return extractJson(await viaGemini(r));
    case "claude-code": {
      const out = await runClaudeCode({ system: r.system, prompt: `${r.prompt}\n\n지정된 JSON 스키마에 맞는 결과만 출력하세요.`, jsonSchema: z.toJSONSchema(req.schema as z.ZodType) as object, tools: [] });
      return out.structured ?? extractJson(out.text);
    }
    case "ollama":
      return extractJson(await ollamaChat({ system: r.system, prompt: r.prompt, jsonSchema: z.toJSONSchema(req.schema as z.ZodType) as object }));
    default:
      throw new LLMError(`지원하지 않는 공급자: ${provider}`);
  }
}

async function viaAnthropic<T>(req: JsonRequest<T>): Promise<string> {
  anthropic ??= new Anthropic({ apiKey: env.anthropicKey });
  // 긴 원고 생성은 타임아웃을 피하기 위해 스트리밍 후 최종 메시지만 사용합니다.
  // 서버측 fallbacks: 안전 분류기가 거절하면 같은 요청을 대체 모델로 자동 재시도합니다.
  const stream = anthropic.beta.messages.stream({
    model: env.anthropicModel,
    max_tokens: req.maxTokens ?? 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: req.effort ?? "high", format: zodOutputFormat(req.schema as z.ZodType) },
    system: req.system,
    messages: [{ role: "user", content: req.prompt }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new LLMError(`AI가 요청을 거절했습니다 (${message.stop_details?.category ?? "unknown"}).`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new LLMError("AI 응답이 최대 길이에 도달해 잘렸습니다. maxTokens 를 늘려 주세요.");
  }
  return message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

async function viaGemini<T>(req: JsonRequest<T>): Promise<string> {
  gemini ??= new GoogleGenAI({ apiKey: env.geminiKey });
  const res = await gemini.models.generateContent({
    model: env.geminiTextModel,
    contents: req.prompt,
    config: {
      systemInstruction: req.system,
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(req.schema as z.ZodType),
      maxOutputTokens: req.maxTokens ?? 32000,
    },
  });
  const text = res.text;
  if (!text) throw new LLMError("Gemini 응답이 비어 있습니다.");
  return text;
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1]);
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new LLMError("AI 응답에서 JSON 을 찾을 수 없습니다.");
  }
}

/** Gemini 이미지 생성. 키가 없으면 null. */
export async function generateImageWithGemini(prompt: string, aspectRatio = "16:9"): Promise<Buffer | null> {
  if (!env.geminiKey) return null;
  gemini ??= new GoogleGenAI({ apiKey: env.geminiKey });
  const res = await gemini.models.generateContent({
    model: env.geminiImageModel,
    contents: prompt,
    config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio } },
  });
  for (const part of res.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) return Buffer.from(part.inlineData.data, "base64");
  }
  return null;
}

export type Research = { notes: string; sources: { title: string; url: string }[] };
const ResearchSchema = z.object({ notes: z.string(), sources: z.array(z.object({ title: z.string(), url: z.string() })) });

/**
 * 최신 정보 조사 (웹 검색). AI 도구는 요금제·기능이 자주 바뀌므로 원고 작성 전에 공식 정보를 확인합니다.
 * Claude: web_search 서버 도구 / Gemini: Google 검색 그라운딩 / mock: 빈 결과
 */
export async function research(question: string): Promise<Research> {
  const provider = await routeFor("research");
  // 로컬 모델·수동 모드는 웹 검색을 할 수 없음 (수동 모드는 지시문에 웹 검색 안내가 포함됨)
  if (provider === "mock" || provider === "manual" || provider === "ollama") return { notes: "", sources: [] };
  const system =
    "당신은 IT 리서처입니다. 공식 문서·공식 블로그·신뢰할 수 있는 언론을 우선 참고해 최신 사실(요금제, 기능, 출시일, 사용 방법, 제한사항)을 한국어 메모로 정리하세요. 날짜와 출처를 함께 적으세요.";
  if (provider === "claude-code") {
    const out = await runClaudeCode({
      system,
      prompt: `${question}\n\n웹 검색으로 공식 자료를 확인한 뒤, notes(한국어 메모, 날짜 포함)와 sources(제목·URL)를 JSON 으로 답하세요.`,
      jsonSchema: z.toJSONSchema(ResearchSchema) as object,
      tools: ["WebSearch", "WebFetch"],
    });
    const parsed = ResearchSchema.safeParse(out.structured ?? extractJson(out.text));
    return parsed.success ? { notes: parsed.data.notes, sources: parsed.data.sources.slice(0, 8) } : { notes: out.text, sources: [] };
  }
  if (provider === "anthropic") {
    anthropic ??= new Anthropic({ apiKey: env.anthropicKey });
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: question }];
    let notes = "";
    const sources = new Map<string, string>();
    // 서버 도구가 길어지면 pause_turn 으로 끊길 수 있어 최대 3회 이어서 진행
    for (let i = 0; i < 3; i++) {
      const msg = await anthropic.beta.messages
        .stream({
          model: env.anthropicModel,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          system,
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
          messages,
        })
        .finalMessage();
      for (const block of msg.content) {
        if (block.type === "text") notes += block.text;
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) if (r.type === "web_search_result") sources.set(r.url, r.title);
        }
      }
      if (msg.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: msg.content });
    }
    return { notes, sources: [...sources].slice(0, 8).map(([url, title]) => ({ url, title })) };
  }
  gemini ??= new GoogleGenAI({ apiKey: env.geminiKey });
  const res = await gemini.models.generateContent({
    model: env.geminiTextModel,
    contents: question,
    config: { systemInstruction: system, tools: [{ googleSearch: {} }] },
  });
  const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  return {
    notes: res.text ?? "",
    sources: chunks.flatMap((c) => (c.web?.uri ? [{ url: c.web.uri, title: c.web.title ?? c.web.uri }] : [])).slice(0, 8),
  };
}
