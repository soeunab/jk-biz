import { db } from "@/lib/db";
import { ActionButton } from "@/components/ActionButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ChannelDiscoverForm, DiscoverForm, GenerateFromTopic } from "@/components/Forms";
import { DEFAULT_CHANNEL_CONFIG } from "@/lib/topics/channels/config";
import type { ChannelTopicSignals } from "@/lib/topics/channels/discover";
import { CHANNEL_LABEL } from "@/lib/topics/channels/scoring";
import { fmtAgo } from "@/lib/topics/channels/text";
import { Badge, Empty, PageHeader, PLATFORM, ScoreBar, VERIFICATION } from "@/components/ui";
import { ANSWER_TYPE_LABEL, INTENT_LABEL, type AnswerType, type Intent } from "@/lib/topics/scoring";
import { formatNumber } from "@/lib/util";
import { docRatio, fmtRatio, isFloorVolume, MIN_MONTHLY_SEARCH, type SerpBenchmark, type TitleType } from "@/lib/topics/expand";
import { GoldenTierGrid } from "@/components/GoldenTierGrid";
import { GoldenTable } from "@/components/GoldenTable";
import { goldenList, PERIODS, TIERS, tierCounts, type TierId } from "@/lib/topics/golden";
import { TitleChecklist } from "@/components/TitleChecklist";
import { LIFESPAN_LABEL, lifespanOf, titleChecks, type Lifespan, type TimeForm } from "@/lib/topics/titleRules";

/** 검색어 기반 발굴 Topic.signals 중 롱테일 확장이 추가한 값 */
type ExpandSignals = {
  mainKeyword?: string;
  isMain?: boolean;
  titleOptions?: { type: TitleType; title: string }[];
  bestType?: TitleType;
  benchmark?: SerpBenchmark | null;
  /** 플레이북 3중 필터 — 수요 성격(1년 추이)·질문 유형(AI 내성) */
  seasonality?: "evergreen" | "seasonal" | "spike" | null;
  answerType?: AnswerType | null;
  aiResistance?: number | null;
  related?: { keyword: string; volume: number | null }[];
  /** 제목 만들 때 조회한 시간 표현 검색량·수명 (titleRules) */
  timeForms?: TimeForm[];
  lifespan?: Lifespan;
  titleLocked?: boolean;
};

const SEASONALITY_BADGE = {
  evergreen: { label: "🌲 상시형", cls: "bg-emerald-50 text-emerald-700", tip: "1년 내내 검색이 꾸준해요 — 한 번 쓰면 오래 유입되는 에버그린 주제" },
  seasonal: { label: "🔁 변동형", cls: "bg-sky-50 text-sky-700", tip: "시기에 따라 검색이 오르내려요 — 오르기 2~4주 전에 발행하면 좋아요" },
  spike: { label: "⚡ 이슈형", cls: "bg-orange-50 text-orange-700", tip: "한때 몰렸다가 식은 수요예요 — 빠르게 쓰되 상시형 주제와 섞어 운영하세요" },
} as const;

