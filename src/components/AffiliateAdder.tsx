"use client";

import { useState } from "react";
import { Spinner } from "./ActionButton";
import { useSubmit } from "./Forms";

type Product = { id: string; name: string; program: string };

/**
 * 기존 원고에 제휴 상품 넣기 — 검수 전 원고는 원고에 바로 넣고, 승인·공개된 글은 붙여 넣을 문단만 만들어 줍니다.
 * 상품은 글당 최대 2개, 실제로 관련 있는 섹션 끝에만 (광고·상품이 많으면 체류시간이 줄어듦).
 */
export function AffiliateAdder({ postId, products, sections, used }: { postId: string; products: Product[]; sections: string[]; used: number }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ productId: products[0]?.id ?? "", afterSection: 1, sentence: "", anchorText: "" });
  const [snippet, setSnippet] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { busy, msg, submit } = useSubmit();
  if (!products.length) return <p className="text-xs text-gray-400">등록된 제휴 상품이 없어요 ([수익화 상품]에서 추가)</p>;
  if (!open)
    return (
      <button className="btn-secondary" onClick={() => setOpen(true)}>
        🛒 제휴 상품 넣기 ({used}/2)
      </button>
    );
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 text-xs">
      <select className="input" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.program === "COUPANG" ? "쿠팡" : p.program === "SHOPPING_CONNECT" ? "쇼핑커넥트" : "기타"})
          </option>
        ))}
      </select>
      <select className="input" value={f.afterSection} onChange={(e) => setF({ ...f, afterSection: Number(e.target.value) })}>
        {sections.map((h, i) => (
          <option key={i} value={i + 1}>
            {i + 1}. {h} 끝에
          </option>
        ))}
      </select>
      <textarea className="input" rows={2} placeholder="이 섹션 흐름에 맞는 소개 문장 (예: 직접 써 보니 ○○할 때 편했어요)" value={f.sentence} onChange={(e) => setF({ ...f, sentence: e.target.value })} />
      <input className="input" placeholder="링크 문구 (비우면 상품명)" value={f.anchorText} onChange={(e) => setF({ ...f, anchorText: e.target.value })} />
      <div className="flex gap-2">
        <button
          className="btn-primary"
          disabled={busy || !f.productId || !f.sentence.trim()}
          onClick={async () => {
            const data = await submit(`/api/posts/${postId}/affiliate`, f);
            if (data) {
              setSnippet(data.snippet ?? null);
              setNote(data.note ?? null);
            }
          }}
        >
          {busy && <Spinner />}넣기
        </button>
        <button className="btn-secondary" onClick={() => setOpen(false)}>닫기</button>
      </div>
      {note && <p className="text-gray-600">{note}</p>}
      {snippet && (
        <div>
          <textarea readOnly className="input h-28 font-mono" value={snippet} />
          <button className="mt-1 text-indigo-600" onClick={() => navigator.clipboard.writeText(snippet)}>복사</button>
        </div>
      )}
      {msg && <p className="text-red-600">{msg}</p>}
    </div>
  );
}
