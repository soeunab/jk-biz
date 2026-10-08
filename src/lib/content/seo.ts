import { charCount } from "../util";
import { manuscriptText } from "./render";
import { detectRisk, hasInvestDisclaimer, manuscriptRiskText, PREDICTIVE_RE, tradeAdviceFaqs } from "./risk";
import { findTenseConflicts } from "./tense";
import { PLACEHOLDER_RE, type Manuscript, type Platform } from "./types";

export type SeoGroup = "SEO" | "AEO" | "GEO" | "사실·정책" | "수익화" | "참고";

export type SeoCheck = {
  id: string;
  group: SeoGroup;
  label: string;
  pass: boolean;
  weight: number;
  detail: string;
};

export type SeoReport = { score: number; checks: SeoCheck[]; stats: Record<string, number> };

/**
 * "참고" 그룹 기준값은 플랫폼이 공식적으로 밝힌 규칙이 아니라 독자 경험 관점의 참고치입니다.
 * 점수에 거의 영향을 주지 않으며(가중치 1), 기준을 벗어나도 "독자에게 충분한가"만 확인하면 됩니다.
 */
const REFERENCE = {
  NAVER: { chars: 1500, images: 4, tags: [5, 10] },
  BLOGGER: { chars: 2000, images: 2, tags: [2, 6] },
} as const;

/** 본문에 의존하는 표현 — 문장만 떼어 인용(AI 답변·스니펫)되면 뜻이 통하지 않음 */
export const DEPENDENT_RE = /(위에서|앞서|앞에서|아래에서|이 글에서|본문에서|위와 같이|아래와 같이|다음과 같이|상기한|전술한)/;

/** 섹션 첫 문장이 답 대신 예고·뜸들이기로 시작하는 표현 — 결론 먼저(AI 브리핑·스니펫 인용) 원칙 위반 */
export const LEADIN_RE = /(알아보겠|알아볼게|알아봅시다|알아볼까|살펴보겠|살펴볼게|살펴볼까|살펴봅시다|소개하겠|소개해 드릴|소개할게|정리해 보겠|정리해 볼게|궁금하시죠|궁금하셨|시작해 볼까|시작하겠)/;

