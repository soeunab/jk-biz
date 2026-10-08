"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner, waitJobs } from "./ActionButton";

/**
 * 비공개 발행·수정본 다시 올리기 — 이미 블로그에 올라간 글이면 서버가 먼저 알려 줌
 * (네이버: 글이 하나 더 생김 / 블로거: 블로그에서 고친 내용을 덮어씀). 확인한 뒤에만 다시 올림.
 */
export function PublishPrivateButton({ postId, label, className = "btn-secondary" }: { postId: string; label: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[] | null>(null);

  async function run(force: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/posts/${postId}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "publishPrivate", force }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `오류 ${res.status}`);
      if (data.needsConfirm) {
        setIssues(data.issues);
        return;
      }
      setIssues(null);
      if (data.jobId) await waitJobs([data.jobId], (p) => setMsg(`처리 중… ${p}%`));
      setMsg(null);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button className={className} disabled={busy} onClick={() => run(false)}>
        {busy && <Spinner />}
        {label}
      </button>
      {msg && <span className="mt-1 text-xs text-gray-500">{msg}</span>}
      {issues && (
        <div className="mt-2 max-w-sm rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <div className="mb-1 font-bold">다시 올리기 전에 확인해 주세요</div>
          <ul className="list-disc space-y-1 pl-4">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
          <div className="mt-2 flex gap-2">
            <button className="btn-secondary text-xs" onClick={() => setIssues(null)}>취소</button>
            <button className="btn-danger text-xs" disabled={busy} onClick={() => run(true)}>확인했어요, 그래도 다시 올리기</button>
          </div>
        </div>
      )}
    </span>
  );
}
