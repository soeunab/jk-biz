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
- 브랜드명(위 "수석 에디터" 소속 블로그명)을 저자로 일관되게 언급해 엔티티 신뢰도 형성

[사실성 — 가장 중요]
- 조사 메모·출처에 없는 고유명사(요금제명·모델명·기능명·제도명)와 가격·수치를 만들지 마세요.
  확인이 안 되면 일반 명사로 쓰고("유료 요금제") reviewChecklist 에 "확인 필요"로 남기세요.
- 이미 일어난 일(출시·가격 변경 등)을 미래형·추측형으로 쓰지 말고, 확인되지 않은 미래를 단정하지 마세요.
- 1인칭 경험("제가 직접 해보니", "3분 걸렸어요")을 지어내지 마세요. 사용 후기(REVIEW)형 글일 때만
  "[경험 추가: 무엇을 적으면 좋은지 안내]" 형식의 자리표시를 본문에 1개 넣으세요(사람이 검수하며 실제 경험으로 채웁니다).
  비교·가이드·사용법 같은 정보성 글은 경험 자리표시 없이 정확한 정보·출처로 신뢰를 주면 됩니다.
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
- 말투: "~해요"체, 독자의 구체적 상황과 예시 중심 (경험 자리표시는 사용 후기형 글일 때만)
- 이미지: 단계마다 화면을 보여주면 이해가 빨라지므로 섹션마다 image 권장, 도구 화면은 source=screenshot(공식 URL) 우선
- 중요한 문장은 **굵게**, 이모지는 소제목에만 가볍게
- 외부 링크: 출처 링크 자체는 문제없음. 같은 링크를 여러 글에 반복 게재하는 것만 피할 것
- tags: 해시태그용 키워드 (# 없이, 띄어쓰기 없이, 참고: 10개 내외)
- 쇼핑커넥트 제휴 상품은 글 흐름에 자연스럽게, 광고성 문구 남발 금지
`,
  BLOGGER: `
[구글 블로거 전용 가이드 — 구글 검색·애드센스 대응]
- 구조: 제목(H1) → H2 → H3 계층을 명확히 (구글은 문서 구조를 해석함)
- 구글 E-E-A-T: 경험(사용 후기형 글일 때만 경험 자리표시 1개), 전문성(정확한 용어), 권위(공식 출처 링크 자유롭게), 신뢰(작성·검수 주체와 기준일)
- 분량: 주제를 빠짐없이 다룰 만큼. 억지로 늘리지 말 것 (참고: 보통 2,500~4,000자)
- 말투: "~해요"체 통일
- 이미지: 이해를 돕는 곳에만, 도구 화면은 source=screenshot 우선
- 비교가 필요하면 표, 절차는 번호 목록
- metaDescription: 첫 문장만으로 답이 되게, 120~150자 참고. slug 는 영문 키워드 3~6단어
- tags: 블로거 라벨 3~5개 (카테고리 성격)
- 애드센스 정책 준수: 클릭 유도 문구 금지, 저품질·중복 콘텐츠 금지
`,
};

export function buildSystemPrompt(brand: Brand, platform: Platform, accountConcept?: string | null) {
  const missionLine = accountConcept?.trim()
    ? `이 계정(블로그)의 주제: ${accountConcept.trim()}
브랜드 전체 미션(참고용 — 이 계정 주제와 다르면 이 글의 소재를 브랜드 미션에 억지로 맞추지 말고 위 계정 주제를 따르세요): ${brand.mission}`
    : `브랜드 미션: ${brand.mission}`;
  return `당신은 "${brand.name}" 블로그의 수석 에디터입니다.
${missionLine}
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
  accountName?: string;
  accountConcept?: string;
  researchNotes?: string;
  researchSources?: { title: string; url: string }[];
  internalLinks?: { title: string; url: string }[];
  affiliateProducts?: { id: string; name: string; program: string; tags: string }[];
  avoidTitles?: string[];
  /** 검색의도 (정보탐색형/탐색형/상업조사형/구매의도형) */
  intent?: Intent | string;
  /** 크로스플랫폼 재발행 원본 (구조·핵심만 — 본문 전문은 전달하지 않음) */
  republishOf?: { platform: Platform; accountName: string; title: string; headings: string[]; keyPoints: string[] };
  /** 함께 검색되는 롱테일 문구 (자동완성·"함께 많이 찾는"·검색광고 연관, volume = 네이버 월검색량) */
  relatedKeywords?: { keyword: string; volume: number | null }[];
  today: string;
};

function relatedKeywordRules(b: BriefInput) {
  if (!b.relatedKeywords?.length) return "";
  const list = b.relatedKeywords
    .slice(0, 12)
    .map((r) => (r.volume != null ? `${r.keyword}(월 ${r.volume.toLocaleString("ko-KR")})` : r.keyword))
    .join(", ");
  return `
[함께 검색되는 롱테일 문구 — 실제 자동완성·연관검색 데이터]
${list}
- 이 문구들은 같은 주제로 실제 사람들이 검색하는 표현입니다. 검색량이 큰 것부터 소제목(heading)·FAQ 질문·본문에 자연스럽게 녹여, 한 글이 여러 롱테일 검색에 함께 노출되게 하세요. 억지 나열·반복은 금지.
- 제목(title) 뒤쪽에 이 중 1개를 자연스럽게 붙일 수 있으면 붙이세요(핵심 키워드는 반드시 맨 앞 그대로).
- relatedKeywords 필드에는 이 목록에서 글과 실제로 관련된 문구를 우선 넣으세요.`;
}

