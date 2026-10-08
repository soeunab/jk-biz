"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { GoldenInsight, GoldenRow } from "@/lib/topics/golden";

type Account = { id: string; name: string };

const fmt = (n: number | null | undefined) => (n == null ? "–" : n.toLocaleString("ko-KR"));
const ratioText = (r: number | null, capped = false) => (r == null ? "미측정" : `${capped ? "≥" : ""}${r < 10 ? r.toFixed(4) : r.toFixed(1)}`);
const docsText = (n: number | null, capped: boolean) => (n == null ? "–" : `${n.toLocaleString("ko-KR")}${capped ? "+" : ""}`);

/** 구간 상세 — 왼쪽 키워드 표(비율 좋은 순), 오른쪽 선택한 키워드의 상세(30일 추이·골든 점수·진단) */
export function GoldenTable({ rows, accounts, total, initialId }: { rows: GoldenRow[]; accounts: Account[]; total: number; initialId?: string }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | undefined>(initialId ?? rows.find((r) => r.ratio != null)?.id);
  const list = useMemo(() => {
    const t = q.trim().replace(/\s/g, "").toLowerCase();
    return t ? rows.filter((r) => r.keyword.replace(/\s/g, "").toLowerCase().includes(t)) : rows;
  }, [rows, q]);
  const selected = rows.find((r) => r.id === sel);
  const accName = new Map(accounts.map((a) => [a.id, a.name]));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="card p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <span className="text-sm font-semibold text-gray-700">
            표시 {list.length.toLocaleString("ko-KR")}개 <span className="font-normal text-gray-400">/ 구간 전체 {total.toLocaleString("ko-KR")}개</span>
          </span>
          <input className="input w-48 text-sm" placeholder="키워드 검색…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">키워드</th>
                <th className="px-3 py-2 text-right">총검색량</th>
                <th className="px-3 py-2 text-right">PC</th>
                <th className="px-3 py-2 text-right">Mobile</th>
                <th className="px-3 py-2 text-right">문서수</th>
                <th className="px-3 py-2 text-right">비율</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={r.id} onClick={() => setSel(r.id)} className={`cursor-pointer border-t ${sel === r.id ? "bg-indigo-50" : "hover:bg-gray-50"} ${r.blogFit === false ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium">{r.keyword}</span>
                    {r.used && <span className="ml-1 text-xs" title="이미 주제·원고로 쓴 키워드">✍️</span>}
                    {r.seasonality === "spike" && <span className="ml-1 text-xs" title="이슈형 — 한때 몰렸다가 식은 수요">⚡</span>}
                    {r.recent30 != null && r.recent30 >= 50 && <span className="ml-1 text-xs" title={`최근 30일 발행 ${r.recent30 >= 100 ? "100+" : r.recent30}개 — 최근 경쟁 큼`}>⚠️</span>}
                    {r.blogFit === false && <span className="ml-1 text-xs text-red-600" title={r.fitNote ?? ""}>블로그 부적합</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.volume)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-400">{fmt(r.pc)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-400">{fmt(r.mobile)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-indigo-600">{docsText(r.documentCount, r.docsCapped)}</td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${r.ratio == null ? "text-gray-400" : "font-semibold"}`}>{ratioText(r.ratio, r.docsCapped)}</td>
                </tr>
              ))}
              {!list.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-400">조건에 맞는 키워드가 없어요.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="lg:sticky lg:top-4 lg:self-start">{selected ? <GoldenDetail row={selected} accName={accName} /> : <div className="card text-sm text-gray-500">왼쪽에서 키워드를 고르세요.</div>}</div>
    </div>
  );
}

