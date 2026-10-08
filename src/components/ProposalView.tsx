"use client";

import { useState } from "react";

type Retitle = { titles: string[]; metaDescriptions: string[]; reason: string };
type Refresh = {
  uncoveredQueries: string[];
  newSections: { heading: string; body: string }[];
  newFaq: { q: string; a: string }[];
  internalLinks: { title: string; url: string; where: string }[];
  checklist: string[];
};
type Prune = { decision: "improve" | "merge" | "delete"; reason: string; mergeInto: { title: string; url: string } | null; steps: string[] };

const DECISION = { improve: "개선", merge: "다른 글로 합치기", delete: "삭제" } as const;

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="ml-2 shrink-0 text-xs text-indigo-600"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "복사됨" : "복사"}
    </button>
  );
}

function Row({ text }: { text: string }) {
  return (
    <li className="flex items-start justify-between gap-2 rounded bg-white px-2 py-1">
      <span className="whitespace-pre-wrap">{text}</span>
      <Copy text={text} />
    </li>
  );
}

/** [AI 제안 만들기] 결과 — 공개된 글은 자동으로 바꾸지 않고, 사람이 복사해 직접 반영합니다 */
export function ProposalView({ type, proposal, at }: { type: string; proposal: unknown; at?: string }) {
  const head = (
    <div className="mb-1 text-xs font-semibold text-indigo-700">
      🤖 AI 제안{at ? ` · ${new Date(at).toLocaleString("ko-KR")}` : ""} — 글은 바뀌지 않았어요. 골라서 복사해 직접 반영하세요.
    </div>
  );
  if (type === "RETITLE") {
    const p = proposal as Retitle;
    return (
      <div className="mt-2 rounded-lg bg-indigo-50/60 p-3 text-sm">
        {head}
        <p className="mb-1 text-xs text-gray-600">{p.reason}</p>
        <div className="text-xs font-semibold">제목 후보</div>
        <ul className="mb-2 flex flex-col gap-1">{p.titles.map((t) => <Row key={t} text={t} />)}</ul>
        <div className="text-xs font-semibold">메타 설명 후보</div>
        <ul className="flex flex-col gap-1">{p.metaDescriptions.map((t) => <Row key={t} text={t} />)}</ul>
      </div>
    );
  }
  if (type === "REFRESH") {
    const p = proposal as Refresh;
    return (
      <div className="mt-2 rounded-lg bg-indigo-50/60 p-3 text-sm">
        {head}
        {p.uncoveredQueries.length > 0 && <p className="mb-1 text-xs text-gray-600">본문이 답하지 않는 검색어: {p.uncoveredQueries.join(", ")}</p>}
        {p.newSections.length > 0 && (
          <>
            <div className="text-xs font-semibold">추가할 섹션</div>
            <ul className="mb-2 flex flex-col gap-1">{p.newSections.map((s) => <Row key={s.heading} text={`## ${s.heading}\n${s.body}`} />)}</ul>
          </>
        )}
        {p.newFaq.length > 0 && (
          <>
            <div className="text-xs font-semibold">추가할 FAQ</div>
            <ul className="mb-2 flex flex-col gap-1">{p.newFaq.map((f) => <Row key={f.q} text={`Q. ${f.q}\nA. ${f.a}`} />)}</ul>
          </>
        )}
        {p.internalLinks.length > 0 && (
          <>
            <div className="text-xs font-semibold">넣을 내부링크</div>
            <ul className="mb-2 flex flex-col gap-1">{p.internalLinks.map((l) => <Row key={l.url} text={`${l.title} — ${l.url}\n(${l.where})`} />)}</ul>
          </>
        )}
        {p.checklist.length > 0 && (
          <ul className="list-disc pl-4 text-xs text-gray-600">{p.checklist.map((c) => <li key={c}>{c}</li>)}</ul>
        )}
      </div>
    );
  }
  if (type === "PRUNE") {
    const p = proposal as Prune;
    return (
      <div className="mt-2 rounded-lg bg-indigo-50/60 p-3 text-sm">
        {head}
        <div>
          판단: <b>{DECISION[p.decision]}</b>
          {p.mergeInto && (
            <>
              {" "}→{" "}
              <a className="text-indigo-600 underline" href={p.mergeInto.url} target="_blank" rel="noreferrer">{p.mergeInto.title}</a>
            </>
          )}
        </div>
        <p className="text-xs text-gray-600">{p.reason}</p>
        {p.steps.length > 0 && <ol className="mt-1 list-decimal pl-4 text-xs">{p.steps.map((s) => <li key={s}>{s}</li>)}</ol>}
      </div>
    );
  }
  return null;
}
