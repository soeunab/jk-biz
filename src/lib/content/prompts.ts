import type { Brand } from "../brand";
import { PERSONAS, type Persona } from "../brand";
import type { Platform } from "./types";

/**
 * SEO(검색엔진) · AEO(답변엔진: 스니펫·AI 브리핑) · GEO(생성형 AI 인용) 공통 작성 원칙
 */
export const OPTIMIZATION_RULES = `
[SEO — 검색 상위 노출]
- 핵심 키워드를 제목 앞쪽, 도입부 첫 2문장, 소제목 1~2개, 결론에 자연스럽게 배치 (억지 반복 금지)
- 연관 키워드·동의어를 소제목과 본문에 분산
- 소제목은 논리적 계층(H2 → H3), 문단은 모바일 기준 2~3문장
- 이미지마다 키워드를 포함한 구체적 대체텍스트

[AEO — 답변 엔진 최적화 (구글 스니펫·네이버 AI 브리핑·음성검색)]
- 글 맨 앞에 핵심 질문에 대한 2~3문장 "직답"(directAnswer) 제공
- 소제목은 실제 검색 질문 형태("~하는 방법은?", "~ 무료로 쓸 수 있나요?")를 우선 사용
- 절차는 번호 목록, 비교는 표, 정의는 "A는 B입니다" 형태의 한 문장
- FAQ 4~6개: 질문은 실제 검색어처럼, 답은 2~4문장으로 완결되게

[GEO — 생성형 AI(ChatGPT·Gemini·Perplexity·Claude)가 인용하는 글]
- 도구명·회사명·요금제·버전을 정확한 고유명사로 표기하고 "YYYY년 M월 기준"처럼 시점을 명시
- 수치·사실에는 출처(공식 문서)를 붙이고 sources 에 URL 기록
- 다른 글에 없는 고유 정보: 실제 사용 시나리오, 프롬프트 예시 원문, 소요 시간·결과 비교
- 인용하기 좋은 요약 문장(한 문장으로 완결된 핵심 정보)을 섹션마다 1개 이상
- 브랜드명(지원포유)을 저자로 일관되게 언급해 엔티티 신뢰도 형성

[신뢰·정책]
- 확실하지 않은 수치·요금·기능은 단정하지 말고 reviewChecklist 에 "확인 필요"로 남기기
- 과장·단정 표현 금지, 의료·법률·세무는 일반 정보임을 밝히기
- 다른 블로그 문장을 베끼지 말고 독창적인 구성과 예시로 작성
`;

export const PLATFORM_GUIDES: Record<Platform, string> = {
  NAVER: `
[네이버 블로그 전용 가이드 — C-Rank·D.I.A+·AI 브리핑 대응]
- 분량: 공백 제외 2,000~3,000자, 소제목 4~6개
- 말투: "~해요"체, 직접 써본 경험처럼 구체적으로 ("제가 직접 해보니", "실제로 3분 걸렸어요")
- 이미지: 6~8장 권장 — 섹션마다 image 를 넣고, 도구 화면은 source=screenshot(공식 URL) 우선
- 문단은 1~3줄로 짧게, 중요한 문장은 **굵게**, 이모지는 소제목에만 가볍게
- 외부 링크는 최소화 (출처는 sources 에만 기록)
- tags: 해시태그용 키워드 정확히 10개 (# 없이, 띄어쓰기 없이)
- 제목: 30자 내외, 핵심 키워드로 시작
- 체류시간을 늘리도록 표·체크리스트·예시 프롬프트 블록 활용
- 쇼핑커넥트 제휴 상품은 글 흐름에 자연스럽게, 광고성 문구 남발 금지`,
  BLOGGER: `
[구글 블로거 전용 가이드 — 구글 검색·애드센스 대응]
- 분량: 2,500~4,000자, H2 5~7개 + 필요시 H3
- 말투: 정보형 "~합니다/~해요" 혼용 없이 "~해요"체 통일
- 구글 E-E-A-T: 경험(사용 예시), 전문성(정확한 용어), 권위(공식 출처 링크), 신뢰(작성·검수 주체와 기준일)
- 이미지: 3~5장, 도구 화면은 source=screenshot 우선
- 비교 표 최소 1개, 단계별 번호 목록 최소 1개
- metaDescription 120~150자, slug 는 영문 키워드 3~6단어
- tags: 블로거 라벨 3~5개 (카테고리 성격)
- 애드센스 정책 준수: 클릭 유도 문구 금지, 저품질·중복 콘텐츠 금지`,
};

