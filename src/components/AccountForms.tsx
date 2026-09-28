"use client";

import { useState } from "react";
import { Spinner } from "./ActionButton";
import { useSubmit } from "./Forms";

const HELP: Record<string, string> = {
  BLOGGER: "외부 ID = 블로그 ID (비우면 구글 연결 시 첫 블로그로 자동 설정)",
  NAVER: "외부 ID = 네이버 블로그 아이디 (blog.naver.com/아이디)",
  INSTAGRAM: "외부 ID = 인스타그램 비즈니스 계정 ID, 액세스 토큰 = 장기 토큰",
  THREADS: "외부 ID = 스레드 사용자 ID, 액세스 토큰 = Threads API 토큰",
  FACEBOOK: "외부 ID = 페이스북 페이지 ID, 액세스 토큰 = 페이지 액세스 토큰",
};

export function AddAccount() {
  const [f, setF] = useState({ platform: "BLOGGER", name: "", externalId: "", url: "", concept: "", accessToken: "" });
  const { busy, msg, submit } = useSubmit();
  const sns = ["INSTAGRAM", "THREADS", "FACEBOOK"].includes(f.platform);
  return (
    <form className="card grid gap-3 md:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); if (await submit("/api/accounts", f)) setF({ ...f, name: "", externalId: "", url: "", concept: "", accessToken: "" }); }}>
      <h2 className="font-semibold md:col-span-2">계정 추가</h2>
      <div>
        <label className="label">플랫폼</label>
        <select className="input" value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>
          <option value="BLOGGER">구글 블로거</option>
          <option value="NAVER">네이버 블로그</option>
          <option value="INSTAGRAM">인스타그램</option>
          <option value="THREADS">스레드</option>
          <option value="FACEBOOK">페이스북 페이지</option>
        </select>
        <p className="mt-1 text-[11px] text-gray-400">{HELP[f.platform]}</p>
      </div>
      <div><label className="label">이름 *</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예: 지원포유 직장인 AI" /></div>
      <div><label className="label">외부 ID</label><input className="input" value={f.externalId} onChange={(e) => setF({ ...f, externalId: e.target.value })} /></div>
      <div><label className="label">블로그/채널 주소</label><input className="input" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://..." /></div>
      {!sns && (
        <div className="md:col-span-2">
          <label className="label">계정 콘셉트 (계정마다 다르게 → 유사문서 방지)</label>
          <input className="input" value={f.concept} onChange={(e) => setF({ ...f, concept: e.target.value })} placeholder="예: 프리랜서 업무 자동화 후기 중심, 실전 템플릿 공유" />
        </div>
      )}
      {sns && <div className="md:col-span-2"><label className="label">액세스 토큰</label><input className="input" type="password" value={f.accessToken} onChange={(e) => setF({ ...f, accessToken: e.target.value })} /></div>}
      <div className="md:col-span-2"><button className="btn-primary" disabled={busy || !f.name}>{busy && <Spinner />}추가</button>{msg && <span className="ml-2 text-xs text-gray-500">{msg}</span>}</div>
    </form>
  );
}

type Settings = { adsenseClientId?: string; adsenseSlotId?: string; ga4PropertyId?: string; gscSiteUrl?: string; publishMode?: string };

export function AccountSettingsForm({ id, platform, concept, externalId, url, settings }: { id: string; platform: string; concept: string; externalId: string; url: string; settings: Settings }) {
  const [f, setF] = useState({ concept, externalId, url, ...settings, accessToken: "" });
  const { busy, msg, submit } = useSubmit();
  const save = () =>
    submit(`/api/accounts/${id}`, {
      concept: f.concept,
      externalId: f.externalId,
      url: f.url,
      accessToken: f.accessToken || undefined,
      settings: { adsenseClientId: f.adsenseClientId, adsenseSlotId: f.adsenseSlotId, ga4PropertyId: f.ga4PropertyId, gscSiteUrl: f.gscSiteUrl, publishMode: f.publishMode },
    }, "PATCH");
  const inp = (k: keyof typeof f, label: string, ph = "") => (
    <div><label className="label">{label}</label><input className="input text-xs" value={(f[k] as string) ?? ""} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  );
  return (
    <details className="mt-3 rounded-lg border p-3">
      <summary className="cursor-pointer text-xs font-semibold text-gray-600">설정 편집</summary>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {inp("externalId", "외부 ID")}
        {inp("url", "주소")}
        {platform !== "INSTAGRAM" && platform !== "THREADS" && platform !== "FACEBOOK" && <div className="md:col-span-2">{inp("concept", "콘셉트")}</div>}
        {platform === "BLOGGER" && (
          <>
            {inp("adsenseClientId", "애드센스 게시자 ID", "ca-pub-0000000000000000")}
            {inp("adsenseSlotId", "인아티클 광고 슬롯 ID", "1234567890")}
            {inp("ga4PropertyId", "GA4 속성 ID (숫자)", "123456789")}
            {inp("gscSiteUrl", "서치콘솔 속성", "https://xxx.blogspot.com/")}
          </>
        )}
        {platform === "NAVER" && (
          <div>
            <label className="label">1단계 발행 방식</label>
            <select className="input text-xs" value={f.publishMode ?? "private"} onChange={(e) => setF({ ...f, publishMode: e.target.value })}>
              <option value="private">비공개 발행</option>
              <option value="draft">임시저장</option>
            </select>
          </div>
        )}
        {["INSTAGRAM", "THREADS", "FACEBOOK"].includes(platform) && <div className="md:col-span-2">{inp("accessToken", "새 액세스 토큰 (변경 시에만 입력)")}</div>}
      </div>
      <button className="btn-primary mt-3" disabled={busy} onClick={save}>{busy && <Spinner />}저장</button>
      {msg && <span className="ml-2 text-xs text-gray-500">{msg}</span>}
    </details>
  );
}