/** 결론 먼저가 아닌 섹션 번호(1부터) — 첫 문장이 예고·뜸들이기이거나 본문 의존 표현 */
export function notAnswerFirst(m: Pick<Manuscript, "sections">): number[] {
  return m.sections
    .map((s, i) => {
      const first = firstSentence(s.body.replace(/^[\s>*#-]+/, "").trim());
      return first && (LEADIN_RE.test(first) || DEPENDENT_RE.test(first)) ? i + 1 : 0;
    })
    .filter(Boolean);
}

/** 남은 경험 자리표시 수 — 제목·요약·소제목·FAQ 질문·표·CTA 까지 원고 전체(사람용 확인 목록 제외)에서 셉니다 */
export function countPlaceholders(m: Manuscript): number {
  return (JSON.stringify({ ...m, reviewChecklist: [] }).match(PLACEHOLDER_RE) ?? []).length;
}

function firstSentence(s: string) {
  return s.split(/(?<=[.!?。요다])\s/)[0] ?? s;
}

function countOccurrences(text: string, needle: string) {
  if (!needle) return 0;
  const n = needle.replace(/\s+/g, "").toLowerCase();
  const t = text.replace(/\s+/g, "").toLowerCase();
  let count = 0;
  let idx = t.indexOf(n);
  while (idx !== -1) {
    count++;
    idx = t.indexOf(n, idx + n.length);
  }
  return count;
}

/**
 * 규칙 기반 SEO/AEO/GEO·사실성 점검. AI 호출 없이 즉시 계산되며, 통과/차단을 대신 결정하지 않고
 * 사람 검수자가 무엇을 고치면 되는지 체크리스트로 보여줍니다.
 */
export function auditManuscript(
  m: Manuscript,
  platform: Platform,
  opts: {
    imageCount: number;
    bannedPhrases?: string[];
    disclosureText?: string;
    /** 실제 발행될 HTML — 고지 문구가 최종 결과물에 들어갔는지 확인 */
    renderedHtml?: string;
    /** 시제 모순 점검용: 기준일(YYYY-MM-DD)과 원고 작성 시 저장한 조사 메모 */
    today?: string;
    researchNotes?: string | null;
    /** 같은 계정의 발행 글 URL — 있으면 내부링크를 1개 이상 넣었는지 확인 */
    internalUrls?: string[];
  } = { imageCount: 0 },
): SeoReport {
  const ref = REFERENCE[platform];
  const text = manuscriptText(m);
  const chars = charCount(text);
  const kw = m.focusKeyword.trim();
  const kwCount = countOccurrences(text, kw);
  const density = chars ? (kwCount * charCount(kw)) / chars : 0;
  const headings = m.sections.length;
  const questionHeadings = m.sections.filter((s) => /[?？]|(방법|하는 법|이유|차이|뭔가요|인가요|할까)/.test(s.heading)).length;
  const imagesWithKeywordAlt = m.sections.filter((s) => s.image && countOccurrences(s.image.alt, kw.split(" ")[0]) > 0).length;
  const totalSlots = m.sections.filter((s) => s.image).length;
  const titleLen = m.title.length;
  const firstIntro = m.intro.split(/[.!?。]\s/).slice(0, 2).join(" ");
  const banned = (opts.bannedPhrases ?? []).filter((b) => text.includes(b));
  const hasPrompt = m.sections.some((s) => /(^|\n)>\s/.test(s.body));
  const placeholders = countPlaceholders(m);
  const risk = detectRisk(manuscriptRiskText(m));
  const predictive = text.match(PREDICTIVE_RE)?.[0];
  const invest = risk?.categories.includes("INVEST") ?? false;
  const tradeFaqs = invest ? tradeAdviceFaqs(m.faq) : [];
  const tense = findTenseConflicts(m, { today: opts.today ?? new Date().toISOString().slice(0, 10), researchNotes: opts.researchNotes });
  // 네이버는 키워드 형태 일치를 중시 → 제목에 키워드가 그대로(띄어쓰기 포함) 있어야 함
  const titleHasKw = platform === "NAVER" ? m.title.toLowerCase().includes(kw.toLowerCase()) : countOccurrences(m.title, kw) > 0;
  const kwPos = m.title.replace(/\s/g, "").toLowerCase().indexOf(kw.replace(/\s/g, "").toLowerCase());
  const dependent = [
    ["직답", m.directAnswer],
    ["메타 설명", m.metaDescription],
    ...m.faq.map((f, i) => [`FAQ ${i + 1}`, f.a]),
  ].filter(([, t]) => DEPENDENT_RE.test(firstSentence(t)));
  const lateAnswers = notAnswerFirst(m);
  const json = JSON.stringify(m);
  const internalUrls = opts.internalUrls ?? [];
  const linkedInternal = internalUrls.filter((u) => json.includes(u)).length;

  const checks: SeoCheck[] = [
    { id: "title-kw", group: "SEO", label: platform === "NAVER" ? "제목에 핵심 키워드를 그대로 포함" : "제목에 핵심 키워드 포함", weight: 10, pass: titleHasKw, detail: `키워드 "${kw}"` },
    { id: "title-front", group: "SEO", label: "키워드를 제목 앞부분에 배치", weight: 4, pass: kwPos >= 0 && kwPos <= Math.max(8, m.title.length * 0.3), detail: "제목의 앞 30% 이내" },
    { id: "intro-kw", group: "SEO", label: "도입부 첫 문장들에 키워드", weight: 6, pass: countOccurrences(firstIntro, kw) > 0 || countOccurrences(m.directAnswer, kw) > 0, detail: "첫 2문장 또는 직답" },
    { id: "headings", group: "SEO", label: "소제목으로 내용 구분 (3개 이상)", weight: 4, pass: headings >= 3, detail: `현재 ${headings}개` },
    { id: "alt", group: "SEO", label: "이미지 대체텍스트에 키워드", weight: 3, pass: totalSlots > 0 && imagesWithKeywordAlt / totalSlots >= 0.5, detail: `${imagesWithKeywordAlt}/${totalSlots}` },
    ...(platform === "BLOGGER"
      ? [
          { id: "meta", group: "SEO" as const, label: "메타 설명에 키워드 포함", weight: 5, pass: m.metaDescription.length >= 50 && countOccurrences(m.metaDescription, kw) > 0, detail: `현재 ${m.metaDescription.length}자` },
          { id: "slug", group: "SEO" as const, label: "영문 permalink", weight: 2, pass: /^[a-z0-9-]{3,80}$/.test(m.slug), detail: m.slug },
        ]
      : []),
    { id: "direct-answer", group: "AEO", label: "상단 직답 (40~300자)", weight: 8, pass: m.directAnswer.length >= 40 && m.directAnswer.length <= 300, detail: `현재 ${m.directAnswer.length}자` },
    {
      id: "self-contained",
      group: "AEO",
      label: "직답·메타설명·FAQ 첫 문장이 단독으로 뜻이 통함",
      weight: 6,
      pass: dependent.length === 0,
      detail: dependent.length ? `본문 의존 표현: ${dependent.map(([n]) => n).join(", ")}` : "인용돼도 완결",
    },
    {
      id: "answer-first",
      group: "AEO",
      label: "섹션마다 첫 문장에서 바로 답 (결론 먼저)",
      weight: 4,
      pass: lateAnswers.length === 0,
      detail: lateAnswers.length ? `${lateAnswers.join(", ")}번 섹션이 예고·뜸들이기로 시작` : "모든 섹션이 답부터 시작",
    },
    ...(internalUrls.length
      ? [{ id: "internal-link", group: "SEO" as const, label: "같은 블로그 관련 글로 내부링크", weight: 3, pass: linkedInternal > 0, detail: linkedInternal ? `${linkedInternal}개 연결` : "관련 글이 있는데 연결 안 됨 — 주제 묶음(클러스터) 형성에 필요" }]
      : []),
    { id: "question-headings", group: "AEO", label: "질문형 소제목 2개 이상", weight: 4, pass: questionHeadings >= 2, detail: `현재 ${questionHeadings}개` },
    { id: "faq", group: "AEO", label: "FAQ 4개 이상", weight: 5, pass: m.faq.length >= 4, detail: `현재 ${m.faq.length}개` },
    { id: "tldr", group: "AEO", label: "핵심 요약 3줄", weight: 3, pass: m.tldr.length >= 3, detail: `현재 ${m.tldr.length}개` },
    { id: "sources", group: "GEO", label: "공식 출처 명시", weight: 5, pass: m.sources.length >= 1, detail: `${m.sources.length}개` },
    { id: "dated", group: "GEO", label: "기준 시점 명시 (YYYY년/기준)", weight: 3, pass: /20\d\d년|기준/.test(text + m.metaDescription), detail: "" },
    { id: "prompt-example", group: "GEO", label: "프롬프트 예시 포함", weight: 2, pass: hasPrompt, detail: "" },
    {
      id: "experience",
      group: "사실·정책",
      label: "경험 자리표시를 실제 경험으로 채움",
      weight: 8,
      pass: placeholders === 0,
      detail: placeholders ? `남은 [경험 추가] ${placeholders}개 — AI는 경험을 지어내지 않아요` : "모두 채움",
    },
    { id: "banned", group: "사실·정책", label: "과장·금지 표현 없음", weight: 5, pass: banned.length === 0, detail: banned.join(", ") || "없음" },
    {
      id: "tense",
      group: "사실·정책",
      label: "이미 벌어진 일을 미래형으로 쓰지 않음",
      weight: 6,
      pass: tense.length === 0,
      detail: tense.length ? `${tense.length}건 — ${tense[0].reason} “${tense[0].sentence.slice(0, 40)}…”` : opts.researchNotes ? "지난 날짜·조사 메모와 충돌 없음" : "지난 날짜와 충돌 없음 (조사 메모 없음)",
    },
    ...(risk
      ? [
          { id: "risk-sources", group: "사실·정책" as const, label: `고위험 주제(${risk.labels.join("·")}) 공식 출처`, weight: 8, pass: m.sources.length >= 1, detail: `${m.sources.length}개 — 금액·요건·기한 주장마다 출처 필요` },
          { id: "risk-predictive", group: "사실·정책" as const, label: "예측·보장 표현 없음", weight: 6, pass: !predictive, detail: predictive ? `"${predictive}"` : "없음" },
        ]
      : []),
    ...(invest
      ? [
          {
            id: "invest-disclaimer",
            group: "사실·정책" as const,
            label: "투자 권유 아님·책임 고지 문구가 실제로 포함",
            weight: 8,
            pass: hasInvestDisclaimer(opts.renderedHtml ?? text),
            detail: opts.renderedHtml ? "발행될 HTML 기준 확인" : "원고 본문 기준 확인",
          },
          {
            id: "invest-faq",
            group: "사실·정책" as const,
            label: "FAQ 에서 매수·매도를 대신 판단하지 않음",
            weight: 6,
            pass: tradeFaqs.length === 0,
            detail: tradeFaqs.length ? `"${tradeFaqs[0].q}" — 사실과 지켜볼 지표만 답하세요` : "없음",
          },
        ]
      : []),
    ...(m.affiliate.length
      ? [{ id: "disclosure", group: "수익화" as const, label: "제휴 대가성 문구 표기", weight: 6, pass: !!opts.disclosureText?.trim(), detail: opts.disclosureText?.trim() ? "상단 자동 표기" : "브랜드 설정의 대가성 문구가 비어 있음" }]
      : []),
    // ── 참고: 공식 규칙이 아닌 독자 경험 관점의 참고치 (가중치 1) ──
    { id: "length", group: "참고", label: `분량 (참고 ${ref.chars.toLocaleString()}자 내외)`, weight: 1, pass: chars >= ref.chars, detail: `현재 ${chars.toLocaleString()}자 — 독자가 따라 하기에 충분한지 확인` },
    { id: "images", group: "참고", label: `이미지 (참고 ${ref.images}장 내외)`, weight: 1, pass: opts.imageCount >= ref.images, detail: `현재 ${opts.imageCount}장 — 단계마다 화면이 있으면 이해가 쉬움` },
    { id: "tags", group: "참고", label: platform === "NAVER" ? "해시태그" : "라벨", weight: 1, pass: m.tags.length >= ref.tags[0] && m.tags.length <= ref.tags[1], detail: `현재 ${m.tags.length}개` },
    { id: "density", group: "참고", label: "키워드 억지 반복 없음", weight: 1, pass: density <= 0.04, detail: `${kwCount}회 · ${(density * 100).toFixed(1)}%` },
    { id: "table", group: "참고", label: "비교·요약 표", weight: 1, pass: m.sections.some((s) => s.table && s.table.rows.length > 0), detail: "비교가 필요한 주제라면 표가 읽기 쉬움" },
  ];

  const total = checks.reduce((a, c) => a + c.weight, 0);
  const got = checks.reduce((a, c) => a + (c.pass ? c.weight : 0), 0);
  return {
    score: Math.round((got / total) * 100),
    checks,
    stats: { chars, keywordCount: kwCount, density: Math.round(density * 1000) / 10, headings, faq: m.faq.length, images: opts.imageCount, placeholders, tenseConflicts: tense.length },
  };
}
