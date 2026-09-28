"use client";

import { useState } from "react";
import type { Slide, Captions } from "@/lib/cardnews";
import { Spinner } from "./ActionButton";
import { useSubmit } from "./Forms";

export function CreateCardNews({ posts }: { posts: { id: string; title: string }[] }) {
  const { busy, msg, submit } = useSubmit();
  const [postId, setPostId] = useState(posts[0]?.id ?? "");
  const [topic, setTopic] = useState("");
  const [theme, setTheme] = useState("brand");
  return (
    <form className="card grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end" onSubmit={(e) => { e.preventDefault(); submit("/api/cardnews", { postId: topic ? undefined : postId, topic, theme }); }}>
      <div>
        <label className="label">원고에서 만들기</label>
        <select className="input" value={postId} onChange={(e) => setPostId(e.target.value)} disabled={!!topic}>
          {posts.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </div>
      <div>
        <label className="label">또는 주제 직접 입력</label>
        <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="예: 직장인 AI 회의록 요약 3단계" />
      </div>
      <div>
        <label className="label">테마</label>
        <select className="input" value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="brand">브랜드(남보라)</option>
          <option value="light">라이트</option>
          <option value="yellow">옐로</option>
        </select>
      </div>
      <button className="btn-primary" disabled={busy || (!postId && !topic)}>{busy && <Spinner />}🖼️ 카드뉴스 생성</button>
      {msg && <p className="text-xs text-gray-500 md:col-span-4">{msg}</p>}
    </form>
  );
}

export function SlideEditor({ id, slides, theme }: { id: string; slides: Slide[]; theme: string }) {
  const [s, setS] = useState(slides);
  const [t, setT] = useState(theme);
  const { busy, msg, submit } = useSubmit();
  const upd = (i: number, patch: Partial<Slide>) => setS(s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <select className="input w-40" value={t} onChange={(e) => setT(e.target.value)}>
          <option value="brand">브랜드(남보라)</option>
          <option value="light">라이트</option>
          <option value="yellow">옐로</option>
        </select>
        <button className="btn-primary" disabled={busy} onClick={() => submit(`/api/cardnews/${id}`, { slides: s, theme: t }, "PATCH")}>{busy && <Spinner />}수정 반영 · 다시 렌더링</button>
        {msg && <span className="text-xs text-gray-500">{msg}</span>}
      </div>
      {s.map((sl, i) => (
        <div key={i} className="grid gap-2 rounded-xl border p-3 md:grid-cols-[80px_1fr_1fr]">
          <div className="text-xs font-bold text-gray-500">{i + 1}. {sl.type}</div>
          <div className="flex flex-col gap-1">
            <input className="input text-xs" value={sl.kicker} placeholder="라벨" onChange={(e) => upd(i, { kicker: e.target.value })} />
            <textarea className="input font-semibold" rows={2} value={sl.title} onChange={(e) => upd(i, { title: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <textarea className="input text-sm" rows={2} value={sl.body} placeholder="본문" onChange={(e) => upd(i, { body: e.target.value })} />
            <input className="input text-xs" value={sl.bullets.join(" | ")} placeholder="목록 (| 로 구분)" onChange={(e) => upd(i, { bullets: e.target.value.split("|").map((b) => b.trim()).filter(Boolean) })} />
          </div>
        </div>
      ))}
    </div>
  );
}

const CAPTION_LABEL: Record<keyof Captions, string> = { instagram: "인스타그램", threads: "스레드", x: "X(트위터)", facebook: "페이스북", band: "밴드·카카오채널" };

export function CaptionEditor({ id, captions, link }: { id: string; captions: Partial<Captions>; link: string }) {
  const [c, setC] = useState(captions);
  const { busy, msg, submit } = useSubmit();
  return (
    <div className="flex flex-col gap-3">
      {(Object.keys(CAPTION_LABEL) as (keyof Captions)[]).map((k) => (
        <div key={k}>
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0">{CAPTION_LABEL[k]} <span className="font-normal text-gray-400">({(c[k] ?? "").length}자)</span></label>
            <button className="text-xs text-indigo-600" onClick={() => navigator.clipboard.writeText((c[k] ?? "").replaceAll("{link}", link))}>복사</button>
          </div>
          <textarea className="input text-sm" rows={k === "instagram" ? 6 : 3} value={c[k] ?? ""} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
        </div>
      ))}
      <button className="btn-secondary self-start" disabled={busy} onClick={() => submit(`/api/cardnews/${id}`, { captions: c }, "PATCH")}>{busy && <Spinner />}캡션 저장</button>
      {msg && <p className="text-xs text-gray-500">{msg}</p>}
    </div>
  );
}

export function SocialPublish({ id, accounts }: { id: string; accounts: { id: string; name: string; platform: string }[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const { busy, msg, submit } = useSubmit();
  if (!accounts.length) return <p className="text-xs text-gray-500">SNS 계정이 없습니다. [계정 관리]에서 인스타그램·스레드·페이스북 계정을 추가하세요.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {accounts.map((a) => (
          <label key={a.id} className={`cursor-pointer rounded-lg border px-2 py-1 text-xs ${sel.includes(a.id) ? "border-indigo-500 bg-indigo-50" : ""}`}>
            <input type="checkbox" className="mr-1" checked={sel.includes(a.id)} onChange={(e) => setSel(e.target.checked ? [...sel, a.id] : sel.filter((x) => x !== a.id))} />
            {a.name}
          </label>
        ))}
      </div>
      <button className="btn-primary self-start" disabled={busy || !sel.length} onClick={() => { if (confirm("선택한 SNS 에 바로 게시합니다. 계속할까요?")) submit(`/api/cardnews/${id}/publish`, { accountIds: sel }); }}>
        {busy && <Spinner />}📤 SNS 발행
      </button>
      {msg && <p className="text-xs text-gray-500">{msg}</p>}
    </div>
  );
}
