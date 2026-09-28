import { z } from "zod";

export const ImageSlotSchema = z.object({
  slot: z.string().describe("이미지 식별자 (img1, img2 ...)"),
  source: z.enum(["ai", "stock", "screenshot"]).describe("ai=AI 생성 일러스트, stock=스톡 사진 검색, screenshot=공식 사이트 화면 캡처"),
  prompt: z.string().describe("ai: 영어 이미지 생성 프롬프트 / stock: 영어 검색어 / screenshot: 캡처 대상 설명"),
  url: z.string().describe("screenshot 인 경우 캡처할 공식 URL, 아니면 빈 문자열"),
  alt: z.string().describe("한국어 대체텍스트 (키워드 포함, 이미지 내용 묘사)"),
  caption: z.string().describe("이미지 아래 짧은 설명"),
});

export const SectionSchema = z.object({
  heading: z.string().describe("소제목 — 가능하면 독자가 실제로 검색하는 질문형"),
  level: z.number().int().describe("소제목 단계: 2 또는 3"),
  body: z.string().describe("본문 마크다운: 2~3문장 짧은 문단, 목록(-), 순서(1.), **굵게** 사용"),
  table: z
    .object({ headers: z.array(z.string()), rows: z.array(z.array(z.string())) })
    .nullable()
    .describe("비교·요약 표가 유용하면 작성, 아니면 null"),
  tip: z.string().describe("지원포유 꿀팁 한 줄 (없으면 빈 문자열)"),
  image: ImageSlotSchema.nullable(),
});

export const ManuscriptSchema = z.object({
  title: z.string(),
  metaDescription: z.string().describe("검색결과 설명문 80~150자, 키워드 포함"),
  slug: z.string().describe("영문 소문자-하이픈 permalink"),
  focusKeyword: z.string(),
  relatedKeywords: z.array(z.string()),
  tags: z.array(z.string()).describe("네이버는 해시태그 10개, 블로거는 라벨 3~5개"),
  directAnswer: z.string().describe("핵심 질문에 대한 2~3문장 직답 (AI 답변·스니펫 인용용)"),
  tldr: z.array(z.string()).describe("핵심 요약 3개"),
  intro: z.string().describe("도입부: 독자 공감 + 이 글에서 얻을 것"),
  sections: z.array(SectionSchema),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
  conclusion: z.string(),
  cta: z.string().describe("다음 행동 유도 (댓글·이웃추가·관련 글)"),
  sources: z.array(z.object({ title: z.string(), url: z.string() })).describe("참고한 공식 출처"),
  thumbnail: z.object({
    headline: z.string().describe("썸네일 큰 글씨 12자 내외"),
    sub: z.string().describe("썸네일 작은 글씨 20자 내외"),
    prompt: z.string().describe("썸네일 배경용 영어 이미지 프롬프트 (글자 없는 이미지)"),
  }),
  affiliate: z
    .array(z.object({ productId: z.string(), anchorText: z.string(), sentence: z.string(), afterSection: z.number().int() }))
    .describe("제휴 상품 추천 (목록에 있는 것만, 관련 없으면 빈 배열)"),
  reviewChecklist: z.array(z.string()).describe("사람이 발행 전에 확인해야 할 사실·수치·캡처 교체 항목"),
});

export type Manuscript = z.infer<typeof ManuscriptSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type ImageSlot = z.infer<typeof ImageSlotSchema>;
export type Platform = "NAVER" | "BLOGGER";
