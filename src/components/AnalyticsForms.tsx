"use client";

import { useState } from "react";
import { Spinner } from "./ActionButton";
import { useSubmit } from "./Forms";

export function CsvImport() {
  const [kind, setKind] = useState<"metrics" | "revenue">("revenue");
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const { busy, msg, submit } = useSubmit();
  const example =
    kind === "revenue"
      ? "날짜,출처,금액,계정,글URL,메모\n2026-09-01,애드포스트,1520,demo-naver,,\n2026-09-01,쇼핑커넥트,8900,demo-naver,https://blog.naver.com/demo-naver/223000000001,노트북"
      : "날짜,글URL,조회수\n2026-09-01,https://blog.naver.com/demo-naver/223000000001,132";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button className={kind === "revenue" ? "btn-primary" : "btn-secondary"} onClick={() => setKind("revenue")}>수익 CSV</button>
        <button className={kind === "metrics" ? "btn-primary" : "btn-secondary"} onClick={() => setKind("metrics")}>조회수 CSV</button>
      </div>
      <textarea className="input font-mono text-xs" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={example} />
      <div className="flex items-center gap-2">
        <button
          className="btn-primary"
          disabled={busy || !csv.trim()}
          onClick={async () => {
            const r = await submit("/api/analytics/import", { kind, csv });
            if (r) setResult(`✅ ${r.ok}건 반영${r.errors?.length ? ` · 오류 ${r.errors.length}건: ${r.errors.slice(0, 3).join(" / ")}` : ""}`);
          }}
        >
          {busy && <Spinner />}가져오기
        </button>
        <button className="btn-secondary text-xs" onClick={() => setCsv(example)}>예시 채우기</button>
      </div>
      {(result || msg) && <p className="text-xs text-gray-600">{result ?? msg}</p>}
      <p className="text-[11px] text-gray-400">네이버 애드포스트·쇼핑커넥트·블로그 통계는 공개 API 가 없어 CSV(엑셀에서 저장) 또는 직접 입력으로 반영합니다. 애드포스트는 합산 정산되므로 <b>정산(대표) 계정</b>으로 한 번만 입력하면 묶인 계정들에 조회수 비중으로 자동 배분돼요.</p>
    </div>
  );
}

/** 프로그램 없이 직접 작성해 올린 글을 등록 — 등록해두면 GA4/서치콘솔·조회수 CSV 가 이 글의 remoteUrl 로 매칭됨 */
export function ImportPostForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ accountId: accounts[0]?.id ?? "", title: "", remoteUrl: "", publishedAt: today });
  const { busy, msg, submit } = useSubmit();
  return (
    <form
      className="grid gap-2 md:grid-cols-5 md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        submit("/api/posts/import", f).then((r) => {
          if (r) setF({ ...f, title: "", remoteUrl: "" });
        });
      }}
    >
      <div>
        <label className="label">계정</label>
        <select className="input" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div><label className="label">제목</label><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
      <div><label className="label">글 URL</label><input className="input" value={f.remoteUrl} onChange={(e) => setF({ ...f, remoteUrl: e.target.value })} placeholder="https://..." /></div>
      <div><label className="label">발행일</label><input type="date" className="input" value={f.publishedAt} onChange={(e) => setF({ ...f, publishedAt: e.target.value })} /></div>
      <button className="btn-primary" disabled={busy || !f.title.trim() || !f.remoteUrl.trim()}>{busy && <Spinner />}등록</button>
      {msg && <p className="text-xs text-gray-500 md:col-span-5">{msg}</p>}
    </form>
  );
}

export function RevenueForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ date: today, source: "ADPOST", amount: "", accountId: accounts[0]?.id ?? "", note: "" });
  const { busy, msg, submit } = useSubmit();
  return (
    <form className="grid gap-2 md:grid-cols-5 md:items-end" onSubmit={(e) => { e.preventDefault(); submit("/api/revenue", f); }}>
      <div><label className="label">날짜</label><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
      <div>
        <label className="label">수익원</label>
        <select className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
          <option value="ADPOST">네이버 애드포스트</option>
          <option value="SHOPPING_CONNECT">네이버 쇼핑커넥트</option>
          <option value="ADSENSE">구글 애드센스</option>
          <option value="COUPANG">쿠팡파트너스</option>
          <option value="OTHER">기타</option>
        </select>
      </div>
      <div><label className="label">금액(원)</label><input className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
      <div>
        <label className="label">계정</label>
        <select className="input" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
          <option value="">(없음)</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <button className="btn-primary" disabled={busy}>{busy && <Spinner />}수익 추가</button>
      {msg && <p className="text-xs text-gray-500 md:col-span-5">{msg}</p>}
    </form>
  );
}
