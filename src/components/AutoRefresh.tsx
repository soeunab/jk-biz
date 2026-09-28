"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** 생성·발행 중인 항목이 있을 때 주기적으로 화면을 갱신합니다. */
export function AutoRefresh({ active, intervalMs = 3000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return active ? <span className="text-xs text-gray-400">⏳ 자동 새로고침 중…</span> : null;
}
