import { LIFESPAN_LABEL, type Lifespan, type TimeForm, type TitleCheck } from "@/lib/topics/titleRules";

const MARK = (pass: boolean | null) => (pass === true ? "✔" : pass === false ? "✖" : "–");
const CLS = (pass: boolean | null) => (pass === true ? "text-emerald-700" : pass === false ? "text-red-600" : "text-gray-400");

/** 제목 체크리스트 4 + 보조 점검 (규칙 판정, Claude 토큰 안 씀) */
export function TitleChecklist({
  checks,
  lifespan,
  timeForms,
  compact,
}: {
  checks: TitleCheck[];
  lifespan?: Lifespan;
  timeForms?: TimeForm[] | null;
  /** 제목 후보 목록용 — ✖ 항목만 한 줄로 */
  compact?: boolean;
}) {
  if (compact) {
    const failed = checks.filter((c) => c.pass === false);
    if (!failed.length) return <span className="text-[11px] text-emerald-700">✔ 제목 점검 통과</span>;
    return <span className="text-[11px] text-red-600">✖ {failed.map((c) => `${c.label}: ${c.note}`).join(" · ")}</span>;
  }
  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {lifespan && <span className="badge bg-gray-100 text-gray-700">{LIFESPAN_LABEL[lifespan]}</span>}
        {timeForms && timeForms.length > 0 ? (
          <span className="text-gray-500">
            검색되는 시간 표현: {timeForms.map((f) => `${f.form}(월 ${f.volume.toLocaleString("ko-KR")})`).join(", ")}
          </span>
        ) : timeForms ? (
          <span className="text-gray-500">연도·회차를 붙여 검색하는 형태 없음 → 제목에 날짜 없이</span>
        ) : null}
      </div>
      <ul className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {checks.map((c) => (
          <li key={c.id} className={CLS(c.pass)}>
            {MARK(c.pass)} {c.label} <span className="text-gray-500">— {c.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
