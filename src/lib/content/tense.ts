import { manuscriptText } from "./render";
import type { Manuscript } from "./types";

/**
 * 시제 모순 감지 — "이미 벌어진 일을 미래형으로 서술"하는 오류를 발행 전에 잡는 마지막 방어선.
 * 1) 미래·미출시 표현 문장에 이미 지난 날짜가 들어 있으면 충돌
 * 2) 조사 메모(원고 작성 시 웹 검색 결과)에 "출시됐다/발표했다"로 나온 대상을 본문이 "출시 예정"으로 쓰면 충돌
 * 판단은 사람 몫이므로 차단하지 않고, 문장과 근거를 보여줍니다.
 */
export const FUTURE_RE =
  /(출시\s?예정|공개\s?예정|도입\s?예정|시행\s?예정|적용\s?예정|오픈\s?예정|업데이트\s?예정|예정입니다|예정이에요|예정이다|출시\s?전|출시될|공개될|도입될|시행될|곧\s?출시|출시를\s?앞둔|나올\s?예정|아직\s?(출시|공개)되지)/;

export const PAST_RE =
  /(출시했|출시됐|출시되었|출시된|정식\s?출시|공개했|공개됐|공개되었|공개된|발표했|발표됐|발표되었|시행됐|시행되었|시행 중|도입됐|도입되었|적용됐|적용되었|released|launched|rolled out|now available|became available|is available)/i;

/** 버전·모델명처럼 구체적인 대상만 비교 (단어 하나짜리 일반명사로 인한 오탐 방지) */
// "Gemini 3 Pro", "Claude Opus 5", "GPT-5", "제미나이 3" — 영문 단어와 버전 숫자가 번갈아 나오는 이름 전체를 하나로
const ENTITY_RE = /[A-Za-z][A-Za-z0-9+.-]*(?:\s(?:[A-Za-z][A-Za-z0-9+.-]*|\d+(?:\.\d+)?[A-Za-z]*))*|[가-힣]{2,}\s?\d+(?:\.\d+)?/g;
const GENERIC = new Set(["ai", "pc", "pdf", "url", "faq", "api", "app", "pro", "plus", "free", "beta"]);

export type TenseConflict = { sentence: string; reason: string; evidence?: string };

export function splitSentences(text: string): string[] {
  return text
    .replace(/[*#>]/g, "")
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
}

/** 문장 안의 날짜 표현이 가리키는 기간의 "끝" (그 이후라면 이미 지난 일) */
export function periodEnds(sentence: string): { label: string; end: Date }[] {
  const out: { label: string; end: Date }[] = [];
  const endOfMonth = (y: number, m: number) => new Date(y, m, 0, 23, 59, 59);
  for (const m of sentence.matchAll(/(20\d{2})[-.](\d{1,2})[-.](\d{1,2})/g)) {
    out.push({ label: m[0], end: new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59) });
  }
  for (const m of sentence.matchAll(/(20\d{2})년\s?(\d{1,2})월(?:\s?(\d{1,2})일)?/g)) {
    out.push({ label: m[0], end: m[3] ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59) : endOfMonth(+m[1], +m[2]) });
  }
  for (const m of sentence.matchAll(/(20\d{2})년\s?(상반기|하반기|초|말|1분기|2분기|3분기|4분기)/g)) {
    const y = +m[1];
    const month = { 상반기: 6, 하반기: 12, 초: 3, 말: 12, "1분기": 3, "2분기": 6, "3분기": 9, "4분기": 12 }[m[2]] ?? 12;
    out.push({ label: m[0], end: endOfMonth(y, month) });
  }
  // 연도만 있는 경우 ("2025년 출시 예정") — 월 표현이 없을 때만
  if (!out.length) {
    for (const m of sentence.matchAll(/(20\d{2})년(?!\s?\d{1,2}월)/g)) out.push({ label: m[0], end: new Date(+m[1], 11, 31, 23, 59, 59) });
  }
  return out;
}

export function entities(sentence: string): string[] {
  return [...new Set((sentence.match(ENTITY_RE) ?? []).map((e) => e.trim()))].filter((e) => {
    const lower = e.toLowerCase();
    if (GENERIC.has(lower)) return false;
    return /\d/.test(e) || e.includes(" "); // 버전 번호가 있거나 두 단어 이상인 고유명사만
  });
}

export function findTenseConflicts(m: Manuscript, ctx: { today: Date | string; researchNotes?: string | null }): TenseConflict[] {
  const today = typeof ctx.today === "string" ? new Date(`${ctx.today}T00:00:00`) : ctx.today;
  const futureSentences = splitSentences(manuscriptText(m)).filter((s) => FUTURE_RE.test(s));
  const pastFacts = splitSentences(ctx.researchNotes ?? "").filter((s) => PAST_RE.test(s));
  const conflicts: TenseConflict[] = [];

  for (const sentence of futureSentences) {
    const passed = periodEnds(sentence).find((p) => p.end < today);
    if (passed) {
      conflicts.push({ sentence, reason: `"${passed.label}"은(는) 이미 지난 시점인데 미래형(예정)으로 썼어요.` });
      continue;
    }
    for (const entity of entities(sentence)) {
      const fact = pastFacts.find((f) => f.toLowerCase().includes(entity.toLowerCase()));
      if (fact) {
        conflicts.push({ sentence, reason: `조사 메모에는 "${entity}"이(가) 이미 출시·발표된 것으로 나와 있어요.`, evidence: fact.slice(0, 160) });
        break;
      }
    }
  }
  return conflicts;
}
