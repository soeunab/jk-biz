import type { Brand } from "../brand";
import type { Persona } from "../brand";
import type { Platform } from "./types";
import type { Intent } from "../topics/scoring";
import { INTENT_LABEL, normalizeKeyword } from "../topics/scoring";
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
- 결론 먼저: 섹션 body 의 첫 1~2문장은 그 소제목 질문에 대한 답(결론)이고, 근거·설명·예외는 그 뒤에.
  "~에 대해 알아보겠습니다", "살펴볼까요?" 같은 예고·뜸들이기로 섹션을 시작하지 마세요
- 절차는 번호 목록, 비교는 표, 정의는 "A는 B입니다" 형태의 한 문장
- FAQ 4~6개: 질문은 실제 검색어처럼, 답은 2~4문장으로 완결되게
- FAQ 답변·metaDescription·directAnswer 의 첫 문장은 그 문장만 떼어 인용해도 뜻이 통해야 함.
  "위에서 설명했듯이", "앞서 말한", "아래에서", "이 글에서는" 같은 본문 의존 표현 금지

[GEO — 생성형 AI(ChatGPT·Gemini·Perplexity·Claude)가 인용하는 글]
- 도구명·회사명·요금제·버전을 정확한 고유명사로 표기하고 본문·메타 설명에 "YYYY년 M월 기준"처럼 시점을 명시 (제목에는 월·일·"기준"을 넣지 말 것 — 제목 규칙 참고)
- 수치·사실에는 출처(공식 문서)를 붙이고 sources 에 URL 기록
- 다른 글에 없는 고유 정보: 사용 시나리오, 프롬프트 예시 원문, 결과 비교 (실제 경험 수치는 자리표시로)
- 인용하기 좋은 요약 문장(한 문장으로 완결된 핵심 정보)을 섹션마다 1개 이상
- 브랜드명(위 "수석 에디터" 소속 블로그명)을 저자로 일관되게 언급해 엔티티 신뢰도 형성

[사실성 — 가장 중요]
- 조사 메모 맨 앞의 [핵심 수치 재확인]이 있으면 숫자·날짜·기준은 그 결과만 따르세요: ✔ 확인·✎ 정정 값만 단정하고(정정이 있으면 반드시 정정값),
  ? 미확인 값은 단정하지 말고 "공식 확인 필요"로 쓰거나 빼고 reviewChecklist 에 남기세요. 지난 연도 기준 값을 올해 값처럼 쓰지 마세요.
- 개인 블로그·집계 사이트에만 있는 수치는 근거로 쓰지 말고, 출처(sources)에는 공식 출처를 먼저 적으세요.
- 고유명사는 공식 표기 그대로 버전까지 쓰세요(예: "Sol" 이 아니라 "GPT-6.1 Sol", 이름이 같은 다른 버전이 있으면 구분). 줄여 쓰지 마세요.
- "커뮤니티에서 화제", "불만이 많아요", "많이들 써요" 같은 반응·여론·추세 문장은 조사 메모에 출처가 있을 때만 쓰세요. 분위기를 살리려고 지어내지 마세요.
- 표·목록의 값에는 공식 출처에 붙은 조건(요금제·좌석 종류·결제 주기·기준 연도·단위)을 빼지 말고 함께 쓰세요.
- 공식 출처로 확인하지 못한 구체적인 세부(메뉴 경로, 화면 문구, 정확한 수치)는 "확인 필요"로 남겨 두지 말고 빼거나 일반적으로 쓰세요.
- reviewChecklist 에는 사람이 원고에 실제로 쓰인 문장을 확인·수정해야 하는 것만 1~3개 적으세요. 원고에 쓰지 않은(뺀) 내용,
  [경험 추가] 채우기·내부 링크 확인·이미지 교체 같은 일반 작업(프로그램이 따로 표시)은 적지 마세요. 없으면 빈 배열.
- 조사 메모·출처에 없는 고유명사(요금제명·모델명·기능명·제도명)와 가격·수치를 만들지 마세요.
  확인이 안 되면 일반 명사로 쓰고("유료 요금제") reviewChecklist 에 "확인 필요"로 남기세요.
