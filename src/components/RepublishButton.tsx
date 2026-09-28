"use client";

import { useState } from "react";
import { Spinner } from "./ActionButton";
import { useSubmit } from "./Forms";

type Acc = { id: string; name: string; platform: string; partner: boolean };

/** 크로스플랫폼 재발행 — 이 글을 원본으로 다른 계정용 원고를 새로 씁니다 (복사 아님). */
export function RepublishButton({ postId, accounts }: { postId: string; accounts: Acc[] }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(accounts.find((a) => a.partner)?.id ?? accounts[0]?.id ?? "");
  const { busy, msg, submit } = useSubmit();
  if (!accounts.length) return null;
  if (!open) return <button className="btn-secondary" onClick={() => setOpen(true)}>🔁 다른 계정으로 재발행</button>;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 text-sm">
      <div className="text-xs font-semibold">어느 계정용으로 다시 쓸까요? 원본을 복사하지 않고 관점·구성·예시를 새로 쓰며, 원본 링크를 백링크로 넣습니다.</div>
      <select className="input" value={sel} onChange={(e) => setSel(e.target.value)}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.platform === "NAVER" ? "🟢" : "🟠"} {a.name}{a.partner ? " (재발행 짝)" : ""}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !sel} onClick={() => submit(`/api/posts/${postId}/republish`, { accountId: sel })}>{busy && <Spinner />}재발행 원고 생성</button>
        <button className="btn-secondary" onClick={() => setOpen(false)}>취소</button>
      </div>
      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </div>
  );
}
