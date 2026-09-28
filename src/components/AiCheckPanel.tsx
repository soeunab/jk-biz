"use client";

import { useState } from "react";
import { Spinner } from "./ActionButton";

type Result = { name: string; ok: boolean; detail: string; ms?: number };

/** Claude Code 로그인·Ollama 연결 점검 버튼 */
export function AiCheckPanel() {
  const [busy, setBusy] = useState<"quick" | "live" | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(live: boolean) {
    setBusy(live ? "live" : "quick");
    setError(null);
    try {
      const res = await fetch("/api/settings/ai-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ live }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `오류 ${res.status}`);
      setResults(data.results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => check(false)}>{busy === "quick" && <Spinner />}🔌 연결 점검</button>
        <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => check(true)} title="Claude 구독 한도를 아주 조금 사용합니다">{busy === "live" && <Spinner />}💬 응답 테스트</button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {results && (
        <ul className="mt-3 flex flex-col gap-2">
          {results.map((r) => (
            <li key={r.name} className="flex items-start gap-2 rounded-lg border p-3 text-sm">
              <span>{r.ok ? "✅" : "⚠️"}</span>
              <div>
                <div className="font-medium">{r.name}{r.ms !== undefined && <span className="ml-2 text-xs text-gray-400">{(r.ms / 1000).toFixed(1)}초</span>}</div>
                <div className="text-xs text-gray-600">{r.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
