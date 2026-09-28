import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { env } from "../env";

export type LLMProviderName = "anthropic" | "gemini" | "mock";

export type JsonRequest<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** API 키가 없을 때(데모 모드) 돌려줄 샘플 데이터 */
  mock: () => T;
  /** low | medium | high — 글 원고처럼 품질이 중요한 작업은 high */
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
};

export function activeProvider(): LLMProviderName {
  const forced = env.llmProvider as LLMProviderName | undefined;
  if (forced === "mock") return "mock";
  if (forced === "anthropic" && env.anthropicKey) return "anthropic";
  if (forced === "gemini" && env.geminiKey) return "gemini";
  if (env.anthropicKey) return "anthropic";
  if (env.geminiKey) return "gemini";
  return "mock";
}

export function providerLabel(p: LLMProviderName = activeProvider()) {
  return p === "anthropic" ? `Claude (${env.anthropicModel})` : p === "gemini" ? `Gemini (${env.geminiTextModel})` : "데모(mock)";
}

let anthropic: Anthropic | undefined;
let gemini: GoogleGenAI | undefined;

export class LLMError extends Error {}

/** 구조화된 JSON 결과를 생성합니다. 공급자에 관계없이 zod 스키마로 검증됩니다. */
export async function generateJson<T>(req: JsonRequest<T>): Promise<T> {
  const provider = activeProvider();
  if (provider === "mock") return req.schema.parse(req.mock());
  const raw = provider === "anthropic" ? await viaAnthropic(req) : await viaGemini(req);
  const parsed = req.schema.safeParse(extractJson(raw));
  if (!parsed.success) {
    throw new LLMError(`AI 응답 형식이 올바르지 않습니다: ${parsed.error.message.slice(0, 500)}`);
  }
  return parsed.data;
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

function extractJson(text: string): unknown {
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

/**
 * 최신 정보 조사 (웹 검색). AI 도구는 요금제·기능이 자주 바뀌므로 원고 작성 전에 공식 정보를 확인합니다.
 * Claude: web_search 서버 도구 / Gemini: Google 검색 그라운딩 / mock: 빈 결과
 */
export async function research(question: string): Promise<Research> {
  const provider = activeProvider();
  if (provider === "mock") return { notes: "", sources: [] };
  const system =
    "당신은 IT 리서처입니다. 공식 문서·공식 블로그·신뢰할 수 있는 언론을 우선 참고해 최신 사실(요금제, 기능, 출시일, 사용 방법, 제한사항)을 한국어 메모로 정리하세요. 날짜와 출처를 함께 적으세요.";
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
