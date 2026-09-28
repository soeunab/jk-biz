"use client";

import { useState } from "react";
import { Spinner } from "./ActionButton";
import { useSubmit } from "./Forms";

type Props = { id: string; title: string; jobLabel: string; promptText: string; note?: string | null; createdAt: string; link?: { href: string; label: string } };

/** 수동 모드: 지시문 복사 → 데스크탑 Claude 에 붙여넣기 → 결과 붙여넣기 */
export function ManualTaskCard({ id, title, jobLabel, promptText, note, createdAt, link }: Props) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const { busy, msg, submit } = useSubmit();

  async function copy() {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const blob = new Blob([promptText], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `지시문-${id}.txt`;
      a.click();
    }
  }

  return (
    <div className="card border-amber-300 bg-amber-50/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-amber-700">✋ 수동 입력 대기 · {jobLabel}</div>
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-gray-500">{createdAt}{link && <> · <a className="text-indigo-600 underline" href={link.href}>{link.label}</a></>}</div>
          {note && <div className="mt-1 whitespace-pre-wrap text-xs text-red-600">{note}</div>}
        </div>
        <button className="btn-danger text-xs" disabled={busy} onClick={() => { if (confirm("이 작업을 취소할까요?")) submit(`/api/manual/${id}`, {}, "DELETE"); }}>취소</button>
      </div>
      <ol className="mt-3 flex flex-col gap-3 text-sm">
        <li>
          <b>1.</b> 지시문을 복사해 데스크탑 Claude(또는 원하는 AI)에 붙여 넣으세요. 웹 검색을 켜면 최신 정보로 작성돼요.
          <div className="mt-1 flex gap-2">
            <button className="btn-primary" onClick={copy}>{copied ? "✅ 복사됨" : "📋 지시문 복사"}</button>
            <details className="text-xs text-gray-500"><summary className="cursor-pointer py-2">지시문 보기</summary><pre className="mt-1 max-h-64 overflow-auto rounded bg-white p-2 whitespace-pre-wrap">{promptText}</pre></details>
          </div>
        </li>
        <li>
          <b>2.</b> AI 가 준 답(JSON)을 전부 복사해 아래에 붙여 넣으세요. 앞뒤에 설명이 섞여도 괜찮아요.
          <textarea className="input mt-1 font-mono text-xs" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder='{ "title": "...", ... }' />
        </li>
        <li>
          <button className="btn-success" disabled={busy || !text.trim()} onClick={() => submit(`/api/manual/${id}`, { text })}>{busy && <Spinner />}3. 결과 반영하고 이어서 진행</button>
          {msg && <p className="mt-1 whitespace-pre-wrap text-xs text-red-600">{msg}</p>}
        </li>
      </ol>
    </div>
  );
}
