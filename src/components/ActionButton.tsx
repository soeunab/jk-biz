"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  url: string;
  method?: "POST" | "PATCH" | "DELETE" | "PUT";
  body?: unknown;
  label: React.ReactNode;
  className?: string;
  confirm?: string;
  /** 성공 후 이동할 경로 (응답의 redirect 가 우선) */
  redirect?: string;
  disabled?: boolean;
};

/** API 호출 → 작업(jobId)이면 끝날 때까지 기다린 뒤 화면 새로고침 */
export function ActionButton({ url, method = "POST", body, label, className = "btn-secondary", confirm, redirect, disabled }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `오류 ${res.status}`);
      const jobIds: string[] = data.jobIds ?? (data.jobId ? [data.jobId] : []);
      if (jobIds.length) {
        setMsg("처리 중…");
        await waitJobs(jobIds, (p) => setMsg(`처리 중… ${p}%`));
      }
      setMsg(null);
      if (data.redirect ?? redirect) router.push(data.redirect ?? redirect);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button type="button" className={className} disabled={busy || disabled} onClick={run}>
        {busy ? <Spinner /> : null}
        {label}
      </button>
      {msg && <span className="mt-1 max-w-xs text-xs text-gray-500">{msg}</span>}
    </span>
  );
}

export async function waitJobs(ids: string[], onProgress?: (pct: number) => void) {
  for (;;) {
    const res = await fetch(`/api/jobs?ids=${ids.join(",")}`);
    const { jobs } = (await res.json()) as { jobs: { status: string; progress: number; error?: string }[] };
    const done = jobs.every((j) => j.status === "DONE" || j.status === "FAILED");
    onProgress?.(Math.round(jobs.reduce((a, j) => a + j.progress, 0) / Math.max(1, jobs.length)));
    if (done) {
      const failed = jobs.find((j) => j.status === "FAILED");
      if (failed) throw new Error(`작업 실패: ${failed.error?.split("\n")[0] ?? ""}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

export function Spinner() {
  return <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}
