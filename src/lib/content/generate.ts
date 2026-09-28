import { getBrand, PERSONAS, type Persona } from "../brand";
import { generateJson, research } from "../llm";
import { josa, ymd } from "../util";
import { buildSystemPrompt, buildUserPrompt, type BriefInput } from "./prompts";
import { ManuscriptSchema, type Manuscript, type Platform } from "./types";

export async function generateManuscript(
  brief: Omit<BriefInput, "today" | "researchNotes" | "researchSources">,
  opts: { log?: (m: string) => Promise<unknown> | void; skipResearch?: boolean } = {},
): Promise<{ manuscript: Manuscript; research: { notes: string; sources: { title: string; url: string }[]; at: string } }> {
  const brand = await getBrand();
  const today = ymd(new Date());

  let researchNotes = "";
  let researchSources: { title: string; url: string }[] = [];
  if (!opts.skipResearch) {
    try {
      await opts.log?.("최신 정보 조사 중 (웹 검색)…");
      const researchQuestion = brief.tool
        ? `"${brief.keyword}" 블로그 글을 쓰려고 합니다. ${brief.tool}의 ${today} 기준 최신 요금제, 주요 기능, 사용 방법, 한국어 지원, 제한사항, ${PERSONAS[brief.persona].label} 활용 사례를 조사해 주세요.`
        : `"${brief.keyword}" 블로그 글을 쓰려고 합니다. ${today} 기준 이 주제의 최신 사실(금액·조건·기한·절차 등 공식 정보)과 ${PERSONAS[brief.persona].label}에게 실질적으로 도움이 되는 내용을 조사해 주세요.`;
      const r = await research(researchQuestion);
      researchNotes = r.notes;
      researchSources = r.sources;
      if (r.sources.length) await opts.log?.(`출처 ${r.sources.length}개 확보`);
    } catch (e) {
      await opts.log?.(`조사 단계 건너뜀: ${(e as Error).message}`);
    }
  }

  await opts.log?.("원고 작성 중…");
  const manuscript = await generateJson({
    name: "manuscript",
    task: "write",
    title: `원고: ${brief.title ?? brief.keyword} (${brief.platform === "NAVER" ? "네이버" : "블로거"})`,
    system: buildSystemPrompt(brand, brief.platform, brief.accountConcept),
    prompt: buildUserPrompt({ ...brief, today, researchNotes, researchSources }),
    schema: ManuscriptSchema,
    effort: "high",
    maxTokens: 32000,
    mock: () => mockManuscript({ ...brief, today }),
  });

  // 조사 출처가 원고에 빠졌으면 보강 (GEO: 출처 명시)
  if (manuscript.sources.length === 0 && researchSources.length) manuscript.sources = researchSources.slice(0, 5);
  // 제휴 상품은 후보 목록에 있는 것만 허용
  const allowed = new Set((brief.affiliateProducts ?? []).map((p) => p.id));
  manuscript.affiliate = manuscript.affiliate.filter((a) => allowed.has(a.productId)).slice(0, 2);
  if (brief.platform === "NAVER") manuscript.tags = manuscript.tags.map((t) => t.replace(/[#\s]/g, "")).slice(0, 10);
  return { manuscript, research: { notes: researchNotes, sources: researchSources, at: today } };
}

/** API 키 없이도 전체 흐름을 확인할 수 있도록 만든 데모 원고 */
export function mockManuscript(b: {
  platform: Platform;
  keyword: string;
  title?: string;
  persona: Persona;
  tool?: string;
  today: string;
  affiliateProducts?: { id: string; name: string }[];
  republishOf?: { title: string };
}): Manuscript {
  const tool = b.tool || "Gemini";
  const p = PERSONAS[b.persona];
  const year = b.today.slice(0, 4);
  const month = Number(b.today.slice(5, 7));
  const k = b.keyword;
  const official: Record<string, string> = {
    Gemini: "https://gemini.google.com",
    Claude: "https://claude.ai",
    ChatGPT: "https://chatgpt.com",
    Perplexity: "https://www.perplexity.ai",
    NotebookLM: "https://notebooklm.google.com",
  };
  const officialUrl = official[tool] ?? "https://gemini.google.com";
  const img = (n: number, source: "ai" | "stock" | "screenshot", prompt: string, alt: string) => ({
    slot: `img${n}`,
    source,
    prompt,
    url: source === "screenshot" ? officialUrl : "",
    alt,
    caption: alt,
  });

  const sections = [
    {
      heading: `${tool}란? ${p.label}에게 필요한 이유`,
      level: 2,
      body: `**${josa(tool, "은/는")} 대화하듯 질문하면 글쓰기·요약·아이디어를 도와주는 AI 도구예요.** ${josa(p.label, "이라면/라면")} ${p.needs[0]}처럼 반복되는 일을 크게 줄일 수 있어요.\n\n- 복잡한 설치 없이 웹에서 바로 사용\n- 한국어 질문과 답변 모두 자연스러움\n- 무료 버전으로도 기본 기능 대부분 사용 가능`,
      table: null,
      tip: `처음엔 "${p.needs[0]}"처럼 매주 반복하는 일 하나만 골라 맡겨 보세요.`,
      image: img(1, "screenshot", `${tool} 공식 첫 화면`, `${k} ${tool} 첫 화면`),
    },
    {
      heading: `${k} 시작하는 방법은? (가입부터 첫 질문까지)`,
      level: 2,
      body: `1. ${officialUrl} 에 접속해요.\n2. 구글/이메일 계정으로 로그인해요.\n3. 입력창에 첫 질문을 적고 전송하면 끝이에요.\n\n[경험 추가: 가입부터 첫 답변까지 실제로 걸린 시간과 막혔던 부분]`,
      table: null,
      tip: "",
      image: img(2, "ai", "flat illustration of a person signing up to an AI assistant on a laptop, pastel colors, no text", `${k} 가입 과정 일러스트`),
    },
    {
      heading: `${p.label} 실전 활용 예시 3가지`,
      level: 2,
      body: `${p.needs.slice(0, 3).map((n, i) => `${i + 1}. **${n}** — 상황을 구체적으로 설명하고 결과 형식을 지정하세요.`).join("\n")}\n\n[경험 추가: 이 프롬프트로 실제 받아본 결과와 수정한 점]\n\n> 프롬프트 예시: "나는 ${p.label}야. ${josa(p.needs[0], "을/를")} 표로 정리해 줘. 항목은 할 일, 소요 시간, 우선순위로 해 줘."`,
      table: null,
      tip: "결과가 마음에 안 들면 '더 짧게', '표로', '초보자 눈높이로'처럼 수정 요청을 이어가세요.",
      image: img(3, "stock", "person working laptop home office", `${p.label} ${tool} 활용 모습`),
    },
    {
      heading: `무료 vs 유료, 어떤 걸 써야 할까?`,
      level: 2,
      body: `대부분의 ${josa(p.label, "은/는")} **무료 버전으로 충분히 시작**할 수 있어요. 긴 문서 분석이나 대량 작업이 많아지면 유료 플랜을 고려하세요.`,
      table: {
        headers: ["구분", "무료", "유료"],
        rows: [
          ["기본 대화", "O", "O"],
          ["긴 문서·파일 분석", "제한적", "넉넉함"],
          ["최신 고성능 모델", "일부", "O"],
        ],
      },
      tip: "",
      image: null,
    },
    {
      heading: `${tool} 쓸 때 주의할 점은?`,
      level: 2,
      body: `- 개인정보·회사 기밀은 입력하지 마세요.\n- 수치·날짜는 반드시 공식 자료로 한 번 더 확인하세요.\n- AI 답변을 그대로 제출하기보다 **내 경험을 더해 다듬는 것**이 좋아요.`,
      table: null,
      tip: "",
      image: img(4, "ai", "minimal illustration of a shield and checklist representing safe AI usage, no text", `${tool} 안전하게 사용하는 법`),
    },
  ];

  if (b.republishOf) {
    sections[2].body += `\n\n도구별 설정 화면은 {{원본링크}}에 더 자세히 정리해 뒀어요.`;
  }

  return {
    title: b.title ?? `${k} 완벽 정리 — ${josa(p.label, "을/를")} 위한 ${year} 실전 가이드`,
    metaDescription: `${k} 방법을 ${year}년 ${month}월 기준으로 정리했어요. ${p.label}가 바로 따라 할 수 있는 가입 방법, 활용 예시, 무료·유료 차이까지 지원포유가 알려드려요.`,
    slug: `${tool.toLowerCase().replace(/\s+/g, "-")}-guide-${b.persona.toLowerCase()}`,
    focusKeyword: k,
    relatedKeywords: [`${tool} 무료`, `${tool} 사용법`, `${tool} 프롬프트`, `${p.label} AI`],
    tags:
      b.platform === "NAVER"
        ? [k.replace(/\s/g, ""), `${tool}`, `${tool}사용법`, `${tool}무료`, "AI활용", "AI도구", p.label.replace(/\s/g, ""), "업무자동화", "프롬프트", "지원포유"]
        : ["AI 도구", tool, p.label],
    directAnswer: `${k}의 핵심은 공식 사이트에 로그인한 뒤 "상황 + 원하는 결과 형식"을 담아 질문하는 것이에요. ${josa(p.label, "이라면/라면")} ${p.needs[0]}부터 시작하면 가장 빠르게 효과를 볼 수 있어요.`,
    tldr: [`${josa(tool, "은/는")} 무료로 바로 시작할 수 있어요.`, `질문에 상황·형식·분량을 넣으면 결과가 좋아져요.`, `수치·날짜는 공식 자료로 꼭 다시 확인하세요.`],
    intro: `"${k}" 검색하셨나요? ${josa(p.label, "으로/로")} 지내다 보면 ${p.needs[0]}, ${p.needs[1]} 같은 일에 생각보다 많은 시간이 들죠. 이 글에서는 ${josa(tool, "을/를")} 처음 쓰는 분도 오늘 바로 따라 할 수 있도록 **가입부터 실전 활용까지** 정리했어요.`,
    sections,
    faq: [
      { q: `${josa(tool, "은/는")} 무료인가요?`, a: `네, 기본 기능은 무료로 쓸 수 있어요. 고성능 모델과 대용량 기능은 유료 플랜에서 제공돼요. 요금은 수시로 바뀌니 공식 사이트에서 확인하세요.` },
      { q: `${tool} 한국어로 써도 되나요?`, a: `네, 한국어 질문과 답변 모두 자연스럽게 지원돼요.` },
      { q: `${josa(tool, "와/과")} ChatGPT 중 무엇이 좋나요?`, a: `용도에 따라 달라요. 문서 요약·검색 연동이 중요하면 각 도구의 강점을 비교해 두 가지를 병행하는 것도 좋아요.` },
      { q: `회사 업무에 써도 괜찮나요?`, a: `회사 보안 정책을 먼저 확인하고, 기밀 정보는 입력하지 않는 것이 원칙이에요.` },
    ],
    conclusion: `${k}, 어렵지 않죠? 오늘은 가장 반복적인 일 하나만 ${tool}에게 맡겨 보세요. 작은 성공이 쌓이면 하루 30분은 거뜬히 아낄 수 있어요.`,
    cta: "궁금한 점은 댓글로 남겨 주세요. 지원포유가 다음 글에서 더 자세히 알려드릴게요!",
    sources: [{ title: `${tool} 공식 사이트`, url: officialUrl }],
    thumbnail: {
      headline: `${tool} 사용법`,
      sub: `${p.label} 실전 가이드 ${year}`,
      prompt: "soft gradient abstract background with subtle AI network shapes, blue and violet, no text",
    },
    affiliate: (b.affiliateProducts ?? []).slice(0, 1).map((prod) => ({
      productId: prod.id,
      anchorText: prod.name,
      sentence: `${josa(tool, "을/를")} 오래 쓰다 보니 작업 환경도 중요하더라고요. 제가 쓰는 ${prod.name}도 함께 소개해요.`,
      afterSection: 2,
    })),
    reviewChecklist: [
      `${tool} 요금제·무료 한도가 ${year}년 ${month}월 기준과 일치하는지 확인`,
      "스크린샷을 직접 캡처한 화면으로 교체하면 신뢰도가 올라가요",
      "[경험 추가] 자리표시를 실제 경험으로 채우기",
    ],
  };
}