function GoldenDetail({ row, accName }: { row: GoldenRow; accName: Map<string, string> }) {
  const router = useRouter();
  const [data, setData] = useState<{ trend: { date: string; ratio: number }[]; insight: GoldenInsight } | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setMsg(null);
    setLoading(true);
    fetch(`/api/topics/golden/trend?id=${row.id}`)
      .then((r) => r.json())
      .then((d) => alive && setData(d.error ? null : d))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [row.id]);

  const post = async (url: string, body: unknown, done: (d: Record<string, unknown>) => string) => {
    setMsg("처리 중…");
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setMsg(res.ok ? done(d) : (d.error ?? `오류 ${res.status}`));
    if (res.ok) router.refresh();
  };

  const max = Math.max(1, ...(data?.trend ?? []).map((t) => t.ratio));
  const ins = data?.insight;
  const q = encodeURIComponent(row.keyword);
  return (
    <div className="card flex flex-col gap-4">
      <h3 className="text-lg font-bold text-indigo-700">📈 {row.keyword}</h3>
      <div className="grid grid-cols-5 divide-x rounded-xl border bg-gray-50 text-center">
        {[
          ["검색량", fmt(row.volume)],
          ["PC", fmt(row.pc)],
          ["모바일", fmt(row.mobile)],
          ["문서", docsText(row.documentCount, row.docsCapped)],
          ["비율", ratioText(row.ratio, row.docsCapped)],
        ].map(([l, v]) => (
          <div key={l} className="py-2">
            <div className="text-[11px] text-gray-400">{l}</div>
            <div className={`text-sm font-bold ${l === "문서" ? "text-indigo-600" : ""}`}>{v}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-500">
        최근 30일 블로그 발행 <b>{row.recent30 == null ? "미측정" : row.recent30 >= 1000 ? "1,000개 이상" : `${row.recent30.toLocaleString("ko-KR")}개`}</b>
        {row.compIdx && <> · 광고경쟁 <b>{row.compIdx}</b></>}
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold text-gray-500">최근 30일 검색 추이 (네이버 데이터랩 상대값)</div>
        {loading ? (
          <div className="h-24 animate-pulse rounded bg-gray-100" />
        ) : data?.trend.length ? (
          <>
            <div className="flex h-24 items-end gap-[2px]">
              {data.trend.map((t) => (
                <div key={t.date} title={`${t.date}: ${t.ratio.toFixed(1)}`} className="flex-1 rounded-t bg-indigo-200" style={{ height: `${Math.max(2, (t.ratio / max) * 100)}%` }} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-gray-400">
              <span>{data.trend[0].date}</span>
              <span>{data.trend[data.trend.length - 1].date}</span>
            </div>
          </>
        ) : (
          <p className="text-xs text-gray-400">추이 데이터가 없어요 (검색량이 매우 적거나 데이터랩 조회 실패).</p>
        )}
      </div>

      {ins && (
        <div className="rounded-xl bg-indigo-50/70 p-4">
          <div className="flex items-start justify-between">
            <span className="text-xs font-bold text-indigo-700">🤖 INSIGHT <span className="font-normal text-indigo-400">(규칙 계산 · AI 토큰 안 씀)</span></span>
            <div className="text-right">
              <div className="text-[10px] text-gray-400">Golden Score</div>
              <div className="text-2xl font-extrabold">{ins.score}점</div>
            </div>
          </div>
          <div className="mt-1 font-bold">{ins.label}</div>
          <div className="mt-2 h-2 rounded-full bg-white">
            <div className={`h-2 rounded-full ${ins.score >= 65 ? "bg-emerald-500" : ins.score >= 45 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${ins.score}%` }} />
          </div>
          <p className="mt-2 text-sm text-gray-700">💡 {ins.advice}</p>
          {ins.flags.map((f) => (
            <div key={f.title} className="mt-2 rounded-lg bg-white p-2 text-sm">
              {f.icon} <b>[{f.title}]</b> {f.body}
            </div>
          ))}
          {ins.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {ins.tags.map((t) => (
                <span key={t} className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600">#{t}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="text-xs text-gray-600">
        {row.blogFit === null ? (
          <span className="text-gray-400">AI 블로그 적합 판정: 아직 안 함</span>
        ) : row.blogFit ? (
          <span>✅ 블로그 글로 답할 수 있는 검색어 (AI 판정)</span>
        ) : (
          <span className="text-red-600">⛔ 블로그 부적합 (AI 판정): {row.fitNote}</span>
        )}
        {row.accounts.length > 0 && <div className="mt-1">어울리는 블로그: {row.accounts.map((id) => accName.get(id) ?? id).join(", ")}</div>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <a className="btn-secondary justify-center" href={`https://search.naver.com/search.naver?query=${q}`} target="_blank" rel="noreferrer">🔍 네이버</a>
        <a className="btn-secondary justify-center" href={`https://search.naver.com/search.naver?ssc=tab.blog.all&query=${q}`} target="_blank" rel="noreferrer">📝 블로그</a>
        <button className="btn-secondary justify-center" onClick={() => post("/api/topics/discover", { seeds: row.keyword, limit: 8 }, () => "롱테일 발굴을 시작했어요 — 아래 주제 목록에 저장돼요.")}>🔎 롱테일 발굴</button>
        <button className="btn-primary justify-center" onClick={() => post("/api/topics/golden/save", { id: row.id }, (d) => (d.existed ? "이미 주제 목록에 있어요." : "주제 목록에 저장했어요 — 아래에서 [제목 만들기]·[원고 생성]을 이어서 하세요."))}>⭐ 주제로 저장</button>
      </div>
      {msg && <p className="text-xs text-gray-600">{msg}</p>}
      <p className="text-[11px] text-gray-400">비율(문서수÷검색량)은 후보를 찾는 기준일 뿐 상위 노출을 보장하지 않아요. 문서수는 네이버 블로그 섹션 검색 화면 값이라 1,000 이상은 &quot;1,000+&quot;로 보여요(비율은 그 이상).</p>
    </div>
  );
}
