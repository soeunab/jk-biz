import { charCount } from "../util";
import { manuscriptText } from "./render";
import type { Manuscript, Platform } from "./types";

export type SeoCheck = {
  id: string;
  group: "SEO" | "AEO" | "GEO" | "수익화" | "정책";
  label: string;
  pass: boolean;
  weight: number;
  detail: string;
};

export type SeoReport = { score: number; checks: SeoCheck[]; stats: Record<string, number> };

const PLATFORM_RULES = {
  NAVER: { minChars: 1800, minImages: 5, title: [12, 40], tags: [8, 10] },
  BLOGGER: { minChars: 2200, minImages: 3, title: [15, 60], tags: [2, 6] },
} as const;

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
 * 규칙 기반 SEO/AEO/GEO 점검. AI 호출 없이 즉시 계산되며,
 * 사람 검수자가 무엇을 고치면 되는지 체크리스트로 보여줍니다.
 */
export function auditManuscript(
  m: Manuscript,
  platform: Platform,
  opts: { imageCount: number; bannedPhrases?: string[]; hasDisclosure?: boolean } = { imageCount: 0 },
): SeoReport {
  const rules = PLATFORM_RULES[platform];
  const text = manuscriptText(m);
  const chars = charCount(text);
  const kw = m.focusKeyword.trim();
  const kwCount = countOccurrences(text, kw);
  // 키워드 밀도: 키워드 글자 수 × 등장 횟수 / 전체 글자 수
  const density = chars ? (kwCount * charCount(kw)) / chars : 0;
  const headings = m.sections.length;
  const questionHeadings = m.sections.filter((s) => /[?？]|(방법|하는 법|이유|차이|뭔가요|인가요|할까)/.test(s.heading)).length;
  const imagesWithKeywordAlt = m.sections.filter((s) => s.image && countOccurrences(s.image.alt, kw.split(" ")[0]) > 0).length;
  const totalSlots = m.sections.filter((s) => s.image).length;
  const titleLen = m.title.length;
  const firstIntro = m.intro.split(/[.!?。]\s/).slice(0, 2).join(" ");
  const banned = (opts.bannedPhrases ?? []).filter((b) => text.includes(b));
  const hasPrompt = m.sections.some((s) => /(^|\n)>\s/.test(s.body)) || /프롬프트/.test(text);

  const checks: SeoCheck[] = [
    { id: "title-kw", group: "SEO", label: "제목에 핵심 키워드 포함", weight: 10, pass: countOccurrences(m.title, kw) > 0, detail: `키워드 "${kw}"` },
    {
      id: "title-front",
      group: "SEO",
      label: "키워드를 제목 앞부분에 배치",
      weight: 4,
      pass: m.title.replace(/\s/g, "").toLowerCase().indexOf(kw.replace(/\s/g, "").toLowerCase()) >= 0 &&
        m.title.replace(/\s/g, "").toLowerCase().indexOf(kw.replace(/\s/g, "").toLowerCase()) <= Math.max(8, m.title.length * 0.3),
      detail: "제목의 앞 30% 이내",
    },
    { id: "title-len", group: "SEO", label: `제목 길이 ${rules.title[0]}~${rules.title[1]}자`, weight: 4, pass: titleLen >= rules.title[0] && titleLen <= rules.title[1], detail: `현재 ${titleLen}자` },
    { id: "intro-kw", group: "SEO", label: "도입부 첫 문장들에 키워드", weight: 6, pass: countOccurrences(firstIntro, kw) > 0 || countOccurrences(m.directAnswer, kw) > 0, detail: "첫 2문장 또는 직답" },
    { id: "length", group: "SEO", label: `본문 분량 ${rules.minChars.toLocaleString()}자 이상(공백 제외)`, weight: 8, pass: chars >= rules.minChars, detail: `현재 ${chars.toLocaleString()}자` },
    { id: "density", group: "SEO", label: "키워드 반복 적정 (과다 반복 금지)", weight: 5, pass: kwCount >= 3 && density <= 0.04, detail: `${kwCount}회 · 밀도 ${(density * 100).toFixed(1)}%` },
    { id: "headings", group: "SEO", label: "소제목 4개 이상", weight: 5, pass: headings >= 4, detail: `현재 ${headings}개` },
    { id: "images", group: "SEO", label: `이미지 ${rules.minImages}장 이상`, weight: 6, pass: opts.imageCount >= rules.minImages, detail: `현재 ${opts.imageCount}장` },
    { id: "alt", group: "SEO", label: "이미지 대체텍스트에 키워드", weight: 3, pass: totalSlots > 0 && imagesWithKeywordAlt / totalSlots >= 0.5, detail: `${imagesWithKeywordAlt}/${totalSlots}` },
    { id: "tags", group: "SEO", label: platform === "NAVER" ? "해시태그 8~10개" : "라벨 2~6개", weight: 3, pass: m.tags.length >= rules.tags[0] && m.tags.length <= rules.tags[1], detail: `현재 ${m.tags.length}개` },
    ...(platform === "BLOGGER"
      ? [
          { id: "meta", group: "SEO" as const, label: "메타 설명 80~160자 + 키워드", weight: 5, pass: m.metaDescription.length >= 80 && m.metaDescription.length <= 160 && countOccurrences(m.metaDescription, kw) > 0, detail: `현재 ${m.metaDescription.length}자` },
          { id: "slug", group: "SEO" as const, label: "영문 permalink", weight: 2, pass: /^[a-z0-9-]{3,80}$/.test(m.slug), detail: m.slug },
        ]
      : []),
    { id: "direct-answer", group: "AEO", label: "상단 직답(40~300자)", weight: 8, pass: m.directAnswer.length >= 40 && m.directAnswer.length <= 300, detail: `현재 ${m.directAnswer.length}자` },
    { id: "question-headings", group: "AEO", label: "질문형 소제목 2개 이상", weight: 5, pass: questionHeadings >= 2, detail: `현재 ${questionHeadings}개` },
    { id: "faq", group: "AEO", label: "FAQ 4개 이상", weight: 6, pass: m.faq.length >= 4, detail: `현재 ${m.faq.length}개` },
    { id: "tldr", group: "AEO", label: "핵심 요약 3줄", weight: 3, pass: m.tldr.length >= 3, detail: `현재 ${m.tldr.length}개` },
    { id: "table", group: "GEO", label: "비교/요약 표 1개 이상", weight: 4, pass: m.sections.some((s) => s.table && s.table.rows.length > 0), detail: "" },
    { id: "sources", group: "GEO", label: "공식 출처 명시", weight: 5, pass: m.sources.length >= 1, detail: `${m.sources.length}개` },
    { id: "dated", group: "GEO", label: "기준 시점 명시 (YYYY년/기준)", weight: 3, pass: /20\d\d년|기준/.test(text + m.metaDescription), detail: "" },
    { id: "prompt-example", group: "GEO", label: "실제 프롬프트 예시 포함", weight: 3, pass: hasPrompt, detail: "" },
    ...(m.affiliate.length
      ? [{ id: "disclosure", group: "수익화" as const, label: "제휴 대가성 문구 표기", weight: 5, pass: opts.hasDisclosure !== false, detail: "공정위 추천·보증 심사지침" }]
      : []),
    { id: "banned", group: "정책", label: "과장·금지 표현 없음", weight: 5, pass: banned.length === 0, detail: banned.join(", ") || "없음" },
  ];

  const total = checks.reduce((a, c) => a + c.weight, 0);
  const got = checks.reduce((a, c) => a + (c.pass ? c.weight : 0), 0);
  return {
    score: Math.round((got / total) * 100),
    checks,
    stats: { chars, keywordCount: kwCount, density: Math.round(density * 1000) / 10, headings, faq: m.faq.length, images: opts.imageCount },
  };
}
