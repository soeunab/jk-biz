import { db } from "./db";

export type Persona = "SOLO" | "FREELANCER" | "OFFICE" | "GENERAL";

export const PERSONAS: Record<Persona, { label: string; description: string; needs: string[] }> = {
  SOLO: {
    label: "1인 가구",
    description: "혼자 사는 20~40대. 살림·식단·재테크·행정 처리·여가를 스스로 챙겨야 함",
    needs: ["식단·장보기 계획", "가계부·절약", "정부 지원금·청약 정보 정리", "이사·계약서 검토", "취미·자기계발"],
  },
  FREELANCER: {
    label: "프리랜서",
    description: "디자이너·개발자·작가·마케터 등 1인 사업자. 영업·견적·세금·일정 관리까지 혼자 처리",
    needs: ["견적서·제안서 작성", "고객 응대 메일", "종합소득세·부가세 준비", "포트폴리오", "일정·업무 자동화"],
  },
  OFFICE: {
    label: "직장인",
    description: "보고서·회의·메일에 치이는 사무직. 업무 시간 단축과 자기계발에 관심",
    needs: ["보고서·기획서 초안", "회의록 요약", "엑셀·데이터 정리", "메일 작성", "이직·자기계발"],
  },
  GENERAL: {
    label: "AI 입문자 공통",
    description: "AI 도구를 처음 써보는 누구나",
    needs: ["가입·요금제 비교", "기본 사용법", "프롬프트 작성 요령", "무료로 쓰는 법", "주의사항·개인정보"],
  },
};

export const DEFAULT_TOOLS = [
  "Gemini", "Claude", "ChatGPT", "Perplexity", "NotebookLM", "Copilot", "Gamma", "Canva AI", "Notion AI", "Genspark",
];

export type Brand = {
  name: string;
  tagline: string;
  mission: string;
  authorName: string;
  authorBio: string;
  tools: string[];
  seedKeywords: string[];
  tone: string;
  bannedPhrases: string[];
  disclosure: { affiliate: string; ai: string };
};

export const DEFAULT_BRAND: Brand = {
  name: "지원포유",
  tagline: "AI 도구, 처음부터 실전까지 지원포유가 알려드립니다",
  mission:
    "제미나이, 클로드 등 AI 도구 소개 및 기본사용법부터 1인 가구·프리랜서·직장인이 활용하는 방법을 지원포유에서 알려드립니다.",
  authorName: "지원포유",
  authorBio: "AI 도구를 직접 써보고 1인 가구·프리랜서·직장인의 실제 업무와 생활에 맞게 정리하는 AI 활용 가이드 블로그",
  tools: DEFAULT_TOOLS,
  seedKeywords: [
    "제미나이 사용법", "클로드 사용법", "챗GPT 무료", "AI 보고서 작성", "AI 프롬프트",
    "노트북LM 사용법", "퍼플렉시티 사용법", "AI 업무 자동화", "프리랜서 AI", "1인 가구 AI",
  ],
  tone: "친근하지만 정확한 존댓말(~해요/~합니다 혼용 금지, '~해요'체 통일). 과장 없이 직접 해본 듯 구체적으로.",
  bannedPhrases: ["무조건", "100% 보장", "최고의", "완벽한", "혁명적인"],
  disclosure: {
    affiliate: "이 포스팅은 제휴 마케팅 활동의 일환으로, 구매 시 일정액의 수수료를 제공받을 수 있습니다.",
    ai: "이 글은 AI 도구의 도움을 받아 초안을 작성하고 지원포유가 직접 검수했습니다.",
  },
};

export async function getBrand(): Promise<Brand> {
  const row = await db.setting.findUnique({ where: { key: "brand" } });
  return { ...DEFAULT_BRAND, ...((row?.value as Partial<Brand>) ?? {}) };
}

export async function saveBrand(brand: Partial<Brand>) {
  const merged = { ...(await getBrand()), ...brand };
  await db.setting.upsert({ where: { key: "brand" }, create: { key: "brand", value: merged }, update: { value: merged } });
  return merged;
}
