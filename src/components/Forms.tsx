"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner, waitJobs } from "./ActionButton";

type AccountOpt = { id: string; name: string; platform: string };

/** 폼 제출 공통: JSON POST → 작업 대기 → 새로고침/이동 */
export function useSubmit() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(url: string, body: unknown, method = "POST") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `오류 ${res.status}`);
      const ids: string[] = data.jobIds ?? (data.jobId ? [data.jobId] : []);
      if (ids.length) await waitJobs(ids, (p) => setMsg(`처리 중… ${p}%`));
      setMsg(data.ok === undefined && data.errors ? `완료 ${data.ok}건` : null);
      // 생성은 진행하되 알아야 할 점(콘셉트 미설정·중복으로 건너뜀 등)은 이동 전에 알려 줌
      const notes = [...(data.warnings ?? []), ...(data.skipped ?? [])];
      if (notes.length) window.alert(notes.join("\n"));
      if (data.redirect) router.push(data.redirect);
      router.refresh();
      return data;
    } catch (e) {
      setMsg((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, msg, setMsg, submit };
}

export function DiscoverForm() {
  const { busy, msg, submit } = useSubmit();
  const [seeds, setSeeds] = useState("");
  const [platform, setPlatform] = useState("BOTH");
  const [persona, setPersona] = useState("ANY");
  const [limit, setLimit] = useState(12);
  return (
    <form
      className="card grid gap-3 md:grid-cols-[1fr_auto_auto_auto_auto] md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        submit("/api/topics/discover", { seeds, platform, persona, limit });
      }}
    >
      <div>
        <label className="label">시드 키워드 (쉼표 구분, 비우면 브랜드 기본 키워드)</label>
        <input className="input" value={seeds} onChange={(e) => setSeeds(e.target.value)} placeholder="예: 제미나이 사용법, 클로드 보고서, 프리랜서 AI" />
      </div>
      <div>
        <label className="label">플랫폼</label>
        <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="BOTH">전체</option>
          <option value="NAVER">네이버 우선</option>
          <option value="BLOGGER">구글 우선</option>
        </select>
      </div>
      <div>
        <label className="label">독자</label>
        <select className="input" value={persona} onChange={(e) => setPersona(e.target.value)}>
          <option value="ANY">골고루</option>
          <option value="SOLO">1인 가구</option>
          <option value="FREELANCER">프리랜서</option>
          <option value="OFFICE">직장인</option>
          <option value="GENERAL">입문자</option>
        </select>
      </div>
      <div>
        <label className="label">개수</label>
        <input className="input w-20" type="number" min={3} max={30} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
      </div>
      <button className="btn-primary" disabled={busy}>{busy && <Spinner />}🔎 주제 발굴</button>
      {msg && <p className="text-xs text-gray-500 md:col-span-5">{msg}</p>}
    </form>
  );
}

export function AccountPicker({ accounts, value, onChange }: { accounts: AccountOpt[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!accounts.length) return <p className="text-xs text-red-600">블로그 계정이 없습니다. [계정 관리]에서 추가하세요.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {accounts.map((a) => (
        <label key={a.id} className={`cursor-pointer rounded-lg border px-2 py-1 text-xs ${value.includes(a.id) ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200"}`}>
          <input type="checkbox" className="mr-1" checked={value.includes(a.id)} onChange={(e) => onChange(e.target.checked ? [...value, a.id] : value.filter((x) => x !== a.id))} />
          {a.platform === "NAVER" ? "🟢" : "🟠"} {a.name}
        </label>
      ))}
    </div>
  );
}

export function GenerateFromTopic({ topicId, accounts, defaultPlatform }: { topicId: string; accounts: AccountOpt[]; defaultPlatform: string }) {
  const { busy, msg, submit } = useSubmit();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(accounts.filter((a) => defaultPlatform === "BOTH" || a.platform === defaultPlatform).slice(0, 2).map((a) => a.id));
  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)}>✍️ 원고 생성</button>;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
      <div className="text-xs font-semibold">어느 블로그용 원고를 만들까요? (계정마다 다른 관점으로 작성)</div>
      <AccountPicker accounts={accounts} value={sel} onChange={setSel} />
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !sel.length} onClick={() => submit(`/api/topics/${topicId}/generate`, { accountIds: sel })}>
          {busy && <Spinner />}생성 시작
        </button>
        <button className="btn-secondary" onClick={() => setOpen(false)}>취소</button>
      </div>
      {msg && <p className="text-xs text-gray-500">{msg}</p>}
    </div>
  );
}

export function ManualPostForm({ accounts, sources = [] }: { accounts: AccountOpt[]; sources?: { id: string; title: string; account: string; platform: string }[] }) {
  const { busy, msg, submit } = useSubmit();
  const [sourcePostId, setSourcePostId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [title, setTitle] = useState("");
  const [persona, setPersona] = useState("OFFICE");
  const [sel, setSel] = useState<string[]>([]);
  return (
    <form
      className="card flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit("/api/posts", { keyword, title, persona, accountIds: sel, sourcePostId: sourcePostId || undefined });
      }}
    >
      <h2 className="font-semibold">키워드로 바로 원고 만들기</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="label">핵심 키워드 *</label>
          <input className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="예: 클로드 엑셀 정리" />
        </div>
        <div>
          <label className="label">가제 (선택)</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label">대상 독자</label>
          <select className="input" value={persona} onChange={(e) => setPersona(e.target.value)}>
            <option value="OFFICE">직장인</option>
            <option value="FREELANCER">프리랜서</option>
            <option value="SOLO">1인 가구</option>
            <option value="GENERAL">입문자</option>
          </select>
        </div>
      </div>
      {sources.length > 0 && (
        <div>
          <label className="label">재발행 원본 (선택) — 지정하면 원본의 주제·키워드를 이어받아 다른 계정용으로 새로 씁니다</label>
          <select className="input" value={sourcePostId} onChange={(e) => setSourcePostId(e.target.value)}>
            <option value="">(없음 — 새 글)</option>
            {sources.map((p) => (
              <option key={p.id} value={p.id}>{p.platform === "NAVER" ? "🟢" : "🟠"} {p.account} · {p.title}</option>
            ))}
          </select>
        </div>
      )}
      <AccountPicker accounts={accounts} value={sel} onChange={setSel} />
      <div>
        <button className="btn-primary" disabled={busy || (!keyword && !sourcePostId) || !sel.length}>{busy && <Spinner />}✍️ 원고 생성</button>
        {msg && <span className="ml-3 text-xs text-gray-500">{msg}</span>}
      </div>
    </form>
  );
}
