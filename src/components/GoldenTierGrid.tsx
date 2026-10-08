import Link from "next/link";
import { TIERS } from "@/lib/topics/golden";

/**
 * 황금키워드 구간 카드 (대시보드·주제 발굴 공용) — 카드마다 아이콘·이름·검색량 구간·수집 키워드 수.
 * 링크는 부르는 쪽이 정함: 대시보드는 주제 발굴로 이동, 주제 발굴은 같은 화면에서 펼치기/접기.
 */
export function GoldenTierGrid({ counts, hrefFor, active, guideHref = "/guide#golden" }: { counts: Record<string, number>; hrefFor: (tier: string) => string; active?: string; guideHref?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {TIERS.map((t) => {
        const on = active === t.id;
        return (
          <Link
            key={t.id}
            href={hrefFor(t.id)}
            scroll={false}
            className={`rounded-2xl border bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-md ${on ? "border-indigo-500 ring-2 ring-indigo-200" : "border-gray-200"}`}
            title={t.desc}
          >
            <div className="flex items-start justify-between">
              <span className="text-2xl">{t.emoji}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{t.band}</span>
            </div>
            <div className="mt-2 text-sm font-semibold text-gray-700">
              {t.emoji} {t.name}
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-2xl font-extrabold tracking-tight">{(counts[t.id] ?? 0).toLocaleString("ko-KR")}</span>
              <span className="text-xs text-gray-400">키워드</span>
            </div>
          </Link>
        );
      })}
      <Link href={guideHref} className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 transition hover:shadow-md">
        <div className="flex items-start justify-between">
          <span className="text-2xl">💡</span>
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">GUIDE</span>
        </div>
        <div className="mt-2 text-sm font-semibold text-indigo-700">사용 가이드</div>
        <div className="mt-1 text-xs text-indigo-500">구간·비율 보는 법 →</div>
      </Link>
    </div>
  );
}