- 이미 일어난 일(출시·가격 변경 등)을 미래형·추측형으로 쓰지 말고, 확인되지 않은 미래를 단정하지 마세요.
- 1인칭 경험("제가 직접 해보니", "3분 걸렸어요")을 지어내지 마세요. 대신 모든 글에 "[경험 추가: 무엇을 적으면 좋은지 안내]"
  형식의 자리표시를 1~2개 넣으세요(사용 후기형은 2개). 사람이 검수하며 실제 경험·직접 찍은 사진·실측 숫자로 채웁니다.
  AI 브리핑·AI 개요는 정보를 요약할 수는 있어도 직접 경험은 만들 수 없어서, 이 부분이 검색 노출·AI 인용·체류시간을 가르는 고유 정보가 됩니다.
  자리표시는 독자가 "직접 해 본 사람"의 말을 원하는 지점에 두고, 무엇을 적을지 구체적으로 안내하세요
  (예: "[경험 추가: 실제 신청 화면 캡처와 신청에 걸린 시간]", "[경험 추가: 한 달 써 본 뒤 실제 요금 청구액]").
- 조사 메모·제공 자료에 나오지 않는 회사·제품·인물 사이의 관계(협업·투자·인수·공급·경쟁)를 추측해 쓰지 마세요.
  연관 검색어에 함께 나온다는 이유만으로 관계를 만들지 마세요.
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
- 말투: "~해요"체, 독자의 구체적 상황과 예시 중심 (경험은 지어내지 말고 자리표시로)
- 이미지: 단계마다 화면을 보여주면 이해가 빨라지므로 섹션마다 image 권장, 도구 화면은 source=screenshot(공식 URL) 우선
- 중요한 문장은 **굵게**, 이모지는 소제목에만 가볍게
- 외부 링크: 출처 링크 자체는 문제없음. 같은 링크를 여러 글에 반복 게재하는 것만 피할 것
- tags: 해시태그용 키워드 (# 없이, 띄어쓰기 없이, 참고: 10개 내외)
- 쇼핑커넥트 제휴 상품은 글 흐름에 자연스럽게, 광고성 문구 남발 금지
`,
  BLOGGER: `
[구글 블로거 전용 가이드 — 구글 검색·애드센스 대응]
- 구조: 제목(H1) → H2 → H3 계층을 명확히 (구글은 문서 구조를 해석함)
- 구글 E-E-A-T: 경험(경험 자리표시 1~2개 — 사람이 채움), 전문성(정확한 용어), 권위(공식 출처 링크 자유롭게), 신뢰(작성·검수 주체와 기준일)
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
  /** 메인 키워드(검색어 기반 발굴의 시드) — 롱테일 keyword 는 이것을 구체화한 말. 없으면 keyword 자체가 메인 */
  mainKeyword?: string;
  title?: string;
  angle?: string;
  persona: Persona;
  tool?: string;
  accountName?: string;
  accountConcept?: string;
  researchNotes?: string;
  researchSources?: { title: string; url: string }[];
  internalLinks?: { title: string; url: string; pillar?: boolean }[];
  affiliateProducts?: { id: string; name: string; program: string; tags: string }[];
  avoidTitles?: string[];
  /** 검색의도 (정보탐색형/탐색형/상업조사형/구매의도형) */
  intent?: Intent | string;
  /** SEARCH(검색형, 기본) | HOMEFEED(네이버 홈피드형) */
  format?: "SEARCH" | "HOMEFEED";
  /** 크로스플랫폼 재발행 원본 (구조·핵심만 — 본문 전문은 전달하지 않음) */
  republishOf?: { platform: Platform; accountName: string; title: string; headings: string[]; keyPoints: string[] };
  /** 제목 전략 — locked 면 사용자가 고른 제목(title)을 그대로 씀, rules 는 titleRulesText 결과 */
  titlePlan?: { locked: boolean; rules: string };
  /** 함께 검색되는 롱테일 문구 (자동완성·"함께 많이 찾는"·검색광고 연관, volume = 네이버 월검색량) */
  relatedKeywords?: { keyword: string; volume: number | null }[];
  /** 실시간 발굴 소재가 뜬 이유 — 실제 수집한 기사 요약·목록 (이 사건 중심으로 쓰게 함) */
  storyContext?: StoryContext;
  /** 사용자가 직접 준 자료 (📎 내 자료로 다시 쓰기) — 최우선 근거 */
  userSources?: UserSources;
  today: string;
};

