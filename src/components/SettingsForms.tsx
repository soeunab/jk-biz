"use client";

import { useState } from "react";
import type { Brand } from "@/lib/brand";
import { Spinner } from "./ActionButton";
import { useSubmit } from "./Forms";

export function BrandForm({ brand }: { brand: Brand }) {
  const [b, setB] = useState(brand);
  const { busy, msg, submit } = useSubmit();
  const list = (k: "tools" | "seedKeywords" | "bannedPhrases") => (
    <textarea className="input text-sm" rows={3} value={b[k].join(", ")} onChange={(e) => setB({ ...b, [k]: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
  );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div><label className="label">브랜드명</label><input className="input" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} /></div>
      <div><label className="label">태그라인</label><input className="input" value={b.tagline} onChange={(e) => setB({ ...b, tagline: e.target.value })} /></div>
      <div className="md:col-span-2"><label className="label">블로그 주제(미션) — 모든 원고·주제 발굴의 기준</label><textarea className="input" rows={2} value={b.mission} onChange={(e) => setB({ ...b, mission: e.target.value })} /></div>
      <div className="md:col-span-2"><label className="label">저자 소개 (E-E-A-T·GEO 저자 엔티티)</label><textarea className="input" rows={2} value={b.authorBio} onChange={(e) => setB({ ...b, authorBio: e.target.value })} /></div>
      <div className="md:col-span-2"><label className="label">문체</label><input className="input" value={b.tone} onChange={(e) => setB({ ...b, tone: e.target.value })} /></div>
      <div><label className="label">다루는 AI 도구 (쉼표)</label>{list("tools")}</div>
      <div><label className="label">기본 시드 키워드 (쉼표)</label>{list("seedKeywords")}</div>
      <div><label className="label">금지 표현 (쉼표)</label>{list("bannedPhrases")}</div>
      <div>
        <label className="label">제휴 대가성 문구</label>
        <textarea className="input text-sm" rows={3} value={b.disclosure.affiliate} onChange={(e) => setB({ ...b, disclosure: { ...b.disclosure, affiliate: e.target.value } })} />
      </div>
      <div className="md:col-span-2">
        <label className="label">AI 활용 고지 문구</label>
        <input className="input text-sm" value={b.disclosure.ai} onChange={(e) => setB({ ...b, disclosure: { ...b.disclosure, ai: e.target.value } })} />
      </div>
      <div><button className="btn-primary" disabled={busy} onClick={() => submit("/api/settings/brand", b, "PUT")}>{busy && <Spinner />}저장</button>{msg && <span className="ml-2 text-xs">{msg}</span>}</div>
    </div>
  );
}

export function AffiliateForm() {
  const [f, setF] = useState({ program: "SHOPPING_CONNECT", name: "", url: "", tags: "", price: "", platform: "NAVER", note: "" });
  const { busy, msg, submit } = useSubmit();
  return (
    <form className="card grid gap-3 md:grid-cols-3" onSubmit={async (e) => { e.preventDefault(); if (await submit("/api/affiliates", f)) setF({ ...f, name: "", url: "", tags: "", price: "", note: "" }); }}>
      <h2 className="font-semibold md:col-span-3">상품 추가</h2>
      <div>
        <label className="label">프로그램</label>
        <select className="input" value={f.program} onChange={(e) => setF({ ...f, program: e.target.value, platform: e.target.value === "SHOPPING_CONNECT" ? "NAVER" : "BLOGGER" })}>
          <option value="SHOPPING_CONNECT">네이버 쇼핑커넥트</option>
          <option value="COUPANG">쿠팡파트너스</option>
          <option value="OTHER">기타 제휴</option>
        </select>
      </div>
      <div><label className="label">상품명 *</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><label className="label">제휴 링크 *</label><input className="input" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" /></div>
      <div><label className="label">연관 태그 (쉼표) — 주제 매칭에 사용</label><input className="input" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="노트북, 재택근무, 프리랜서" /></div>
      <div><label className="label">가격(원)</label><input className="input" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
      <div>
        <label className="label">사용 플랫폼</label>
        <select className="input" value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>
          <option value="NAVER">네이버</option>
          <option value="BLOGGER">블로거</option>
          <option value="BOTH">둘 다</option>
        </select>
      </div>
      <div className="md:col-span-3"><button className="btn-primary" disabled={busy || !f.name || !f.url}>{busy && <Spinner />}추가</button>{msg && <span className="ml-2 text-xs text-gray-500">{msg}</span>}</div>
    </form>
  );
}
