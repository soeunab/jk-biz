import type { Brand } from "../brand";
import { PERSONAS, type Persona } from "../brand";
import type { Platform } from "./types";
import type { Intent } from "../topics/scoring";
import { INTENT_LABEL } from "../topics/scoring";
import { RECIPES, recipeFor } from "./recipes";
import { detectRisk, riskPromptRules } from "./risk";


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
- FAQ 답변·metaDescription·directAnswer 의 첫 문장은 그 문장만 떼어 인용해도 뜻이 통해야 함.
  "위에서 설명했듯이", "앞서 말한", "아래에서", "이 글에서는" 같은 본문 의존 표현 금지

[GEO — 생성형 AI(ChatGPT·Gemini·Perplexity·Claude)가 인용하는 글]
- 도구명·회사명·요금제·버전을 정확한 고유명사로 표기하고 "YYYY년 M월 기준"처럼 시점을 명시
- 수치·사실에는 출처(공식 문서)를 붙이고 sources 에 URL 기록
- 다른 글에 없는 고유 정보: 사용 시나리오, 프롬프트 예시 원문, 결과 비교 (실제 경험 수치는 자리표시로)
- 인용하기 좋은 요약 문장(한 문장으로 완결된 핵심 정보)을 섹션마다 1개 이상
- 브랜드명(지원포유)을 저자로 일관되게 언급해 엔티티 신뢰도 형성

[사실성 — 가장 중요]
- 조사 메모·출처에 없는 고유명사(요금제명·모델명·기능명·제도명)와 가격·수치를 만들지 마세요.
  확인이 안 되면 일반 명사로 쓰고("유료 요금제") reviewChecklist 에 "확인 필요"로 남기세요.
- 이미 일어난 일(출시·가격 변경 등)을 미래형·추측형으로 쓰지 말고, 확인되지 않은 미래를 단정하지 마세요.
- 1인칭 경험("제가 직접 해보니", "3분 걸렸어요")을 지어내지 마세요. 경험이 들어가면 좋은 자리에는
  "[경험 추가: 무엇을 적으면 좋은지 안내]" 형식의 자리표시를 본문에 1~3개 넣으세요. 사람이 검수하며 실제 경험으로 채웁니다.
- 과장·단정 표현 금지. 다른 블로그 문장을 베끼지 말고 독창적인 구성과 예시로 작성하세요.

[신뢰·정책 — 투자·재테크·주식 주제일 때]
- 주가·투자·재테크·종목을 다루면 본문에 "이 글은 정보 제공 목적이며 투자 권유가 아닙니다. 최종 판단과 책임은 본인에게 있습니다." 고지 문구를 반드시 넣으세요.
- "오를 것이다", "지금이 매수 시점이다", "추천 종목" 같은 예측·추천 표현은 금지. 실적·공시·공식 발표 등 확인된 사실만 전달하세요.
- FAQ 에 "지금 사야 하나요?" 류 질문이 있으면 매수·매도를 대신 판단하지 말고 "확인된 사실 + 지켜볼 지표"만 제공하세요.
`;

export const PLATFORM_GUIDES: Record<Platform, string> = {
  NAVER: `
