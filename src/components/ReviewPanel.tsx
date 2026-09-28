"use client";

import { useEffect, useState } from "react";
import type { SeoCheck } from "@/lib/content/seo";
import { Spinner } from "./ActionButton";
import { useSubmit } from "./Forms";

type Props = {
  postId: string;
  report: { score: number; checks: SeoCheck[]; stats: Record<string, number>; similarity?: { max: number; with: { id: string; title: string } | null; warn: boolean } } | null;
  checklist: string[];
  reviewerNote: string;
  meta: { keyword: string; description: string; slug: string; tags: string[]; sources: { title: string; url: string }[] };
};

const GROUPS = ["SEO", "AEO", "GEO", "수익화", "정책"] as const;

export function ReviewPanel({ postId, report, checklist, reviewerNote, meta }: Props) {
  const key = `review-${postId}`;
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [note, setNote] = useState(reviewerNote);
  const { busy, msg, submit } = useSubmit();

  useEffect(() => {
    try {
      setDone(JSON.parse(localStorage.getItem(key) ?? "{}"));
    } catch {}
  }, [key]);
  const toggle = (i: number) => {
    const next = { ...done, [i]: !done[i] };
    setDone(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  };

  const score = report?.score ?? 0;
  const color = score >= 80 ? "text-emerald-600" : score >= 60 ? "text-amber-600" : "text-red-600";

  return (
    <>
      <div className="card">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">SEO · AEO · GEO 점검</h3>
          <span className={`text-3xl font-extrabold ${color}`}>{score}</span>
        </div>
        {report && (
          <p className="mt-1 text-xs text-gray-500">
            {report.stats.chars?.toLocaleString()}자 · 키워드 {report.stats.keywordCount}회 · 소제목 {report.stats.headings} · FAQ {report.stats.faq} · 이미지 {report.stats.images}
          </p>
        )}
        {report?.similarity?.warn && (
          <div className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">
            ⚠️ 유사문서 위험: “{report.similarity.with?.title}”와 {Math.round(report.similarity.max * 100)}% 유사해요. 관점·예시·구성을 바꿔 주세요.
          </div>
        )}
        <div className="mt-3 flex flex-col gap-3">
          {GROUPS.map((g) => {
            const items = report?.checks.filter((c) => c.group === g) ?? [];
            if (!items.length) return null;
            return (
              <div key={g}>
                <div className="mb-1 text-xs font-bold text-gray-500">{g}</div>
                <ul className="flex flex-col gap-1">
                  {items.map((c) => (
                    <li key={c.id} className="flex items-start gap-2 text-xs">
                      <span>{c.pass ? "✅" : "⚠️"}</span>
                      <span className={c.pass ? "text-gray-600" : "font-medium text-gray-900"}>
                        {c.label}
                        {c.detail && <span className="text-gray-400"> — {c.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h3 className="mb-2 font-semibold">사람 검수 체크리스트</h3>
        <ul className="flex flex-col gap-2 text-sm">
          {[...checklist, "사실·수치·요금이 최신 공식 정보와 일치", "내 경험·의견 한 문단 이상 추가", "제휴 링크·대가성 문구 확인"].map((c, i) => (
            <li key={i}>
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" className="mt-1" checked={!!done[i]} onChange={() => toggle(i)} />
                <span className={done[i] ? "text-gray-400 line-through" : ""}>{c}</span>
              </label>
            </li>
          ))}
        </ul>
        <textarea className="input mt-3" rows={3} placeholder="검수 메모" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn-secondary mt-2 w-full" disabled={busy || note === reviewerNote} onClick={() => submit(`/api/posts/${postId}`, { reviewerNote: note }, "PATCH")}>
          {busy && <Spinner />}메모 저장
        </button>
        {msg && <p className="mt-1 text-xs text-gray-500">{msg}</p>}
      </div>

      <div className="card text-xs">
        <h3 className="mb-2 text-sm font-semibold">메타 정보</h3>
        <dl className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1.5">
          <dt className="text-gray-500">키워드</dt><dd className="font-medium">{meta.keyword}</dd>
          <dt className="text-gray-500">메타 설명</dt><dd>{meta.description}</dd>
          <dt className="text-gray-500">퍼머링크</dt><dd className="font-mono">{meta.slug}</dd>
          <dt className="text-gray-500">태그</dt><dd>{meta.tags.join(", ")}</dd>
          <dt className="text-gray-500">출처</dt>
          <dd className="flex flex-col">{meta.sources.map((s) => <a key={s.url} href={s.url} target="_blank" className="truncate text-indigo-600 underline">{s.title}</a>)}</dd>
        </dl>
      </div>
    </>
  );
}

/** 네이버 등에서 사람이 직접 공개한 경우 URL 을 기록 */
export function MarkPublished({ postId }: { postId: string }) {
  const { busy, submit } = useSubmit();
  return (
    <button
      className="btn-secondary"
      disabled={busy}
      onClick={() => {
        const url = window.prompt("직접 공개 발행한 글의 주소(URL)를 입력하세요 (분석 연결용)", "");
        if (url !== null) submit(`/api/posts/${postId}/action`, { action: "markPublished", url });
      }}
    >
      {busy && <Spinner />}직접 발행함으로 표시
    </button>
  );
}
