import { db } from "@/lib/db";
import { ActionButton } from "@/components/ActionButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ChannelDiscoverForm, DiscoverForm, GenerateFromTopic, ManualPostForm } from "@/components/Forms";
import { DEFAULT_CHANNEL_CONFIG } from "@/lib/topics/channels/config";
import type { ChannelTopicSignals } from "@/lib/topics/channels/discover";
import { CHANNEL_LABEL } from "@/lib/topics/channels/scoring";
import { fmtAgo } from "@/lib/topics/channels/text";
import { Badge, Empty, PageHeader, PERSONA_LABEL, PLATFORM, ScoreBar, VERIFICATION } from "@/components/ui";
import { RelatedKeywords } from "@/components/RelatedKeywords";
import { INTENT_LABEL, type Intent } from "@/lib/topics/scoring";
import { formatNumber } from "@/lib/util";

export const dynamic = "force-dynamic";

const ORIGINS = [
  ["", "전체"],
  ["autocomplete", "🔎 검색어 기반"],
  ["channels", "📡 실시간 트렌드"],
] as const;

function ChannelEvidence({ s }: { s: ChannelTopicSignals }) {
  const m = s.metrics;
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        {(m?.channels ?? []).map((c) => (
          <span key={c} className="badge bg-sky-50 text-sky-700">{CHANNEL_LABEL[c] ?? c}</span>
        ))}
        {(m?.trendPct ?? 0) >= DEFAULT_CHANNEL_CONFIG.googleTrends.instantPct && <span className="badge bg-red-50 text-red-700">🔥 즉시 소재</span>}
        {s.preempt && <span className="badge bg-violet-50 text-violet-700" title="네이트·트렌드·다음에는 있는데 네이버 랭킹·홈판에는 아직 없음 (발행 전 네이버 검색으로 한 번 더 확인)">🚀 선점 후보</span>}
      </div>
      <ul className="list-disc pl-4 text-gray-600">
        {s.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer text-gray-500">수집 근거 {s.evidence.length}건</summary>
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
        {s.ai?.outline?.length ? <p className="mt-1 text-gray-500">AI 구성안: {s.ai.outline.join(" → ")}</p> : null}
        {s.ai?.caution ? <p className="text-gray-500">주의: {s.ai.caution}</p> : null}
        <p className="mt-1 text-gray-400">수집 {new Date(s.collectedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
      </details>
    </div>
  );
}

export default async function TopicsPage({ searchParams }: { searchParams: Promise<{ status?: string; all?: string; origin?: string }> }) {
  const sp = await searchParams;
  const status = sp.status ?? "NEW";
  const showAll = sp.all === "1";
  const origin = sp.origin === "channels" || sp.origin === "autocomplete" ? sp.origin : "";
  const qs = (o: Record<string, string>) => {
    const p = new URLSearchParams({ status, ...(showAll ? { all: "1" } : {}), ...(origin ? { origin } : {}), ...o });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    return `/topics?${p}`;
  };
  const verificationFilter = { ...(showAll ? {} : { verification: { not: "UNVERIFIED" } }), ...(origin ? { origin } : {}) };
  const sources = (
    await db.post.findMany({
      where: { status: { in: ["DRAFT", "PRIVATE", "APPROVED", "PUBLISHED"] } },
      select: { id: true, title: true, platform: true, account: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    })
  ).map((p) => ({ id: p.id, title: p.title, platform: p.platform, account: p.account?.name ?? "-" }));
  const [topics, hidden, accounts, running] = await Promise.all([
    db.topic.findMany({ where: { status, ...verificationFilter }, orderBy: [{ confidence: "desc" }, { totalScore: "desc" }], take: 100 }),
    showAll ? Promise.resolve(0) : db.topic.count({ where: { status, verification: "UNVERIFIED", ...(origin ? { origin } : {}) } }),
    db.account.findMany({ where: { active: true, platform: { in: ["BLOGGER", "NAVER"] } }, select: { id: true, name: true, platform: true } }),
    db.job.count({ where: { type: { in: ["topic.discover", "topic.channels"] }, status: { in: ["QUEUED", "RUNNING"] } } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="주제 발굴"
        desc="두 가지 방식: ① 검색어 기반 — 자동완성 후보를 네이버 검색광고·블로그 문서수·데이터랩 같은 공식 데이터로 검증 ② 실시간 트렌드 — 네이버 홈판·랭킹·네이트·구글 트렌드·다음·구글 뉴스에서 지금 화제인 소재를 교차검증."
        actions={<AutoRefresh active={running > 0} />}
      />
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-700">🔎 검색어 기반 발굴 <span className="font-normal text-gray-400">— 꾸준히 검색되는 키워드 (정보성·에버그린)</span></h2>
        <DiscoverForm />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-700">📡 실시간 트렌드 발굴 <span className="font-normal text-gray-400">— 오늘 여러 채널에서 동시에 화제인 소재 (이슈·홈판 노출용)</span></h2>
        <ChannelDiscoverForm />
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
        <a href={qs({ all: showAll ? "" : "1" })} className={`rounded-lg px-3 py-1.5 ${showAll ? "bg-gray-800 text-white" : "border bg-white text-gray-700"}`}>
          {showAll ? "미검증 키워드 숨기기" : `미검증 키워드 포함 보기${hidden ? ` (${hidden}개 숨김)` : ""}`}
        </a>
      </div>

      {topics.length === 0 ? (
        <Empty>
          {running ? "주제를 발굴하고 있어요…" : hidden ? `실제 검색 여부를 확인하지 못한 미검증 주제 ${hidden}개가 숨겨져 있어요. API 지연·실패로 검증을 놓친 후보도 [미검증 키워드 포함 보기]에서 직접 볼 수 있어요.` : "주제가 없습니다. 위에서 [주제 발굴]을 눌러 보세요."}
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
                      {t.category && <span className="badge bg-amber-50 text-amber-800">{t.category}</span>}
                      {[<b key="k">{t.keyword}</b>, t.tool || null, PERSONA_LABEL[t.persona] ?? t.persona, INTENT_LABEL[t.intent as Intent] ?? t.intent]
                        .filter(Boolean)
                        .flatMap((x, i) => (i ? [" · ", x] : [x]))}
                    </div>
                    {t.angle && <div className="mt-1 text-xs text-gray-600">관점: {t.angle}</div>}
                    {!ch && t.rationale && <div className="mt-1 text-xs text-gray-600">📊 {t.rationale}</div>}
                    {ch && t.searchVolume != null && (
                      <div className="mt-1 text-xs text-gray-600">
                        🔎 롱테일 네이버 월 검색 {formatNumber(t.searchVolume)}
                        {t.documentCount != null ? ` · 문서 ${formatNumber(t.documentCount)}` : ""}
                        {t.competitionScore != null ? ` · 경쟁점수 ${Math.round(t.competitionScore)}` : ""}
                      </div>
                    )}
                  </td>
                  {ch ? (
                    <td colSpan={4} className="max-w-lg">
                      <ChannelEvidence s={ch} />
                    </td>
                  ) : (
                    <>
                      <td className="whitespace-nowrap text-xs tabular-nums">
                        <span className="whitespace-nowrap">월 {t.searchVolume != null ? formatNumber(t.searchVolume) : <span className="text-gray-400">미확인</span>}</span>
                        <br />
                        <span className="whitespace-nowrap">문서 {t.documentCount != null ? formatNumber(t.documentCount) : <span className="text-gray-400">미확인</span>}</span>
                      </td>
                      <td><ScoreBar value={t.competitionScore} /></td>
                      <td><ScoreBar value={t.monetizationScore} /></td>
                      <td><ScoreBar value={t.trendScore} /></td>
                    </>
                  )}
                  <td><Badge map={PLATFORM} value={t.targetPlatform} /></td>
                  <td className="min-w-48">
                    <div className="flex flex-col items-start gap-2">
                      {t.status !== "USED" && <GenerateFromTopic topicId={t.id} accounts={accounts} defaultPlatform={t.targetPlatform} />}
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
      <div className="grid gap-6 lg:grid-cols-2">
        <ManualPostForm accounts={accounts} sources={sources} />
        <RelatedKeywords />
      </div>
      <p className="text-xs text-gray-500">
        ⚠️ 우선순위 점수는 <b>무엇부터 쓸지 정하는 내부 정렬 지표</b>이며 수익·트래픽 예측이 아닙니다. 공식 데이터로 확인하지 못한 지표는 &quot;미확인&quot;으로 두고 점수에서 제외합니다.
        <br />
        경쟁: 문서수÷검색량(포화도)이 낮을수록 높음 · 수익화: 광고경쟁도(있을 때)·검색의도·제휴상품 연관성 · 트렌드: 데이터랩 최근 4주 추이.
        <br />
        검색량·경쟁·트렌드는 모두 네이버 검색광고·데이터랩 데이터입니다. 블로거(구글) 대상으로 분류된 주제도 구글 자체 검색량 데이터는 없고, 이 네이버 데이터에 다른 가중치를 적용해 추정한 것입니다.
        <br />
        📡 실시간 트렌드 점수(0~100)는 참여 채널 수·기사 신선도·네이버 랭킹·조회수·구글 트렌드 급등률 등 <b>수집한 값만</b>으로 계산한 화제성 지표이며, 수익 예측이 아닙니다. 소재의 대표어를 롱테일로 확장해 네이버에 검색량이 잡힌 문구가 있으면 그 수치를 붙이고, 막 터진 이슈라 아직 데이터가 없으면 미확인으로 둡니다.
        <br />
        🎯 세 가지 방식 모두 &quot;ai·클로드&quot;처럼 문서가 과포화된 짧은 헤드 키워드 대신, 자동완성·&quot;함께 많이 찾는&quot;에서 모은 실제 검색 문구 중 검색량이 확인된 <b>롱테일</b>을 제목 맨 앞 키워드로 쓰고, 함께 검색되는 문구는 원고 소제목·FAQ에 반영합니다.
        <br />
        🗑 보류 상태로 7일 지난 주제는 매일 새벽 자동으로 삭제됩니다(복원하면 대상에서 빠집니다). 삭제 버튼으로 즉시 지울 수도 있습니다.
      </p>
    </div>
  );
}