/** 고른 롱테일 키워드의 6가지 유형 제목 — 아직 없으면 [제목 만들기], 있으면 골라서 이 주제의 제목으로 */
function TitleOptions({ topicId, keyword, origin, intent, current, sig, used }: { topicId: string; keyword: string; origin: string; intent: string | null; current: string; sig: ExpandSignals; used: boolean }) {
  const opts = sig.titleOptions ?? [];
  const lifespan = sig.lifespan ?? lifespanOf({ origin, seasonality: sig.seasonality, timeForms: sig.timeForms });
  const checkOf = (title: string) => titleChecks(title, { keyword, lifespan, timeForms: sig.timeForms, answerType: sig.answerType, intent, related: sig.related?.map((r) => r.keyword) });
  if (!opts.length) {
    if (used) return null;
    return (
      <div className="mt-1">
        <ActionButton url={`/api/topics/${topicId}/titles`} label="✍️ 제목 6가지 만들기" className="btn-secondary px-2 py-0.5 text-xs" />
      </div>
    );
  }
  return (
    <details className="mt-1 text-xs" open>
      <summary className="cursor-pointer text-gray-500">
        ✍️ 제목 {opts.length}가지 유형 — 키워드를 맨 왼쪽에 · {LIFESPAN_LABEL[lifespan]}
        {sig.timeForms?.length ? ` · 검색되는 시간 표현 ${sig.timeForms.map((f) => f.form).join(", ")}` : ""} · 고른 제목은 원고 제목으로 확정돼요
      </summary>
      <ul className="mt-1 flex flex-col gap-1">
        {opts.map((o) => (
          <li key={o.type} className="flex flex-wrap items-center gap-1">
            <span className="badge bg-gray-100 text-gray-600">{o.type}</span>
            <span className={o.title === current ? "font-semibold text-gray-900" : "text-gray-700"}>{o.title}</span>
            <TitleChecklist checks={checkOf(o.title)} compact />
            {o.title === current ? (
              <span className="text-emerald-700">← 지금 제목{sig.titleLocked ? " 🔒" : ""}</span>
            ) : (
              <ActionButton url={`/api/topics/${topicId}`} method="PATCH" body={{ title: o.title }} label="이 제목으로" className="btn-secondary px-2 py-0.5 text-[11px]" />
            )}
          </li>
        ))}
      </ul>
      {sig.benchmark && (sig.benchmark.titles.length > 0 || sig.benchmark.aiBriefing) && (
        <div className="mt-2 text-gray-500">
          <p>📈 벤치마킹 — 네이버 &quot;{sig.benchmark.keyword}&quot; 상위 노출 글 제목:</p>
          <ul className="list-disc pl-4">
            {sig.benchmark.titles.slice(0, 6).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {sig.benchmark.aiBriefing && (
            <>
              <p className="mt-1">AI 브리핑: {sig.benchmark.aiBriefing}</p>
              <p className="mt-1 font-medium text-amber-700">
                🤖 이 키워드는 AI 브리핑이 이미 답하고 있어요 — 요약 정보만으로는 클릭이 덜 남으니 직접 경험·비교·조건 해석처럼 AI 가 대신 못 하는 각도의 제목을 고르세요.
              </p>
            </>
          )}
        </div>
      )}
    </details>
  );
}

export const dynamic = "force-dynamic";

const ORIGINS = [
  ["", "전체"],
  ["autocomplete", "🔎 검색어 기반"],
  ["channels", "📡 실시간 트렌드"],
  ["golden", "🏆 황금키워드"],
] as const;

/** 경쟁점수(0~100, 높을수록 좋음)를 사람이 바로 이해할 수 있는 말로 */
function competitionVerdict(score: number | null): { label: string; color: string } {
  if (score == null) return { label: "미확인", color: "text-gray-400" };
  if (score >= 70) return { label: "매우 좋음", color: "text-emerald-700" };
  if (score >= 50) return { label: "좋음", color: "text-emerald-600" };
  if (score >= 30) return { label: "보통", color: "text-amber-600" };
  if (score >= 10) return { label: "나쁨", color: "text-red-600" };
  return { label: "매우 나쁨(포화)", color: "text-red-700" };
}

/** 메인 키워드를 어떻게 정했는지: AI 가 해석한 사건·메인 키워드·대안 → 네이버 실측 (이전 방식 기록은 롱테일 후보) */
function KeywordAnalysis({ lt, seed }: { lt: NonNullable<ChannelTopicSignals["longtail"]>; seed: boolean }) {
  const used = lt.candidates.find((c) => c.keyword === lt.usedKeyword);
  const sorted = [...lt.candidates].sort((a, b) => b.score - a.score);
  const usedVerdict = competitionVerdict(used?.competitionScore ?? null);
  return (
    <details>
      <summary className="cursor-pointer text-gray-500">🔍 키워드 분석 — {seed ? "메인 키워드" : "쓴 키워드"} &quot;{lt.usedKeyword}&quot; ({usedVerdict.label})</summary>
      <div className="mt-1 flex flex-col gap-1">
        {lt.story?.summary && (
          <p className="text-gray-600">
            {lt.story.by === "ai" ? "AI 해석" : "대표어"}: {lt.story.summary}
            {lt.seeds?.length ? <span className="text-gray-400"> · {seed ? "대안" : "제안"} 검색어: {lt.seeds.join(", ")}</span> : null}
          </p>
        )}
        {used ? (
          <p className="text-gray-600">
            {seed ? "메인 키워드" : "쓴 키워드"}: <b>{used.keyword}</b> · 검색량 {used.volume != null ? `월 ${formatNumber(used.volume)}` : "미확인"} · 문서수{" "}
            {used.documentCount != null ? formatNumber(used.documentCount) : "미확인"} · 비율 {fmtRatio(docRatio(used.documentCount, used.volume))} · 경쟁점수{" "}
            <span className={usedVerdict.color}>{used.competitionScore != null ? Math.round(used.competitionScore) : "미확인"}({usedVerdict.label})</span>
          </p>
        ) : (
          <p className="text-gray-500">쓴 키워드 &quot;{lt.usedKeyword}&quot;는 측정 후보 목록에 없어요 (이전 방식으로 저장된 소재).</p>
        )}
        <table className="text-left text-gray-600">
          <thead className="text-gray-400">
            <tr>
              <th className="pr-3 font-normal">후보 키워드</th>
              <th className="pr-3 font-normal">검색량</th>
              <th className="pr-3 font-normal">문서수</th>
              <th className="pr-3 font-normal">경쟁점수</th>
              <th className="font-normal">선택용 점수</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 8).map((c) => {
              const isUsed = c.keyword === lt.usedKeyword;
              const v = competitionVerdict(c.competitionScore);
              return (
                <tr key={c.keyword} className={isUsed ? "font-semibold text-gray-900" : ""}>
                  <td className="pr-3">
                    {c.keyword}
                    {isUsed && (seed ? " ← 메인 키워드" : " ← 이번에 쓴 키워드")}
                    {lt.best === c.keyword && !isUsed && " (측정상 최고점)"}
                  </td>
                  <td className="pr-3 tabular-nums">{c.volume != null ? formatNumber(c.volume) : "미확인"}</td>
                  <td className="pr-3 tabular-nums">{c.documentCount != null ? formatNumber(c.documentCount) : "-"}</td>
                  <td className={`pr-3 tabular-nums ${v.color}`}>{c.competitionScore != null ? Math.round(c.competitionScore) : "미확인"}</td>
                  <td className="tabular-nums">{c.score}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-gray-400">
          {seed
            ? "AI 가 사건을 보고 고른 메인 키워드와 대안 검색어의 네이버 실측값이에요. 메인 키워드에 검색량이 잡히면 그대로, 아니면 검색량이 잡힌 대안 중 가장 큰 것을 썼어요."
            : "이전 방식(실시간 발굴에서 롱테일까지 고르던 때)으로 저장된 소재예요."}
        </p>
      </div>
    </details>
  );
}

function ChannelEvidence({ s }: { s: ChannelTopicSignals }) {
  const m = s.metrics;
  const used = s.longtail?.candidates.find((c) => c.keyword === s.longtail?.usedKeyword);
  const best = s.longtail?.candidates.find((c) => c.keyword === s.longtail?.best);
  // 쓴 키워드가 경쟁에서 나쁜 편인데(매우 나쁨/미확인), 측정상 최고점 후보는 그보다 뚜렷이 나을 때만 한눈에 보이는 경고 배지
  const competitionWarning =
    s.longtail && used && (used.competitionScore == null || used.competitionScore < 30) && best && best.keyword !== used.keyword && best.score - used.score >= 15;
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        {(m?.channels ?? []).map((c) => (
          <span key={c} className="badge bg-sky-50 text-sky-700">{CHANNEL_LABEL[c] ?? c}</span>
        ))}
        {(m?.trendPct ?? 0) >= DEFAULT_CHANNEL_CONFIG.googleTrends.instantPct && <span className="badge bg-red-50 text-red-700">🔥 즉시 소재</span>}
        {s.preempt && <span className="badge bg-violet-50 text-violet-700" title="네이트·트렌드·다음에는 있는데 네이버 랭킹·홈판에는 아직 없음 (발행 전 네이버 검색으로 한 번 더 확인)">🚀 선점 후보</span>}
        {competitionWarning && (
          <span className="badge bg-red-50 text-red-700" title="쓴 키워드의 경쟁점수가 안 좋아요 — 아래 '키워드 분석'에서 다른 후보와 비교해 보세요">
            📉 경쟁 심함
          </span>
        )}
      </div>
      <ul className="list-disc pl-4 text-gray-600">
        {s.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer text-gray-500">채널 수집 근거 {s.evidence.length}건</summary>
        <ul className="mt-1 flex flex-col gap-0.5 text-gray-600">
          {s.evidence.map((e, i) => (
            <li key={i}>
              <span className="text-gray-400">{e.channelLabel} · {e.source}:</span>{" "}
              {e.url ? <a className="text-indigo-600 hover:underline" href={e.url} target="_blank" rel="noreferrer">{e.title}</a> : e.title}
              <span className="text-gray-400">
                {[e.press, e.growthPct ? `검색량 ${formatNumber(e.growthPct)}%↑` : null, e.views ? `조회수 ${formatNumber(e.views)}` : null, e.ageMinutes != null ? fmtAgo(e.ageMinutes) : null, e.clusterSize && e.clusterSize > 1 ? `같은 사건 ${e.clusterSize}건` : null]
                  .filter(Boolean)
                  .map((x) => ` · ${x}`)
                  .join("")}
              </span>
            </li>
          ))}
        </ul>
        {s.context?.length ? (
          <>
            <p className="mt-1 text-gray-500">실시간 검색어에 기사가 없어 맥락으로 붙인 &quot;같은 단어가 나온 기사&quot;:</p>
            <ul className="flex flex-col gap-0.5 text-gray-600">
              {s.context.map((e, i) => (
                <li key={i}>
                  <span className="text-gray-400">{e.channelLabel}:</span>{" "}
                  {e.url ? <a className="text-indigo-600 hover:underline" href={e.url} target="_blank" rel="noreferrer">{e.title}</a> : e.title}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {s.ai?.outline?.length ? <p className="mt-1 text-gray-500">AI 구성안: {s.ai.outline.join(" → ")}</p> : null}
        {s.ai?.caution ? <p className="text-gray-500">주의: {s.ai.caution}</p> : null}
        <p className="mt-1 text-gray-400">수집 {new Date(s.collectedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
      </details>
      {s.longtail && s.longtail.candidates.length > 0 && <KeywordAnalysis lt={s.longtail} seed={s.stage === "seed"} />}
    </div>
  );
}

type TopicsSearch = { status?: string; all?: string; origin?: string; sort?: string; golden?: string; gperiod?: string; gacc?: string; gunfit?: string; gk?: string };

export default async function TopicsPage({ searchParams }: { searchParams: Promise<TopicsSearch> }) {
  const sp = await searchParams;
  const status = sp.status ?? "NEW";
  const showAll = sp.all === "1";
  const origin = sp.origin === "channels" || sp.origin === "autocomplete" || sp.origin === "golden" ? sp.origin : "";
  // 주제 목록 정렬 — 우선순위(기본) / 비율(문서수÷검색량 낮은 순) / 검색량(많은 순)
  const sort = sp.sort === "ratio" || sp.sort === "volume" ? sp.sort : "";
  const qs = (o: Record<string, string>) => {
    const p = new URLSearchParams({ status, ...(showAll ? { all: "1" } : {}), ...(origin ? { origin } : {}), ...(sort ? { sort } : {}), ...o });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    return `/topics?${p}`;
  };
  // ② 황금키워드 — 화면 상태는 g* 쿼리로 (주제 목록 쿼리와 섞이지 않게)
  const golden = TIERS.some((t) => t.id === sp.golden) ? (sp.golden as TierId) : undefined;
  const gperiod = PERIODS.includes(Number(sp.gperiod) as (typeof PERIODS)[number]) ? Number(sp.gperiod) : 30;
  const gacc = sp.gacc ?? "";
  const gunfit = sp.gunfit === "1";
  const gqs = (o: Record<string, string>) => {
    const cur: Record<string, string> = { golden: golden ?? "", gperiod: gperiod === 30 ? "" : String(gperiod), gacc, gunfit: gunfit ? "1" : "" };
    const p = new URLSearchParams({ status, ...(showAll ? { all: "1" } : {}), ...(origin ? { origin } : {}), ...(sort ? { sort } : {}), ...cur, ...o });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    return `/topics?${p}#golden`;
  };
  const [gCounts, gList, gRunning, gAccounts] = await Promise.all([
    tierCounts(),
    golden ? goldenList({ tier: golden, period: gperiod, account: gacc || undefined, showUnfit: gunfit }) : Promise.resolve(null),
    // 실행 중 조각을 먼저 (RUNNING 이 QUEUED 보다 알파벳 뒤라 desc), 조각 사이 대기 중이면 누적 측정량으로 진행률 계산
    db.job.findFirst({ where: { type: "topic.golden", status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { status: "desc" }, select: { progress: true, payload: true, status: true } }),
    db.account.findMany({ where: { active: true, platform: { in: ["BLOGGER", "NAVER"] } }, select: { id: true, name: true, platform: true } }),
  ]);
  const gLast = await db.job.findFirst({ where: { type: "topic.golden", status: "DONE" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } });
  const gTier = TIERS.find((t) => t.id === golden);
  const verificationFilter = { ...(showAll ? {} : { verification: { not: "UNVERIFIED" } }), ...(origin ? { origin } : {}) };
  const [topicsRaw, hidden, accounts, running] = await Promise.all([
    db.topic.findMany({ where: { status, ...verificationFilter }, orderBy: [{ confidence: "desc" }, { totalScore: "desc" }], take: sort ? 1000 : 100 }),
    showAll ? Promise.resolve(0) : db.topic.count({ where: { status, verification: "UNVERIFIED", ...(origin ? { origin } : {}) } }),
    db.account.findMany({ where: { active: true, platform: { in: ["BLOGGER", "NAVER"] } }, select: { id: true, name: true, platform: true } }),
    db.job.count({ where: { type: { in: ["topic.discover", "topic.channels", "topic.golden"] }, status: { in: ["QUEUED", "RUNNING"] } } }),
  ]);
  const ratioOf = (t: { documentCount: number | null; searchVolume: number | null }) => (t.documentCount != null && t.searchVolume ? t.documentCount / t.searchVolume : Infinity);
  const topics = (
    sort === "ratio"
      ? [...topicsRaw].sort((a, b) => ratioOf(a) - ratioOf(b))
      : sort === "volume"
        ? [...topicsRaw].sort((a, b) => (b.searchVolume ?? -1) - (a.searchVolume ?? -1))
        : topicsRaw
  ).slice(0, 100);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="주제 발굴"
        desc="① 실시간 트렌드 — 네이버 홈판·랭킹·네이트·구글 트렌드·다음·구글 뉴스를 교차검증해 6시간 이내 화제인 사건의 메인 키워드를 발굴 → 골라서 원고 생성. ② 황금키워드 — 시드 없이 업종 키워드를 넓게 모아 검색량 구간별로 비율 좋은 순. ③ 검색어 기반 — 직접 입력한 키워드로 롱테일 데이터를 모아(검색량·문서수·비율) 키워드 저장 → 고른 키워드만 6가지 유형 제목 생성 → 원고 생성."
        actions={<AutoRefresh active={running > 0} />}
      />
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-700">① 📡 실시간 트렌드 발굴 <span className="font-normal text-gray-400">— 6시간 이내 화제인 사건의 메인 키워드 발굴 → 골라서 원고 생성</span></h2>
        <ChannelDiscoverForm />
      </div>
      <div id="golden" className="flex scroll-mt-4 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">
            ② 🏆 황금키워드 발굴 <span className="font-normal text-gray-400">— 시드 없이 네이버 검색광고 업종 키워드를 넓게 모아, 검색량 구간별로 문서수÷검색량 비율이 좋은 순서로</span>
          </h2>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {gRunning ? (
              <span className="text-indigo-600">
                발굴 중…{" "}
                {Math.max(
                  gRunning.progress,
                  (() => {
                    const spent = Number((gRunning.payload as { spent?: number } | null)?.spent ?? 0);
                    const total = Number(process.env.GOLDEN_SECTION_BUDGET) || 10_000;
                    return Math.min(97, 3 + Math.round((spent / total) * 94));
                  })(),
                )}
                %
              </span>
            ) : (
              <span>{gLast?.finishedAt ? `마지막 발굴 ${gLast.finishedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 매일 새벽 3시 자동` : "아직 발굴 전"}</span>
            )}
            <ActionButton url="/api/topics/golden" label="🏆 황금키워드 발굴" className="btn-primary" />
          </div>
        </div>
        <GoldenTierGrid counts={gCounts} active={golden} hrefFor={(t) => gqs({ golden: t === golden ? "" : t, gacc: "", gk: "" })} />
        {gTier && gList && (
          <div className="flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/30 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-lg font-bold">
                  {gTier.emoji} {gTier.name} <span className="text-sm font-normal text-gray-500">{gTier.band}</span>
                </div>
                <div className="text-xs text-gray-500">{gTier.desc}</div>
              </div>
              <div className="text-right text-sm font-semibold text-indigo-700">총 {gList.total.toLocaleString("ko-KR")}개</div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs font-semibold text-gray-500">기간</span>
              {PERIODS.map((d) => (
                <a key={d} href={gqs({ gperiod: d === 30 ? "" : String(d) })} className={`rounded-lg px-3 py-1 ${gperiod === d ? "bg-indigo-600 text-white" : "border bg-white text-gray-700"}`}>
                  최근 {d}일
                </a>
              ))}
              <span className="ml-2 text-xs font-semibold text-gray-500">내 블로그</span>
              <a href={gqs({ gacc: "" })} className={`rounded-full px-3 py-1 text-xs ${!gacc ? "bg-sky-600 text-white" : "border bg-white text-gray-700"}`}>전체</a>
              {gAccounts.map((a) => (
                <a key={a.id} href={gqs({ gacc: a.id })} className={`rounded-full px-3 py-1 text-xs ${gacc === a.id ? "bg-sky-600 text-white" : "border bg-white text-gray-700"}`}>
                  {a.platform === "NAVER" ? "🟢" : "🟠"} {a.name}
                </a>
              ))}
              <a href={gqs({ gunfit: gunfit ? "" : "1" })} className="ml-auto text-xs text-gray-500 underline">{gunfit ? "블로그 부적합(AI 판정) 숨기기" : "블로그 부적합(AI 판정)도 보기"}</a>
            </div>
            <p className="text-xs text-gray-500">
              최근 {gperiod}일 안에 갱신된 키워드 · 검색량은 월간(PC+모바일) · 비율 = 블로그 누적 문서수 ÷ 검색량(낮을수록 좋음) · 문서수를 아직 못 잰 키워드는 아래쪽 &quot;미측정&quot;(실행할 때마다 범위가 넓어져요)
              {gacc && " · 내 블로그 필터는 AI 가 고른 어울리는 블로그 기준"}
            </p>
            <GoldenTable rows={gList.rows} accounts={gAccounts.map((a) => ({ id: a.id, name: a.name }))} total={gList.total} initialId={sp.gk} />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-700">③ 🔎 검색어 기반 발굴 <span className="font-normal text-gray-400">— 직접 입력한 키워드로 롱테일 키워드(검색량·문서수·비율) 발굴 → 고른 키워드만 [제목 6가지 만들기] → 원고 생성</span></h2>
        <DiscoverForm />
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {[["NEW", "신규"], ["USED", "원고 작성됨"], ["DISMISSED", "보류"]].map(([k, l]) => (
          <a key={k} href={qs({ status: k })} className={`rounded-lg px-3 py-1.5 ${status === k ? "bg-indigo-600 text-white" : "bg-white text-gray-700 border"}`}>{l}</a>
        ))}
        <span className="mx-2 text-gray-300">|</span>
        {ORIGINS.map(([k, l]) => (
          <a key={k || "all"} href={qs({ origin: k })} className={`rounded-lg px-3 py-1.5 ${origin === k ? "bg-sky-600 text-white" : "border bg-white text-gray-700"}`}>{l}</a>
        ))}
        <span className="mx-2 text-gray-300">|</span>
        {(
          [
            ["", "우선순위순"],
            ["ratio", "비율 낮은 순"],
            ["volume", "검색량 많은 순"],
          ] as const
        ).map(([k, l]) => (
          <a key={k || "score"} href={qs({ sort: k })} className={`rounded-lg px-3 py-1.5 ${sort === k ? "bg-indigo-600 text-white" : "border bg-white text-gray-700"}`}>{l}</a>
        ))}
        <span className="mx-2 text-gray-300">|</span>
        <a href={qs({ all: showAll ? "" : "1" })} className={`rounded-lg px-3 py-1.5 ${showAll ? "bg-gray-800 text-white" : "border bg-white text-gray-700"}`}>
          {showAll ? "미검증 키워드 숨기기" : `미검증 키워드 포함 보기${hidden ? ` (${hidden}개 숨김)` : ""}`}
        </a>
      </div>

      {topics.length === 0 ? (
        <Empty>
          {running ? "주제를 발굴하고 있어요…" : hidden ? `실제 검색 여부를 확인하지 못한 미검증 주제 ${hidden}개가 숨겨져 있어요. API 지연·실패로 검증을 놓친 후보도 [미검증 키워드 포함 보기]에서 직접 볼 수 있어요.` : "주제가 없습니다. ① 실시간 트렌드에서 메인 키워드를 수집하거나 ② 검색어 기반에 키워드를 넣어 보세요."}
        </Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>우선순위</th>
                <th>주제 · 키워드</th>
                <th>검색량/문서수</th>
                <th>경쟁</th>
                <th>수익성</th>
                <th>트렌드</th>
                <th>플랫폼</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => {
                const ch = t.origin === "channels" ? (t.signals as unknown as ChannelTopicSignals | null) : null;
                const ex = !ch ? ((t.signals ?? {}) as ExpandSignals) : null;
                const seed = ch?.stage === "seed";
                // 저장된 값 대신 다시 계산 — 예전에 바닥값("< 10")으로 나눠 저장된 큰 비율을 보여 주지 않도록
                const ratio = docRatio(t.documentCount, t.searchVolume);
                return (
                <tr key={t.id}>
                  <td>
                    <span className="rounded-md bg-indigo-50 px-2 py-1 text-sm font-bold text-indigo-700">{Math.round(t.totalScore)}</span>
                    {ch ? (
                      <div className="mt-1 text-[10px] text-gray-400" title="실시간 채널 교차검증 점수 (0~100, 수익 예측 아님)">📡 채널 {ch.metrics?.channels.length ?? 0}개</div>
                    ) : (
                      <div className="mt-1 text-[10px] text-gray-400" title="검색량·경쟁·트렌드 중 실제 데이터로 확인된 지표 수">확인 {t.confidence}/3</div>
                    )}
                  </td>
                  <td className="max-w-md">
                    <div className="font-medium">{t.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                      {ch ? (
                        // 검색량 검증 배지(공식데이터·자동완성 확인)는 채널 소재에 맞지 않아 교차확인 여부로 표시
                        <span className={`badge ${t.verification === "VERIFIED" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}>
                          {t.verification === "VERIFIED" ? "채널 교차확인" : "단일 채널"}
                        </span>
                      ) : (
                        <Badge map={VERIFICATION} value={t.verification} />
                      )}
                      {ex?.isMain && <span className="badge bg-lime-50 text-lime-800" title="입력한 시드 = 메인 키워드. 검색량이 적어도 항상 표시해요">🌱 메인 키워드</span>}
                      {ex?.isMain && (t.searchVolume == null || t.searchVolume < MIN_MONTHLY_SEARCH) && (
                        <span className="badge bg-red-50 text-red-700" title={`월검색량 ${MIN_MONTHLY_SEARCH}회 미만 — 같은 메인 키워드의 롱테일 중 수요가 있는 표현을 고르는 게 좋아요`}>검색량 적음</span>
                      )}
                      {ex?.mainKeyword && !ex.isMain && <span className="badge bg-gray-100 text-gray-600" title="이 롱테일이 구체화한 메인 키워드 — 원고 전체가 이 주제로 쓰여요">메인: {ex.mainKeyword}</span>}
                      {seed && <span className="badge bg-lime-50 text-lime-800" title="실시간 발굴은 6시간 이내 화제 사건의 메인 키워드만 찾아요 — 골라서 [원고 생성]하면 이 키워드가 제목 맨 앞, 사건 요약이 글의 관점이 돼요">🌱 메인 키워드</span>}
                      {t.category && <span className="badge bg-amber-50 text-amber-800">{t.category}</span>}
                      {ex?.seasonality && (
                        <span className={`badge ${SEASONALITY_BADGE[ex.seasonality].cls}`} title={SEASONALITY_BADGE[ex.seasonality].tip}>
                          {SEASONALITY_BADGE[ex.seasonality].label}
                        </span>
                      )}
                      {ex?.answerType && (
                        <span
                          className={`badge ${(ex.aiResistance ?? 0) >= 70 ? "bg-emerald-50 text-emerald-700" : (ex.aiResistance ?? 0) < 40 ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-600"}`}
                          title="AI 내성 — AI 브리핑·AI 개요가 대신 답하기 어려울수록 높아요(블로그 클릭이 남음). 정의·요약형은 AI 가 답하고 끝나기 쉬워요"
                        >
                          {ANSWER_TYPE_LABEL[ex.answerType]} · AI 내성 {ex.aiResistance}
                        </span>
                      )}
                      {[<b key="k">{t.keyword}</b>, t.tool || null, INTENT_LABEL[t.intent as Intent] ?? t.intent]
                        .filter(Boolean)
                        .flatMap((x, i) => (i ? [" · ", x] : [x]))}
                    </div>
                    {t.angle && <div className="mt-1 text-xs text-gray-600">{seed ? "무슨 일" : "관점"}: {t.angle}</div>}
                    {ex && <TitleOptions topicId={t.id} keyword={t.keyword} origin={t.origin} intent={t.intent} current={t.title} sig={ex} used={t.status === "USED"} />}
                    {!ch && t.rationale && <div className="mt-1 text-xs text-gray-600">📊 {t.rationale}</div>}
                    {ch && <div className="mt-2"><ChannelEvidence s={ch} /></div>}
                  </td>
                  <td className="whitespace-nowrap text-xs tabular-nums">
                    <span className="whitespace-nowrap">월 {t.searchVolume != null ? (isFloorVolume(t.searchVolume) ? "10 미만" : formatNumber(t.searchVolume)) : <span className="text-gray-400">미확인</span>}</span>
                    <br />
                    <span className="whitespace-nowrap">문서 {t.documentCount != null ? formatNumber(t.documentCount) : <span className="text-gray-400">미확인</span>}</span>
                    <br />
                    <span className="whitespace-nowrap" title="문서수 ÷ 월검색량 — 낮을수록(0.xx) 경쟁이 덜해 상위 노출에 유리">
                      비율 {ratio != null ? <b className={ratio < 1 ? "text-emerald-700" : ratio < 10 ? "text-amber-700" : "text-red-700"}>{fmtRatio(ratio)}</b> : isFloorVolume(t.searchVolume) ? <span className="text-red-600" title="네이버 검색광고가 월 10회 미만으로만 알려 줌 — 비율 계산 불가">검색량 부족</span> : <span className="text-gray-400">미확인</span>}
                    </span>
                  </td>
                  <td><ScoreBar value={t.competitionScore} /></td>
                  <td><ScoreBar value={t.monetizationScore} /></td>
                  <td><ScoreBar value={t.trendScore} /></td>
                  <td><Badge map={PLATFORM} value={t.targetPlatform} /></td>
                  <td className="min-w-48">
                    <div className="flex flex-col items-start gap-2">
                      {t.status !== "USED" && <GenerateFromTopic topicId={t.id} accounts={accounts} defaultPlatform={t.targetPlatform} defaultFormat={t.origin === "channels" ? "HOMEFEED" : "SEARCH"} />}
                      {t.status === "NEW" && <ActionButton url={`/api/topics/${t.id}`} method="PATCH" body={{ status: "DISMISSED" }} label="보류" className="btn-secondary text-xs" />}
                      {t.status === "DISMISSED" && <ActionButton url={`/api/topics/${t.id}`} method="PATCH" body={{ status: "NEW" }} label="복원" className="btn-secondary text-xs" />}
                      {t.status !== "USED" && <ActionButton url={`/api/topics/${t.id}`} method="DELETE" label="삭제" className="btn-danger text-xs" confirm="이 주제를 삭제할까요? 되돌릴 수 없습니다." />}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">
        ⚠️ 우선순위 점수는 <b>무엇부터 쓸지 정하는 내부 정렬 지표</b>이며 수익·트래픽 예측이 아닙니다. 공식 데이터로 확인하지 못한 지표는 &quot;미확인&quot;으로 두고 점수에서 제외합니다.
        <br />
        경쟁: 문서수÷검색량(포화도)이 낮을수록 높음 · 수익화: 광고경쟁도(있을 때)·검색의도·제휴상품 연관성 · 트렌드: 데이터랩 최근 4주 추이.
        <br />
        검색량·경쟁·트렌드는 모두 네이버 검색광고·데이터랩 데이터입니다. 블로거(구글) 대상으로 분류된 주제도 구글 자체 검색량 데이터는 없고, 이 네이버 데이터에 다른 가중치를 적용해 추정한 것입니다.
        <br />
        📡 실시간 트렌드는 6시간 이내 화제인 사건의 <b>메인 키워드만</b> 찾습니다. <b>우선순위 번호</b>는 참여 채널 수·기사 신선도·네이버 랭킹·조회수·구글 트렌드 급등률 등 수집한 값만으로 계산한 화제성 지표(0~100)이고, 검색량·문서수·비율은 메인 키워드의 네이버 실측값입니다(막 터진 이슈라 아직 데이터가 없으면 미확인). 골라서 [원고 생성]하면 메인 키워드가 제목 맨 앞, 사건 요약이 글의 관점이 됩니다.
        <br />
        🔎 검색어 기반은 입력한 키워드를 줄여 가며(신한은행 유출 → 신한은행) 자동완성·&quot;함께 많이 찾는&quot;·검색광고 연관어를 모으고, 롱테일은 반드시 메인 키워드(입력한 시드 전체 또는 2단어 이상 핵심, 예: ai 해킹 공격 → ai 해킹)를 포함해야 하고, 월검색량 {MIN_MONTHLY_SEARCH}회 미만은 빼고(메인 키워드 자체는 항상 표시), 같은 주제이면서 블로그 글로 답할 수 있는 검색어인지 AI 로 확인(커뮤니티·사이트 이름 검색 제외)한 뒤 롱테일 키워드만 저장합니다. 조건을 통과한 키워드가 적으면 개수를 억지로 채우지 않습니다. 고른 키워드에서 [제목 6가지 만들기]를 누르면 그때 네이버 상위 노출 글 제목·AI 브리핑을 벤치마킹해 키워드를 맨 왼쪽에 둔 6가지 유형 제목(궁금증·행동·정보·주의·비교·조합)을 만듭니다. 제목을 바꿔도 검색량·문서수는 키워드 기준이라 그대로입니다.
        <br />
        비율 = 문서수 ÷ 월검색량 (키워드마스터와 같은 계산). 낮을수록(0.xx) 경쟁이 덜해 노출에 유리하지만 노출을 보장하지는 않습니다. 네이버가 월 10회 미만으로만 알려 주는 키워드는 비율을 계산하지 않고 &quot;검색량 부족&quot;으로 표시합니다.
        <br />
        🎯 검색어 기반은 &quot;ai·클로드&quot;처럼 문서가 과포화된 짧은 헤드 키워드 대신, 자동완성·&quot;함께 많이 찾는&quot;에서 모은 실제 검색 문구 중 검색량이 확인된 <b>롱테일</b>을 제목 맨 앞 키워드로 쓰고, 함께 검색되는 문구는 원고 소제목·FAQ에 반영합니다.
        <br />
        🗑 보류 상태로 7일 지난 주제는 매일 새벽 자동으로 삭제됩니다(복원하면 대상에서 빠집니다). 삭제 버튼으로 즉시 지울 수도 있습니다.
      </p>
    </div>
  );
}