[네이버 블로그 전용 가이드 — C-Rank·D.I.A+·AI 브리핑 대응]
- 제목: 핵심 키워드를 형태 변형 없이 그대로 포함하고 앞쪽에 배치 (네이버는 키워드의 형태적 일치를 중시)
- 구조: H2/H3 계층은 필요 없고, 짧고 명확한 소제목과 1~3줄 문단이면 충분
- 분량: 독자가 끝까지 따라 할 수 있을 만큼. 억지로 늘리지 말 것 (참고: 보통 2,000~3,000자)
- 말투: "~해요"체, 독자의 구체적 상황과 예시 중심 (경험은 자리표시로)
- 이미지: 단계마다 화면을 보여주면 이해가 빨라지므로 섹션마다 image 권장, 도구 화면은 source=screenshot(공식 URL) 우선
- 중요한 문장은 **굵게**, 이모지는 소제목에만 가볍게
- 외부 링크: 출처 링크 자체는 문제없음. 같은 링크를 여러 글에 반복 게재하는 것만 피할 것
- tags: 해시태그용 키워드 (# 없이, 띄어쓰기 없이, 참고: 10개 내외)
- 쇼핑커넥트 제휴 상품은 글 흐름에 자연스럽게, 광고성 문구 남발 금지
`,
  BLOGGER: `
[구글 블로거 전용 가이드 — 구글 검색·애드센스 대응]
- 구조: 제목(H1) → H2 → H3 계층을 명확히 (구글은 문서 구조를 해석함)
- 구글 E-E-A-T: 경험(경험 자리표시 최소 1개 필수), 전문성(정확한 용어), 권위(공식 출처 링크 자유롭게), 신뢰(작성·검수 주체와 기준일)
- 분량: 주제를 빠짐없이 다룰 만큼. 억지로 늘리지 말 것 (참고: 보통 2,500~4,000자)
- 말투: "~해요"체 통일
- 이미지: 이해를 돕는 곳에만, 도구 화면은 source=screenshot 우선
- 비교가 필요하면 표, 절차는 번호 목록
- metaDescription: 첫 문장만으로 답이 되게, 120~150자 참고. slug 는 영문 키워드 3~6단어
- tags: 블로거 라벨 3~5개 (카테고리 성격)
- 애드센스 정책 준수: 클릭 유도 문구 금지, 저품질·중복 콘텐츠 금지
`,
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
  /** 검색의도 (정보탐색형/탐색형/상업조사형/구매의도형) */
  intent?: Intent | string;
  today: string;
};

export function buildUserPrompt(b: BriefInput) {
  const persona = PERSONAS[b.persona];
  const type = recipeFor(b.intent, b.keyword);
  const recipe = RECIPES[type];
  const risk = detectRisk([b.keyword, b.title, b.angle].filter(Boolean).join(" "));
  const intentLabel = b.intent && b.intent in INTENT_LABEL ? INTENT_LABEL[b.intent as Intent] : "정보탐색형";
  return `다음 기획으로 ${b.platform === "NAVER" ? "네이버 블로그" : "구글 블로거"} 원고를 작성하세요.

- 핵심 키워드: ${b.keyword}
- 가제: ${b.title ?? "(자유)"}
- 관점/구성: ${b.angle || "(자유)"}
- 주요 도구: ${b.tool || "(키워드에 맞게)"}
- 대상 독자: ${persona.label} — ${persona.description}
- 독자 관심사: ${persona.needs.join(", ")}
- 오늘 날짜: ${b.today} (시점 표기에 사용)
- 검색의도: ${intentLabel} → 글 유형: ${recipe.label}
- 권장 섹션 흐름(상황에 맞게 조정 가능): ${recipe.sections.join(" → ")}
${b.accountConcept ? `- 이 블로그 계정의 콘셉트: ${b.accountConcept} (같은 주제라도 이 콘셉트에 맞는 관점·예시로 차별화)` : ""}
${b.avoidTitles?.length ? `- 이미 발행한 비슷한 글(제목·구성·예시가 겹치지 않게): ${b.avoidTitles.join(" / ")}` : ""}

[최신 조사 메모 — 사실 확인에 활용, 없는 내용은 지어내지 말 것]
${b.researchNotes?.trim() || "(조사 메모 없음 — 요금·수치는 reviewChecklist 에 확인 필요로 남기세요)"}
${b.researchSources?.length ? `참고 URL:\n${b.researchSources.map((s) => `- ${s.title}: ${s.url}`).join("\n")}` : ""}

[내부 링크 후보 — 관련 있으면 본문에서 자연스럽게 언급 (마크다운 링크)]
${b.internalLinks?.length ? b.internalLinks.map((l) => `- ${l.title}: ${l.url}`).join("\n") : "(없음)"}

[제휴 상품 후보 — 글과 관련 있을 때만 affiliate 에 productId 로 최대 2개]
${b.affiliateProducts?.length ? b.affiliateProducts.map((p) => `- id=${p.id} | ${p.name} | ${p.program} | 태그: ${p.tags}`).join("\n") : "(없음 — affiliate 는 빈 배열)"}

${riskPromptRules(risk)}

구성 필수 요소: directAnswer, tldr 3개, 섹션별 image(가능한 한), 비교가 필요하면 표, 프롬프트 예시 1개 이상(인용 형태 "> "), "[경험 추가: …]" 자리표시 1~3개, FAQ 4~6개, 결론과 CTA, reviewChecklist.`;
}
