"use client";

import { useState } from "react";
import { Spinner } from "./ActionButton";
import { useSubmit } from "./Forms";

const MAX_NOTES = 30_000;
const MAX_URLS = 10;

type Initial = { notes: string; urls: string[]; mode: "prefer" | "only" } | null;

/**
 * 📎 내 자료로 다시 쓰기 — 사용자가 찾은 기사·메모·URL 을 최우선 근거로 원고를 다시 씁니다.
 * URL 은 서버가 직접 내려받지 않고, 원고 작성 전 조사 단계의 AI 가 읽습니다.
 */
export function UserSourcesForm({ postId, initial }: { postId: string; initial: Initial }) {
  const { busy, msg, setMsg, submit } = useSubmit();
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [urlText, setUrlText] = useState((initial?.urls ?? []).join("\n"));
  const [mode, setMode] = useState<"prefer" | "only">(initial?.mode ?? "prefer");

  const urls = urlText
    .split("\n")
    .map((u) => u.trim())
    .filter(Boolean);
  const badUrl = urls.find((u) => !/^https?:\/\/\S+$/i.test(u));
  const tooMany = urls.length > MAX_URLS;
  const tooLong = notes.length > MAX_NOTES;
  const empty = !notes.trim() && !urls.length;

  return (
    <details className="text-sm" open={!!initial}>
      <summary className="cursor-pointer font-semibold">📎 내 자료로 다시 쓰기</summary>
      <p className="mt-1 text-xs text-gray-500">
        직접 찾은 기사 본문·메모·참고 URL 을 넣으면 그 자료를 가장 우선하는 근거로 원고를 다시 써요. 자료에 없는 회사·수치·관계는 쓰지 않도록 지시합니다.
      </p>
      <label className="label mt-2">자료 텍스트 (기사 본문·메모 붙여넣기)</label>
      <textarea className="input text-xs" rows={8} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="예) 기사 본문, 보도자료, 직접 정리한 메모" />
      <div className={`text-right text-[11px] ${tooLong ? "text-red-600" : "text-gray-400"}`}>
        {notes.length.toLocaleString("ko-KR")} / {MAX_NOTES.toLocaleString("ko-KR")}자
      </div>
      <label className="label">참고 URL (한 줄에 하나, 최대 {MAX_URLS}개)</label>
      <textarea className="input text-xs" rows={3} value={urlText} onChange={(e) => setUrlText(e.target.value)} placeholder="https://..." />
      {badUrl && <p className="text-[11px] text-red-600">http(s) 주소만 넣을 수 있어요: {badUrl}</p>}
      {tooMany && <p className="text-[11px] text-red-600">URL 은 {MAX_URLS}개까지 넣을 수 있어요.</p>}
      <div className="mt-2 flex flex-col gap-1 text-xs">
        <label className="flex items-center gap-2">
          <input type="radio" name="user-sources-mode" checked={mode === "prefer"} onChange={() => setMode("prefer")} />
          내 자료 우선 + 웹 조사로 보충 (권장)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="user-sources-mode" checked={mode === "only"} onChange={() => setMode("only")} />
          내 자료만 사용 (웹 조사 안 함)
        </label>
      </div>
      <button
        type="button"
        className="btn-primary mt-3 w-full"
        disabled={busy || empty || !!badUrl || tooMany || tooLong}
        onClick={async () => {
          if (!window.confirm("넣은 자료로 원고와 이미지를 새로 만듭니다. 지금 원고의 수정 내용은 사라져요. 계속할까요?")) return;
          const data = await submit(`/api/posts/${postId}/action`, { action: "regenerate", userSources: { notes, urls, mode } });
          if (data) setMsg("자료를 반영해 다시 썼어요.");
        }}
      >
        {busy && <Spinner />}📎 내 자료로 다시 쓰기
      </button>
      {msg && <p className="mt-1 text-xs text-gray-500">{msg}</p>}
    </details>
  );
}
