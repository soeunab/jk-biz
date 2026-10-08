"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner, waitJobs } from "./ActionButton";
import { CATEGORY_CHOICES } from "@/lib/topics/channels/config";
import { NO_RESTRICTION } from "@/lib/topics/channels/filters";
import type { ChannelId } from "@/lib/topics/channels/types";

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

/** 검색어 기반 발굴 — 입력한 시드 키워드 자체가 주제 */
export function DiscoverForm() {
  const { busy, msg, submit } = useSubmit();
  const [seeds, setSeeds] = useState("");
  const [limit, setLimit] = useState(12);
  return (
    <form
      className="card grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        submit("/api/topics/discover", { seeds, limit });
      }}
    >
      <div>
        <label className="label">시드 키워드 (쉼표 구분) — 줄인 키워드·함께 많이 찾는까지 넓혀 롱테일 키워드를 찾아요 (제목은 고른 키워드에서 따로 만들어요)</label>
        <input className="input" value={seeds} onChange={(e) => setSeeds(e.target.value)} placeholder="예: 신한은행 유출, 청년미래적금, 제미나이 사용법" />
      </div>
      <div>
        <label className="label">개수</label>
        <input className="input w-20" type="number" min={3} max={30} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
      </div>
      <button className="btn-primary" disabled={busy}>{busy && <Spinner />}🔎 롱테일 키워드 찾기</button>
      {msg && <p className="text-xs text-gray-500 md:col-span-3">{msg}</p>}
    </form>
  );
}

const CHANNEL_OPTIONS: [ChannelId, string][] = [
  ["naver_home", "네이버 홈판"],
  ["naver_ranking", "네이버 랭킹"],
  ["nate", "네이트"],
  ["google_trends", "구글 트렌드"],
  ["daum", "다음 뉴스"],
  ["google_news", "구글 뉴스"],
];

/** 실시간 6채널 교차검증 발굴 (contents-finder 방식) */
export function ChannelDiscoverForm() {
  const { busy, msg, submit } = useSubmit();
  const [category, setCategory] = useState("비즈니스·경제");
  const [limit, setLimit] = useState(10);
  const [channels, setChannels] = useState<ChannelId[]>(CHANNEL_OPTIONS.map(([c]) => c));
  return (
    <form
      className="card grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        submit("/api/topics/discover-channels", { category, limit, channels });
      }}
    >
      <p className="text-xs text-gray-500 md:col-span-3">
        지금 여러 채널에서 동시에 화제인 사건을 찾아 <b>메인 키워드(씨드)만</b> 저장해요 (예: 신한은행 유출). 참여 채널 수·신선도·랭킹·트렌드 급등률로 점수를 매기고,
        부정 사건·정치 이슈·6시간 넘은 기사·이미 저장한 소재는 빼요. 결과 목록에서 골라 바로 [원고 생성]하세요. 수집에 4~6분 걸려요.
      </p>
      <div>
        <label className="label">블로그 카테고리 (네이버 32개)</label>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORY_CHOICES.map((c) => (
            <option key={c} value={c}>{c === NO_RESTRICTION ? `${c} (전체 보기)` : c}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">개수</label>
        <input className="input w-20" type="number" min={1} max={30} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
      </div>
      <button className="btn-primary" disabled={busy || !channels.length}>{busy && <Spinner />}📡 실시간 트렌드에서 발굴</button>
      <div className="flex flex-wrap gap-2 md:col-span-3">
        {CHANNEL_OPTIONS.map(([c, label]) => (
          <label key={c} className={`cursor-pointer rounded-lg border px-2 py-1 text-xs ${channels.includes(c) ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200"}`}>
            <input type="checkbox" className="mr-1" checked={channels.includes(c)} onChange={(e) => setChannels(e.target.checked ? [...channels, c] : channels.filter((x) => x !== c))} />
            {label}
          </label>
        ))}
      </div>
      {msg && <p className="text-xs text-gray-500 md:col-span-3">{msg}</p>}
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

export function GenerateFromTopic({
  topicId,
  accounts,
  defaultPlatform,
  defaultFormat = "SEARCH",
}: {
  topicId: string;
  accounts: AccountOpt[];
  defaultPlatform: string;
  /** 네이버 글 형식 기본값 — 실시간 트렌드 주제는 홈판형 */
  defaultFormat?: "SEARCH" | "HOMEFEED";
}) {
  const { busy, msg, submit } = useSubmit();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(accounts.filter((a) => defaultPlatform === "BOTH" || a.platform === defaultPlatform).slice(0, 2).map((a) => a.id));
  const [format, setFormat] = useState(defaultFormat);
  const naverSelected = accounts.some((a) => a.platform === "NAVER" && sel.includes(a.id));
  // 주제 추천 플랫폼이 블로거여도 네이버 계정이 있으면 형식을 고를 수 있게 (홈판형은 네이버 계정에만 적용)
  const hasNaver = accounts.some((a) => a.platform === "NAVER");
  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)}>✍️ 원고 생성</button>;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
      <div className="text-xs font-semibold">어느 블로그용 원고를 만들까요? (계정마다 다른 관점으로 작성)</div>
      <AccountPicker accounts={accounts} value={sel} onChange={setSel} />
      {hasNaver && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold">네이버 글 형식</span>
          {(
            [
              ["SEARCH", "🔍 검색형", "검색 유입·AI 브리핑 인용용 — 직답·질문형 소제목·FAQ"],
              ["HOMEFEED", "🏠 홈판형", "네이버 홈피드 노출용 — 궁금증 제목·첫 문장 후킹·댓글 유도 질문 (실시간 화제에 적합)"],
            ] as const
          ).map(([v, label, tip]) => (
            <label key={v} title={tip} className={`cursor-pointer rounded-lg border px-2 py-1 ${format === v ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200"}`}>
              <input type="radio" className="mr-1" checked={format === v} onChange={() => setFormat(v)} />
              {label}
            </label>
          ))}
          <span className="text-gray-400">(블로거는 항상 검색형)</span>
          {format === "HOMEFEED" && !naverSelected && <span className="text-amber-700">홈판형은 네이버 계정에만 적용돼요 — 위에서 🟢 네이버 계정을 선택하세요</span>}
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !sel.length} onClick={() => submit(`/api/topics/${topicId}/generate`, { accountIds: sel, format })}>
          {busy && <Spinner />}생성 시작
        </button>
        <button className="btn-secondary" onClick={() => setOpen(false)}>취소</button>
      </div>
      {msg && <p className="text-xs text-gray-500">{msg}</p>}
    </div>
  );
}

