"use client";

import { useState } from "react";
import { Spinner } from "./ActionButton";
import { useSubmit } from "./Forms";

type Row = { keyword: string; monthlySearch: number; monthlyClicks: number; compIdx: string; documentCount: number | null; priority: number };

/** 연관 키워드 확장 — 네이버 검색광고 공식 데이터 표 (AI 미사용) */
export function RelatedKeywords() {
  const [kw, setKw] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const { busy, msg, setMsg, submit } = useSubmit();
  const [added, setAdded] = useState<Set<string>>(new Set());

  async function search() {
    setRows(null);
    const r = await submit("/api/keywords/related", { keyword: kw });
    if (r?.rows) setRows(r.rows);
  }

  return (
    <div className="card flex flex-col gap-3">
      <div>
        <h2 className="font-semibold">연관 키워드 확장</h2>
        <p className="text-xs text-gray-500">자동완성·네이버 검색결과의 "함께 많이 찾는" 문구까지 후보로 모아, 검색량·경쟁도는 네이버 검색광고 공식 데이터로만 채웁니다. AI 추측은 쓰지 않아요.</p>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input className="input" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="예: 클로드" />
        <button className="btn-primary whitespace-nowrap" disabled={busy || !kw.trim()}>{busy && <Spinner />}조회</button>
      </form>
      {msg && <p className="text-xs text-red-600">{msg}</p>}
      {rows && (
        <div className="max-h-96 overflow-auto">
          <table className="table">
            <thead><tr><th>키워드</th><th>월 검색</th><th>광고경쟁</th><th>문서수</th><th>우선순위</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.keyword}>
                  <td className="font-medium">{r.keyword}</td>
                  <td className="tabular-nums">{r.monthlySearch.toLocaleString("ko-KR")}</td>
                  <td>{r.compIdx || "-"}</td>
                  <td className="tabular-nums">{r.documentCount != null ? r.documentCount.toLocaleString("ko-KR") : <span className="text-gray-400">미조회</span>}</td>
                  <td className="tabular-nums">{r.priority}</td>
                  <td>
                    <button
                      className="btn-secondary text-xs"
                      disabled={added.has(r.keyword)}
                      onClick={async () => {
                        setMsg(null);
                        if (await submit("/api/topics", r)) setAdded(new Set(added).add(r.keyword));
                      }}
                    >
                      {added.has(r.keyword) ? "추가됨" : "주제로 추가"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
