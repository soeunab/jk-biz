import type { ReactNode } from "react";

export const POST_STATUS: Record<string, { label: string; cls: string }> = {
  GENERATING: { label: "생성 중", cls: "bg-blue-50 text-blue-700" },
  WAITING_MANUAL: { label: "수동 입력 대기", cls: "bg-amber-100 text-amber-800" },
  DRAFT: { label: "원고 완료", cls: "bg-gray-100 text-gray-700" },
  PRIVATE: { label: "비공개 발행 · 검수 대기", cls: "bg-amber-50 text-amber-700" },
  APPROVED: { label: "승인됨", cls: "bg-indigo-50 text-indigo-700" },
  PUBLISHED: { label: "발행 완료", cls: "bg-emerald-50 text-emerald-700" },
  REJECTED: { label: "반려", cls: "bg-rose-50 text-rose-700" },
  FAILED: { label: "실패", cls: "bg-red-50 text-red-700" },
};

export const PLATFORM: Record<string, { label: string; cls: string }> = {
  BLOGGER: { label: "구글 블로거", cls: "bg-orange-50 text-orange-700" },
  NAVER: { label: "네이버", cls: "bg-green-50 text-green-700" },
  INSTAGRAM: { label: "인스타그램", cls: "bg-pink-50 text-pink-700" },
  THREADS: { label: "스레드", cls: "bg-gray-100 text-gray-800" },
  FACEBOOK: { label: "페이스북", cls: "bg-blue-50 text-blue-700" },
  BOTH: { label: "블로거+네이버", cls: "bg-violet-50 text-violet-700" },
};

export const VERIFICATION: Record<string, { label: string; cls: string }> = {
  VERIFIED: { label: "네이버 공식데이터 확인", cls: "bg-emerald-50 text-emerald-700" },
  SUGGESTED: { label: "자동완성 확인", cls: "bg-sky-50 text-sky-700" },
  UNVERIFIED: { label: "미검증", cls: "bg-gray-100 text-gray-500" },
};

export const PERSONA_LABEL: Record<string, string> = { SOLO: "1인 가구", FREELANCER: "프리랜서", OFFICE: "직장인", GENERAL: "입문자" };

export function Badge({ map, value }: { map: Record<string, { label: string; cls: string }>; value: string }) {
  const m = map[value] ?? { label: value, cls: "bg-gray-100 text-gray-600" };
  return <span className={`badge whitespace-nowrap ${m.cls}`}>{m.label}</span>;
}

export function PageHeader({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="page-title">{title}</h1>
        {desc && <p className="page-desc">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card">
      <div className="text-xs font-semibold text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

export function ScoreBar({ value }: { value: number | null }) {
  if (value == null) return <span className="whitespace-nowrap text-xs text-gray-400" title="공식 데이터로 확인하지 못한 지표">미확인</span>;
  const color = value >= 70 ? "bg-emerald-500" : value >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="text-xs tabular-nums text-gray-600">{Math.round(value)}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">{children}</div>;
}
