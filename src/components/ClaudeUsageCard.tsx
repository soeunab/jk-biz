import { ActionButton } from "@/components/ActionButton";
import { USAGE_WINDOW_LABEL, usagePercent, type ClaudeUsage } from "@/lib/llm/usage";

/** 사용률 원형 표시 — 50% 미만 초록, 80% 미만 주황, 그 이상 빨강 */
function Ring({ percent }: { percent: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const color = percent >= 80 ? "stroke-red-500" : percent >= 50 ? "stroke-amber-500" : "stroke-emerald-500";
  return (
    <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90" aria-hidden="true">
      <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" className="stroke-gray-100" />
      <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" strokeLinecap="round" className={color} strokeDasharray={`${(c * percent) / 100} ${c}`} />
    </svg>
  );
}

function resetLabel(resetsAt: number | null, now: number) {
  if (!resetsAt) return "";
  const ms = resetsAt * 1000 - now;
  if (ms <= 0) return "재설정됨";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const when = new Date(resetsAt * 1000).toLocaleString("ko-KR", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
  const left = h >= 24 ? `${Math.floor(h / 24)}일 ${h % 24}시간` : h > 0 ? `${h}시간 ${m}분` : `${m}분`;
  return `${left} 후 재설정 (${when})`;
}

function agoLabel(at: string, now: number) {
  const min = Math.floor((now - new Date(at).getTime()) / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  if (min < 1440) return `${Math.floor(min / 60)}시간 전`;
  return `${Math.floor(min / 1440)}일 전`;
}

export function ClaudeUsageCard({ usage }: { usage: ClaudeUsage | null }) {
  const now = Date.now();
  // 알려진 창(현재 세션 → 이번 주 …) 순서로, 모르는 창은 뒤에
  const order = Object.keys(USAGE_WINDOW_LABEL);
  const windows = Object.entries(usage?.windows ?? {}).sort(
    ([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
  );
  return (
    <div className="card mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Claude 구독 사용량</h2>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {usage && <span>{agoLabel(usage.at, now)} 기준</span>}
          <ActionButton url="/api/claude-usage" label="🔄 새로고침" className="btn-secondary !px-2 !py-1 text-xs" />
        </div>
      </div>
      {windows.length === 0 ? (
        <p className="text-sm text-gray-500">아직 기록이 없어요. [새로고침]을 누르거나 원고 생성 같은 Claude 작업이 한 번 돌면 표시돼요.</p>
      ) : (
        <div className="flex flex-wrap gap-6">
          {windows.map(([key, w]) => {
            const pct = usagePercent(w, now);
            return (
              <div key={key} className="flex items-center gap-3">
                <div className="relative">
                  <Ring percent={pct} />
                  <span className="absolute inset-0 flex items-center justify-center text-lg font-bold">{pct}%</span>
                </div>
                <div>
                  <div className="text-sm font-semibold">{USAGE_WINDOW_LABEL[key] ?? key}</div>
                  <div className="text-xs text-gray-500">{resetLabel(w.resetsAt, now)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-xs text-gray-400">
        Claude Code 가 알려 주는 값이에요(데스크탑·Claude Code 공용 한도). 새로고침은 아주 짧은 요청 1회로 한도를 조금 써요.
      </p>
    </div>
  );
}