export type StoryContext = { summary: string; articles: { title: string; url: string | null; source: string }[] };

/** 사용자 제공 자료: prefer = 내 자료 우선 + 웹 조사로 보충, only = 내 자료만(웹 조사 안 함) */
export type UserSources = { notes: string; urls: string[]; mode: "prefer" | "only" };

function relatedKeywordRules(b: BriefInput) {
  if (!b.relatedKeywords?.length) return "";
  const list = b.relatedKeywords
    .slice(0, 12)
    .map((r) => (r.volume != null ? `${r.keyword}(월 ${r.volume.toLocaleString("ko-KR")})` : r.keyword))
    .join(", ");
  return `
[함께 검색되는 문구 — 참고용 (자동완성·연관검색 데이터)]
${list}
- 이 중 메인 키워드와 같은 대상·같은 사건을 다루는 문구만 골라 써도 됩니다. 관련 없는 문구는 무시하세요. 전부 쓸 필요 없음.
- 골라 쓴 문구는 메인 키워드(${b.mainKeyword || b.keyword})에 대한 하위 질문에 답하는 형태로 소제목·FAQ 질문·본문 중 어울리는 곳에 한 번씩만 (한 글이 여러 롱테일 검색에 함께 노출됨). 쉼표 나열·한 문장에 몰아넣기·반복 금지(키워드 스터핑).
- 이 문구를 쓰려고 조사 메모·제공 자료에 없는 회사·제품·인물·관계(협업·투자·인수·계약)를 끌어오지 마세요.
${b.titlePlan?.locked ? "" : "- 제목은 [제목 규칙]을 따르세요(보조 검색어가 정해져 있으면 그것을, 없으면 이 중 1개를 뒤쪽에 자연스럽게 — 핵심 키워드는 반드시 맨 앞 그대로).\n"}- relatedKeywords 필드에는 본문에 실제로 쓴 문구만 넣으세요.`;
}

/** 실시간 발굴 소재의 실제 수집 기사 — 원고가 키워드만 보고 인접한 다른 뉴스로 번지지 않게 */
export function storyContextBlock(c?: StoryContext): string {
  if (!c?.summary.trim() && !c?.articles.length) return "";
  const arts = (c.articles ?? []).slice(0, 8).map((a) => `- ${a.title}${a.source ? ` (${a.source})` : ""}${a.url ? `: ${a.url}` : ""}`);
  return `
[이 소재가 뜬 이유 — 실제 수집 기사]
${c.summary.trim() ? `요약: ${c.summary.trim()}\n` : ""}${arts.join("\n")}
- 이 사건을 중심으로 쓰고, 다른 사건·회사로 확장하지 마세요.`;
}

/** 사용자 제공 자료 블록 — 프롬프트 최상단(핵심 키워드 바로 다음)에 넣음 */
export function userSourcesBlock(u?: UserSources): string {
  if (!u || (!u.notes.trim() && !u.urls.length)) return "";
  return `
[사용자 제공 자료 — 최우선 근거]
${u.notes.trim() || "(본문 자료 없음 — 아래 URL 참고)"}
${u.urls.length ? `참고 URL:\n${u.urls.map((x) => `- ${x}`).join("\n")}` : ""}
- 이 자료와 조사 메모에 없는 사실·회사·수치·관계는 쓰지 마세요.
- 자료와 웹 조사가 다르면 자료를 우선하고 reviewChecklist 에 차이를 남기세요.${u.mode === "only" ? "\n- 이번 글은 웹 조사 없이 이 자료만으로 씁니다. 자료에 없는 내용은 일반적인 설명에 그치고 수치·고유명사를 만들지 마세요." : ""}`;
}

