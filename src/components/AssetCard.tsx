"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type A = { id: string; slot: string; src: string; alt: string; source: string; credit: string };

const SOURCE_LABEL: Record<string, string> = { GEMINI: "AI 생성", UNSPLASH: "Unsplash", PEXELS: "Pexels", SCREENSHOT: "화면 캡처", TEMPLATE: "템플릿", UPLOAD: "직접 업로드" };

export function AssetCard({ a, locked = false }: { a: A; locked?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [alt, setAlt] = useState(a.alt);
  const [busy, setBusy] = useState(false);

  async function send(file?: File) {
    setBusy(true);
    const fd = new FormData();
    if (file) fd.append("file", file);
    fd.append("alt", alt);
    await fetch(`/api/assets/${a.id}`, { method: "POST", body: fd });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={a.src} alt={a.alt} className="aspect-video w-full bg-gray-100 object-cover" />
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold">{a.slot}</span>
          <span className="badge bg-gray-100 text-gray-600">{SOURCE_LABEL[a.source] ?? a.source}</span>
        </div>
        <input className="input text-xs" value={alt} disabled={locked} onChange={(e) => setAlt(e.target.value)} placeholder="대체텍스트(alt)" />
        {a.credit && <div className="text-[11px] text-gray-400">{a.credit}</div>}
        {!locked && (
          <div className="flex gap-2">
            <button className="btn-secondary flex-1 text-xs" disabled={busy} onClick={() => input.current?.click()}>직접 캡처로 교체</button>
            <button className="btn-secondary text-xs" disabled={busy || alt === a.alt} onClick={() => send()}>alt 저장</button>
          </div>
        )}
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
      </div>
    </div>
  );
}
