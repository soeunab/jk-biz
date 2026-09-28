"use client";

import { useState } from "react";
import type { Manuscript } from "@/lib/content/types";
import { Spinner } from "./ActionButton";
import { useSubmit } from "./Forms";

/** 검수자용 원고 편집기 — 저장하면 HTML 과 SEO 점수가 다시 계산됩니다. */
export function ManuscriptEditor({ postId, initial }: { postId: string; initial: Manuscript }) {
  const [m, setM] = useState<Manuscript>(initial);
  const [json, setJson] = useState<string | null>(null);
  const { busy, msg, submit } = useSubmit();
  const set = <K extends keyof Manuscript>(k: K, v: Manuscript[K]) => setM({ ...m, [k]: v });

  async function save() {
    let payload = m;
    if (json !== null) {
      try {
        payload = JSON.parse(json);
      } catch {
        alert("JSON 형식이 올바르지 않습니다.");
        return;
      }
    }
    await submit(`/api/posts/${postId}`, { manuscript: payload }, "PATCH");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 -mx-5 -mt-5 flex items-center gap-3 border-b bg-white/95 px-5 py-3 backdrop-blur">
        <button className="btn-primary" onClick={save} disabled={busy}>{busy && <Spinner />}💾 저장하고 SEO 재점검</button>
        <button className="btn-secondary" onClick={() => setJson(json === null ? JSON.stringify(m, null, 2) : null)}>{json === null ? "JSON 직접 편집" : "양식 편집으로"}</button>
        {msg && <span className="text-xs text-gray-500">{msg}</span>}
      </div>

      {json !== null ? (
        <textarea className="input h-[70vh] font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} />
      ) : (
        <>
          <Field label="제목"><input className="input" value={m.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="핵심 키워드"><input className="input" value={m.focusKeyword} onChange={(e) => set("focusKeyword", e.target.value)} /></Field>
            <Field label="태그 (쉼표 구분)"><input className="input" value={m.tags.join(", ")} onChange={(e) => set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))} /></Field>
          </div>
          <Field label={`메타 설명 (${m.metaDescription.length}자)`}><textarea className="input" rows={2} value={m.metaDescription} onChange={(e) => set("metaDescription", e.target.value)} /></Field>
          <Field label="상단 직답 (AEO: AI 답변·스니펫용)"><textarea className="input" rows={3} value={m.directAnswer} onChange={(e) => set("directAnswer", e.target.value)} /></Field>
          <Field label="핵심 요약 (한 줄에 하나)"><textarea className="input" rows={3} value={m.tldr.join("\n")} onChange={(e) => set("tldr", e.target.value.split("\n").filter(Boolean))} /></Field>
          <Field label="도입부"><textarea className="input" rows={4} value={m.intro} onChange={(e) => set("intro", e.target.value)} /></Field>
          {m.sections.map((s, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="badge bg-gray-100">H{s.level}</span>
                <input className="input font-semibold" value={s.heading} onChange={(e) => set("sections", m.sections.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)))} />
                <SectionRewrite postId={postId} index={i} />
                <button className="btn-danger text-xs" onClick={() => set("sections", m.sections.filter((_, j) => j !== i))}>삭제</button>
              </div>
              <textarea className="input" rows={7} value={s.body} onChange={(e) => set("sections", m.sections.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />
              <input className="input mt-2 text-xs" placeholder="꿀팁 (선택)" value={s.tip} onChange={(e) => set("sections", m.sections.map((x, j) => (j === i ? { ...x, tip: e.target.value } : x)))} />
            </div>
          ))}
          <button className="btn-secondary self-start" onClick={() => set("sections", [...m.sections, { heading: "새 소제목", level: 2, body: "", table: null, tip: "", image: null }])}>+ 섹션 추가</button>
          <div className="rounded-xl border border-gray-200 p-3">
            <div className="mb-2 text-sm font-semibold">FAQ</div>
            {m.faq.map((f, i) => (
              <div key={i} className="mb-2 grid gap-1">
                <input className="input font-medium" value={f.q} onChange={(e) => set("faq", m.faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />
                <textarea className="input" rows={2} value={f.a} onChange={(e) => set("faq", m.faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} />
              </div>
            ))}
            <button className="btn-secondary text-xs" onClick={() => set("faq", [...m.faq, { q: "", a: "" }])}>+ FAQ 추가</button>
          </div>
          <Field label="마무리"><textarea className="input" rows={3} value={m.conclusion} onChange={(e) => set("conclusion", e.target.value)} /></Field>
          <Field label="CTA"><input className="input" value={m.cta} onChange={(e) => set("cta", e.target.value)} /></Field>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

/** 섹션 하나만 AI 로 다시 쓰기 — 저장된 원고 기준으로 실행되고, 완료되면 화면이 새로고침됩니다. */
function SectionRewrite({ postId, index }: { postId: string; index: number }) {
  const { busy, msg, submit } = useSubmit();
  return (
    <span className="flex flex-col">
      <button
        className="btn-secondary whitespace-nowrap text-xs"
        disabled={busy}
        onClick={async () => {
          const instruction = window.prompt("이 섹션을 AI로 다시 씁니다 (저장된 원고 기준, 소제목 유지). 요청 사항이 있으면 적어 주세요.", "");
          if (instruction === null) return;
          await submit(`/api/posts/${postId}/section`, { index, instruction });
          window.location.reload();
        }}
      >
        {busy && <Spinner />}🤖 다시 쓰기
      </button>
      {msg && <span className="text-[10px] text-gray-500">{msg}</span>}
    </span>
  );
}
