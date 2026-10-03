"use client";

import { useState } from "react";
import { Spinner } from "./ActionButton";
import { useSubmit } from "./Forms";

type Change = { field: string; before: string; after: string; reason: string; evidence: string };
type Review = { at: string; summary: string; changes: Change[]; concerns: string[]; applied: number[]; platform: string };

/** AI 사실 검수 결과 — 자동 반영하지 않고, 사람이 골라서 적용 */
/** atLabel 은 서버에서 포맷해 전달 (서버·브라우저의 날짜 포맷 차이로 인한 hydration 오류 방지) */
export function AiReviewCard({ postId, review, atLabel, locked = false }: { postId: string; review: Review | null; atLabel?: string; locked?: boolean }) {
  const run = useSubmit();
  const apply = useSubmit();
  const [sel, setSel] = useState<number[]>([]);
  const [failedReasons, setFailedReasons] = useState<Record<number, string>>({});
  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">AI 사실 검수</h3>
        {!locked && (
          <button className="btn-secondary text-xs" disabled={run.busy} onClick={() => run.submit(`/api/posts/${postId}/review`, {})}>
            {run.busy && <Spinner />}🔎 {review ? "다시 검수" : "검수 실행"}
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500">웹 검색으로 사실 오류·오탈자만 찾아 제안해요. 제목·구조·키워드는 보존하고, 적용은 직접 고릅니다.</p>
      {run.msg && <p className="mt-1 text-xs text-gray-500">{run.msg}</p>}
      {review && (
        <div className="mt-3 flex flex-col gap-3 text-sm">
          <p className="rounded-lg bg-gray-50 p-2 text-xs">{review.summary}</p>
          {review.changes.length === 0 && <p className="text-xs text-emerald-700">수정 제안 없음</p>}
          {review.changes.map((c, i) => {
            const done = review.applied.includes(i);
            return (
              <label key={i} className={`flex gap-2 rounded-lg border p-2 text-xs ${done ? "opacity-50" : ""}`}>
                <input type="checkbox" disabled={done || locked} checked={sel.includes(i)} onChange={(e) => setSel(e.target.checked ? [...sel, i] : sel.filter((x) => x !== i))} />
                <span className="flex-1">
                  <span className={`badge mr-1 ${c.reason === "사실오류" ? "bg-red-50 text-red-700" : "bg-gray-100"}`}>{c.reason}</span>
                  <span className="text-gray-400">{c.field}</span>
                  <br />
                  <del className="text-red-600">{c.before}</del> → <ins className="text-emerald-700 no-underline">{c.after}</ins>
                  <br />
                  <span className="text-gray-500">근거: {c.evidence}</span>
                  {done && <span className="ml-1 text-emerald-600">적용됨</span>}
                  {failedReasons[i] && <span className="ml-1 text-amber-600">⚠️ 적용 안 됨 — {failedReasons[i]}</span>}
                </span>
              </label>
            );
          })}
          {review.changes.length > 0 && !locked && (
            <button
              className="btn-primary"
              disabled={apply.busy || !sel.length}
              onClick={async () => {
                const data = await apply.submit(`/api/posts/${postId}/review`, { indices: sel }, "PATCH");
                const failed = (data?.failed ?? []) as { index: number; reason: string }[];
                setFailedReasons(Object.fromEntries(failed.map((f) => [f.index, f.reason])));
                apply.setMsg(failed.length ? `${data.applied}건 적용, ${failed.length}건은 적용 안 됨(아래 ⚠️ 표시 확인)` : `${data?.applied ?? 0}건 모두 적용됨`);
                setSel([]);
              }}
            >
              {apply.busy && <Spinner />}선택한 {sel.length}건 적용
            </button>
          )}
          {apply.msg && <p className="text-xs text-gray-500">{apply.msg}</p>}
          {review.concerns.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-bold text-amber-700">사람 확인 필요</div>
              <ul className="list-disc pl-5 text-xs text-gray-600">{review.concerns.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          )}
          <p className="text-[11px] text-gray-400">검수 시각 {atLabel ?? review.at}</p>
        </div>
      )}
    </div>
  );
}