export function buildUserPrompt(b: BriefInput) {
  const persona = PERSONAS[b.persona];
  const type = recipeFor(b.intent, b.keyword);
  const recipe = RECIPES[type];
  const risk = detectRisk([b.keyword, b.title, b.angle].filter(Boolean).join(" "));
  const intentLabel = b.intent && b.intent in INTENT_LABEL ? INTENT_LABEL[b.intent as Intent] : "정보탐색형";
  return `다음 기획으로 ${b.platform === "NAVER" ? "네이버 블로그" : "구글 블로거"} 원고를 작성하세요.

- 핵심 키워드: ${b.keyword} — 제목(title) 맨 앞에 형태 변형 없이 그대로 넣고, focusKeyword 도 이 문구 그대로 쓰세요
- 가제: ${b.title ?? "(자유)"}
- 관점/구성: ${b.angle || "(자유)"}
${b.tool ? `- 주요 도구: ${b.tool}` : ""}
- 대상 독자: ${persona.label} — ${persona.description}
- 독자 관심사: ${persona.needs.join(", ")}
- 오늘 날짜: ${b.today} (시점 표기에 사용)
- 검색의도: ${intentLabel} → 글 유형: ${recipe.label}
- 권장 섹션 흐름(상황에 맞게 조정 가능): ${recipe.sections.join(" → ")}
${conceptRules(b.accountConcept)}
${b.avoidTitles?.length ? `- 이미 발행한 비슷한 글(제목·구성·예시가 겹치지 않게): ${b.avoidTitles.join(" / ")}` : ""}
${relatedKeywordRules(b)}

[최신 조사 메모 — 사실 확인에 활용, 없는 내용은 지어내지 말 것]
${b.researchNotes?.trim() || "(조사 메모 없음 — 요금·수치는 reviewChecklist 에 확인 필요로 남기세요)"}
${b.researchSources?.length ? `참고 URL:\n${b.researchSources.map((s) => `- ${s.title}: ${s.url}`).join("\n")}` : ""}

[내부 링크 후보 — 관련 있으면 본문에서 자연스럽게 언급 (마크다운 링크)]
${b.internalLinks?.length ? b.internalLinks.map((l) => `- ${l.title}: ${l.url}`).join("\n") : "(없음)"}

[제휴 상품 후보 — 글과 관련 있을 때만 affiliate 에 productId 로 최대 2개]
${b.affiliateProducts?.length ? b.affiliateProducts.map((p) => `- id=${p.id} | ${p.name} | ${p.program} | 태그: ${p.tags}`).join("\n") : "(없음 — affiliate 는 빈 배열)"}

${riskPromptRules(risk)}
${republishRules(b)}

구성 필수 요소: directAnswer, tldr 3개, 섹션별 image(가능한 한), 비교가 필요하면 표, ${b.tool ? `프롬프트 예시 1개 이상(인용 형태 "> "), ` : ""}${type === "REVIEW" ? `"[경험 추가: …]" 자리표시 1개, ` : ""}FAQ 4~6개, 결론과 CTA, reviewChecklist.`;
}

/** 원본 링크 자리표시 — 렌더러가 원본 글 링크로 바꿉니다. */
export const SOURCE_LINK_TOKEN = "{{원본링크}}";

/** 계정 콘셉트 차별화 규칙 — 같은 키워드라도 계정마다 다른 글이 나오도록 */
export function conceptRules(concept?: string | null): string {
  if (!concept?.trim()) return "- 이 블로그 계정의 콘셉트: (미설정 — 일반적인 관점으로 작성)";
  return `- 이 블로그 계정의 콘셉트: ${concept.trim()}
  · 제목: 이 콘셉트의 독자가 검색할 표현과 상황을 담아 다른 계정 글과 구별되게
  · 관점: 이 콘셉트의 독자가 실제로 겪는 문제·목표를 중심으로 전개
  · 예시: 모든 사례·프롬프트 예시를 이 콘셉트의 독자 상황으로 설정 (다른 독자층 예시 재사용 금지)
  · 위 "핵심 키워드·가제·관점/구성·주요 도구"가 이 콘셉트와 성격이 다르면(예: 콘셉트는 AI 도구와 무관한데 주요 도구가 지정된 경우), 이 콘셉트를 우선하고 소재를 이 계정 주제에 맞게 다시 해석하세요. 안 맞는 도구·소재를 억지로 끼워 넣지 마세요.`;
}

/** 크로스플랫폼 재발행 규칙 — 원본 복사 금지, 관점·구성·예시 새로 쓰기, 원본 백링크 */
export function republishRules(b: Pick<BriefInput, "republishOf" | "platform">): string {
  const r = b.republishOf;
  if (!r) return "";
  const from = r.platform === "NAVER" ? "네이버 블로그" : "구글 블로거";
  const to = b.platform === "NAVER" ? "네이버 블로그" : "구글 블로거";
  return `
[크로스플랫폼 재발행 — 원본: ${from} "${r.title}" (${r.accountName})]
- 이 글은 위 원본을 ${to} 독자용으로 다시 쓰는 글입니다. 원본을 그대로 복사하지 마세요 (검색엔진 중복 콘텐츠 페널티).
- 원본의 제목·소제목·문장·예시·표를 재사용하지 말고, 이 플랫폼 독자에 맞게 관점·구성·예시를 새로 쓰세요.
- 핵심 사실(수치·요금·절차)은 유지하되 표현과 전개 순서는 새로 만드세요.
- 원본 소제목(이 흐름을 따르지 말고 다른 구성으로): ${r.headings.join(" / ")}
- 원본 핵심: ${r.keyPoints.filter(Boolean).join(" / ")}
- 본문 중 자연스러운 한 곳에서 원본 글을 한 번 언급하고, 링크 자리에 ${SOURCE_LINK_TOKEN} 를 그대로 적으세요.
  예) "도구별 설정 화면은 ${SOURCE_LINK_TOKEN}에 더 자세히 정리해 뒀어요."`;
}
