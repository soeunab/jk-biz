/**
 * Ollama(로컬 LLM) 공급자 — 맥미니에서 무료·무제한으로 돌리는 가벼운 작업용 (기본 gemma4:12b).
 * 웹 검색이 불가하고 긴 원고에서는 규칙 누락이 생기기 쉬워, 주제 기획 문구·카드뉴스·캡션·요약 같은 짧은 작업에 씁니다.
 */
export function ollamaUrl() {
  return (process.env.OLLAMA_URL?.trim() || "http://localhost:11434").replace(/\/$/, "");
}
export function ollamaModel() {
  return process.env.OLLAMA_MODEL?.trim() || "gemma4:12b";
}

type Msg = { role: "system" | "user"; content: string };

/** Gemma 계열은 system 역할을 지원하지 않아 user 메시지 앞에 합칩니다. */
export function ollamaMessages(model: string, system: string, prompt: string): Msg[] {
  if (/^gemma/i.test(model)) return [{ role: "user", content: `${system}\n\n---\n\n${prompt}` }];
  return [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];
}

/** 추론형 모델이 내보내는 <think>…</think> 제거 */
export function stripThink(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export async function ollamaChat(req: { system: string; prompt: string; jsonSchema?: object; model?: string; timeoutMs?: number }): Promise<string> {
  const model = req.model ?? ollamaModel();
  const body = {
    model,
    messages: ollamaMessages(model, req.system, req.prompt),
    format: req.jsonSchema ?? "json",
    stream: false,
    think: false,
    options: { num_ctx: Number(process.env.OLLAMA_NUM_CTX) || 16384, temperature: 0.4 },
  };
  const call = async (b: object) => {
    const res = await fetch(`${ollamaUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(req.timeoutMs ?? 300_000),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: { content?: string }; error?: string };
    if (!res.ok || data.error) throw new Error(data.error ?? `Ollama 오류 ${res.status}`);
    return stripThink(data.message?.content ?? "");
  };
  try {
    return await call(body);
  } catch (e) {
    // 추론 옵션을 모르는 구버전·모델이면 think 없이 한 번 더
    if (/think/i.test((e as Error).message)) {
      const { think: _drop, ...rest } = body;
      return call(rest);
    }
    throw e;
  }
}

/** Ollama 서버·모델 확인 */
export async function ollamaStatus(): Promise<{ reachable: boolean; hasModel: boolean; models: string[] }> {
  try {
    const res = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(1500) });
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = (data.models ?? []).map((m) => m.name);
    const want = ollamaModel();
    return { reachable: true, hasModel: models.some((m) => m === want || m.startsWith(`${want}:`) || want === m.split(":")[0]), models };
  } catch {
    return { reachable: false, hasModel: false, models: [] };
  }
}