/** 제목-본문 일치: 네이버는 제목과 본문 덩어리(섹션)마다 의미 유사도를 따져 제목과 다른 내용을 걸러냄(문서 일관성 특허 KR102315068B1) */
function mainKeywordRule(b: BriefInput) {
  const main = b.mainKeyword?.trim();
  if (main && normalizeKeyword(main) !== normalizeKeyword(b.keyword)) {
    return `- 메인 키워드: ${main} — 글 전체(모든 소제목·본문·FAQ)가 메인 키워드에 대한 내용이어야 합니다. 핵심 키워드(${b.keyword})는 메인 키워드의 구체적인 측면이니 그 측면을 중심으로 쓰되, 메인 키워드 주제를 벗어난 섹션을 만들지 마세요.`;
  }
  return `- 글 전체(모든 소제목·본문·FAQ)가 핵심 키워드(${b.keyword})에 대한 내용이어야 합니다. 핵심 키워드와 다른 주제로 흐르는 섹션을 만들지 마세요.`;
}

/** 제목 지시 — 사용자가 고른 제목은 확정(조사 결과와 어긋날 때만 바꾸고 이유를 남김), 아니면 가제 */
function titleLine(b: BriefInput) {
  if (b.titlePlan?.locked && b.title) {
    return `- 확정 제목: ${b.title} — 사용자가 고른 제목입니다. title 에 글자 그대로 쓰고 titleChangeReason 은 빈 문자열로 두세요.
  예외: 조사 결과 제목의 사실이 틀렸을 때만(예: 제목은 "확정"인데 실제로는 미정, 제목의 숫자·회차가 공식 자료와 다름) 최소한으로 고치고 titleChangeReason 에 근거와 함께 이유를 쓰세요. 표현 취향으로 바꾸지 마세요.
  본문 모든 섹션은 이 제목이 약속한 내용을 다뤄야 합니다.`;
  }
  return `- 가제: ${b.title ?? "(자유)"} (아래 [제목 규칙]에 맞게 다듬어도 됩니다. titleChangeReason 은 빈 문자열)`;
}

export function buildUserPrompt(b: BriefInput) {
  const type = b.format === "HOMEFEED" ? "HOMEFEED" : recipeFor(b.intent, b.keyword);
  const recipe = RECIPES[type];
  const risk = detectRisk([b.keyword, b.title, b.angle].filter(Boolean).join(" "));
  const intentLabel = b.intent && b.intent in INTENT_LABEL ? INTENT_LABEL[b.intent as Intent] : "정보탐색형";
  return `다음 기획으로 ${b.platform === "NAVER" ? "네이버 블로그" : "구글 블로거"} 원고를 작성하세요.

- 핵심 키워드: ${b.keyword} — 제목(title) 맨 앞에 형태 변형 없이 그대로 넣고, focusKeyword 도 이 문구 그대로 쓰세요
${userSourcesBlock(b.userSources)}
${mainKeywordRule(b)}
${titleLine(b)}
- 관점/구성: ${b.angle || "(자유)"}
${b.tool ? `- 주요 도구: ${b.tool}` : ""}
- 오늘 날짜: ${b.today} (시점 표기에 사용)
- 검색의도: ${intentLabel} → 글 유형: ${recipe.label}
- 권장 섹션 흐름(상황에 맞게 조정 가능): ${recipe.sections.join(" → ")}
${conceptRules(b.accountConcept)}
${b.avoidTitles?.length ? `- 이미 발행한 비슷한 글(제목·구성·예시가 겹치지 않게): ${b.avoidTitles.join(" / ")}` : ""}
${relatedKeywordRules(b)}
${storyContextBlock(b.storyContext)}
${b.titlePlan && !b.titlePlan.locked ? b.titlePlan.rules : ""}

[최신 조사 메모 — 사실 확인에 활용, 없는 내용은 지어내지 말 것]
${b.researchNotes?.trim() || "(조사 메모 없음 — 요금·수치는 reviewChecklist 에 확인 필요로 남기세요)"}
${b.researchSources?.length ? `참고 URL:\n${b.researchSources.map((s) => `- ${s.title}: ${s.url}`).join("\n")}` : ""}

[내부 링크 후보 — 같은 주제 묶음 순. 관련 있는 글 1~3개를 본문 문맥 속에 마크다운 링크로 (목록으로 나열 금지)]
${b.internalLinks?.length ? b.internalLinks.map((l) => `- ${l.pillar ? "[필러 글 — 이 글이 속한 주제의 대표 글, 본문에서 반드시 연결] " : ""}${l.title}: ${l.url}`).join("\n") : "(없음)"}

[제휴 상품 후보 — 글과 관련 있을 때만 affiliate 에 productId 로 최대 2개]
${b.affiliateProducts?.length ? b.affiliateProducts.map((p) => `- id=${p.id} | ${p.name} | ${p.program} | 태그: ${p.tags}`).join("\n") : "(없음 — affiliate 는 빈 배열)"}

${riskPromptRules(risk)}
${republishRules(b)}
${b.format === "HOMEFEED" ? HOMEFEED_RULES : ""}

구성 필수 요소: directAnswer, tldr 3개, 섹션별 image(가능한 한), 비교가 필요하면 표, ${b.tool ? `프롬프트 예시 1개 이상(인용 형태 "> "), ` : ""}"[경험 추가: …]" 자리표시 ${type === "REVIEW" ? "2개" : "1~2개"}, FAQ 4~6개, 결론과 CTA, reviewChecklist.`;
}

