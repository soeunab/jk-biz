"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "./ActionButton";

/** 승인: 확인 사유가 있으면 먼저 보여주고, 검수자가 확인한 뒤에만 승인 (결정은 사람이) */
export function ApproveButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function approve(force: boolean) {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/posts/${postId}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve", force }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(data.error ?? "오류");
    if (data.needsConfirm) return setIssues(data.issues);
    setIssues(null);
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col">
      <button className="btn-success" disabled={busy} onClick={() => approve(false)}>{busy && <Spinner />}✅ 검수 완료 · 승인</button>
      {err && <span className="mt-1 text-xs text-red-600">{err}</span>}
      {issues && (
        <div className="mt-2 max-w-sm rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <div className="mb-1 font-bold">승인 전에 확인해 주세요</div>
          <ul className="list-disc space-y-1 pl-4">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
          <div className="mt-2 flex gap-2">
            <button className="btn-secondary text-xs" onClick={() => setIssues(null)}>돌아가서 수정</button>
            <button className="btn-success text-xs" disabled={busy} onClick={() => approve(true)}>확인했어요, 그래도 승인</button>
          </div>
        </div>
      )}
    </span>
  );
}

export function RejectButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn-danger"
      disabled={busy}
      onClick={async () => {
        const reason = window.prompt("반려 사유를 적어 주세요 (나중에 참고용)", "");
        if (reason === null) return;
        setBusy(true);
        await fetch(`/api/posts/${postId}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reject", reason }) });
        setBusy(false);
        router.refresh();
      }}
    >
      {busy && <Spinner />}반려
    </button>
  );
}