export function buildSystemPrompt(brand: Brand, platform: Platform) {
  return `당신은 "${brand.name}" 블로그의 수석 에디터입니다.
브랜드 미션: ${brand.mission}
저자 소개: ${brand.authorBio}
문체: ${brand.tone}
금지 표현: ${brand.bannedPhrases.join(", ")}

${OPTIMIZATION_RULES}
${PLATFORM_GUIDES[platform]}

출력은 지정된 JSON 스키마를 정확히 따르세요. body 는 마크다운(문단·목록·굵게)만 사용하고 HTML 태그는 쓰지 마세요.`;
}

export type BriefInput = {
  platform: Platform;
  keyword: string;
  title?: string;
  angle?: string;
  persona: Persona;
  tool?: string;
  accountConcept?: string;
  researchNotes?: string;
  researchSources?: { title: string; url: string }[];
  internalLinks?: { title: string; url: string }[];
  affiliateProducts?: { id: string; name: string; program: string; tags: string }[];
  avoidTitles?: string[];
  today: string;
};

export function buildUserPrompt(b: BriefInput) {
  const persona = PERSONAS[b.persona];
  return `다음 기획으로 ${b.platform === "NAVER" ? "네이버 블로그" : "구글 블로거"} 원고를 작성하세요.

- 핵심 키워드: ${b.keyword}
- 가제: ${b.title ?? "(자유)"}
- 관점/구성: ${b.angle || "(자유)"}
- 주요 도구: ${b.tool || "(키워드에 맞게)"}
- 대상 독자: ${persona.label} — ${persona.description}
- 독자 관심사: ${persona.needs.join(", ")}
- 오늘 날짜: ${b.today} (시점 표기에 사용)
${b.accountConcept ? `- 이 블로그 계정의 콘셉트: ${b.accountConcept} (같은 주제라도 이 콘셉트에 맞는 관점·예시로 차별화)` : ""}
${b.avoidTitles?.length ? `- 이미 발행한 비슷한 글(제목·구성·예시가 겹치지 않게): ${b.avoidTitles.join(" / ")}` : ""}

[최신 조사 메모 — 사실 확인에 활용, 없는 내용은 지어내지 말 것]
${b.researchNotes?.trim() || "(조사 메모 없음 — 요금·수치는 reviewChecklist 에 확인 필요로 남기세요)"}
${b.researchSources?.length ? `참고 URL:\n${b.researchSources.map((s) => `- ${s.title}: ${s.url}`).join("\n")}` : ""}

[내부 링크 후보 — 관련 있으면 본문에서 자연스럽게 언급 (마크다운 링크)]
${b.internalLinks?.length ? b.internalLinks.map((l) => `- ${l.title}: ${l.url}`).join("\n") : "(없음)"}

[제휴 상품 후보 — 글과 관련 있을 때만 affiliate 에 productId 로 최대 2개]
${b.affiliateProducts?.length ? b.affiliateProducts.map((p) => `- id=${p.id} | ${p.name} | ${p.program} | 태그: ${p.tags}`).join("\n") : "(없음 — affiliate 는 빈 배열)"}

구성 필수 요소: directAnswer, tldr 3개, 섹션별 image(가능한 한), 표 1개 이상, 실제 프롬프트 예시 1개 이상(코드블록 대신 인용 형태 "> "), FAQ 4~6개, 결론과 CTA, reviewChecklist.`;
}