/**
 * 네이버 홈피드(홈판)형 — 검색어가 아니라 추천으로 노출되므로 문법이 다름: 궁금증 제목 → 궁금증을 키우는 썸네일 → 첫 문장 후킹 → 댓글 유도.
 * 체류가 짧으면 낚시성으로 보고 추가 배포가 끊긴다는 게 실무자 경험칙이라, 제목이 약속한 답을 앞쪽에서 반드시 줍니다.
 */
export const HOMEFEED_RULES = `
[네이버 홈피드(홈판)형 글 — 검색형과 문법이 다름]
- 제목: 핵심 키워드는 맨 앞에 두되, 뒤쪽은 통념을 뒤집거나 궁금증을 만드는 표현으로 (예: "○○, 대부분 잘못 알고 있는 한 가지").
  사실과 다른 과장·공포 조장·본문에 없는 약속은 금지 — 제목이 던진 질문의 답을 본문 첫 1/3 안에서 반드시 주세요.
- thumbnail.headline: 제목의 궁금증을 한 번 더 키우는 짧은 문구(12자 안팎), 답을 미리 다 말하지 말 것.
- intro 첫 문장: 인사·자기소개 없이 독자가 몰랐던 사실·반전으로 바로 시작.
- 문단은 1~2문장으로 짧게, 모바일에서 스크롤하며 읽히게. 표·목록은 꼭 필요할 때만.
- cta: 독자의 경험이나 의견을 묻는 댓글 질문 한 문장 (예: "여러분은 어떻게 하고 계신가요? 댓글로 알려 주세요").
- directAnswer·FAQ 는 그대로 쓰되(검색·AI 브리핑 유입도 함께 받도록), 분량은 검색형보다 짧아도 됩니다.
`;

/** 원본 링크 자리표시 — 렌더러가 원본 글 링크로 바꿉니다. */
export const SOURCE_LINK_TOKEN = "{{원본링크}}";

/** 계정 콘셉트 차별화 규칙 — 같은 키워드라도 계정마다 다른 글이 나오도록 */
export function conceptRules(concept?: string | null): string {
  if (!concept?.trim()) return "- 이 블로그 계정의 콘셉트: (미설정 — 일반적인 관점으로 작성)";
  return `- 이 블로그 계정의 콘셉트: ${concept.trim()}
  · 제목: 독자층 단어(직장인·프리랜서 등)는 넣지 마세요 — 계정 구별은 제목 규칙의 보조 검색어로 합니다
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
