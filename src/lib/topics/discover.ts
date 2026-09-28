import { z } from "zod";
import { db } from "../db";
import { getBrand, PERSONAS, type Persona } from "../brand";
import { generateJson } from "../llm";
import type { JobContext } from "../jobs/queue";
import {
  googleAutocomplete,
  googleTrendingKR,
  naverAutocomplete,
  naverBlogDocCount,
  naverSearchAdKeywords,
  naverTrendMomentum,
} from "./sources";
import { INTENT_LABEL, normalizeKeyword, relevance, scoreKeyword, type KeywordMetrics, type Verification } from "./scoring";
import { josa } from "../util";

export type DiscoverOptions = {
  seeds?: string[];
  platform?: "NAVER" | "BLOGGER" | "BOTH";
  persona?: Persona | "ANY";
  limit?: number;
  /** 이번 발굴 묶음의 주제 도메인 (예: "경제·생활 혜택 정보, AI 도구와 무관"). 비우면 브랜드 미션을 그대로 씀 — 브랜드와 다른 콘셉트의 계정을 위해 시드를 따로 줄 때 사용 */
  domain?: string;
};

const VERIFICATION_RANK: Record<Verification, number> = { VERIFIED: 0, SUGGESTED: 1, UNVERIFIED: 2 };
const VERIFICATION_LABEL: Record<Verification, string> = { VERIFIED: "공식데이터 확인", SUGGESTED: "자동완성 확인", UNVERIFIED: "미검증" };

const PERSONA_MODIFIERS = ["사용법", "무료", "활용법", "프롬프트", "업무", "보고서", "직장인", "프리랜서", "1인 가구", "비교"];

export const IdeaSchema = z.object({
  ideas: z.array(
    z.object({
      keyword: z.string().describe("대표 검색 키워드 (후보 목록에서 선택)"),
      title: z.string().describe("클릭을 부르는 블로그 제목 (키워드를 앞쪽에, 32자 내외)"),
      angle: z.string().describe("차별화 관점·구성 한 줄"),
      persona: z.enum(["SOLO", "FREELANCER", "OFFICE", "GENERAL"]),
      tool: z.string().describe("이 글이 실제로 다루는 AI 도구 이름. 주제가 AI 도구 활용과 무관하면 빈 문자열(\"\")로 두세요 — 억지로 AI 도구를 끼워 넣지 마세요"),
      rationale: z.string().describe("선정 이유 1~2문장 — 후보 표에 주어진 지표만 근거로 인용. 표에 없는 수치·수익 예측 금지, 미확인 지표는 미확인이라고 쓸 것"),
    }),
  ),
});

/** 1) 키워드 확장 → 2) 지표 수집 → 3) 점수화 → 4) AI 로 주제·제목 기획 → 5) DB 저장 */
export async function discoverTopics(opts: DiscoverOptions, ctx?: JobContext) {
  const brand = await getBrand();
  const seeds = (opts.seeds?.length ? opts.seeds : brand.seedKeywords).slice(0, 12);
  const limit = opts.limit ?? 15;
  const log = (m: string) => ctx?.log(m);

  // 1) 자동완성으로 롱테일 키워드 확장 (자동완성은 "후보 제안"용, 수요 검증은 공식 API 로)
  //    "제미나이 사용법"/"제미나이사용법" 처럼 표기만 다른 키워드는 정규화해서 하나로 합칩니다.
  const sourcesByKeyword = new Map<string, Set<string>>();
  const displayByNorm = new Map<string, string>();
  const add = (k: string, src: string) => {
    const text = k.trim().replace(/\s+/g, " ");
    if (text.length < 2 || text.length > 40) return;
    const norm = normalizeKeyword(text);
    const key = displayByNorm.get(norm) ?? text;
    displayByNorm.set(norm, key);
    if (!sourcesByKeyword.has(key)) sourcesByKeyword.set(key, new Set());
    sourcesByKeyword.get(key)!.add(src);
  };
  seeds.forEach((s) => add(s, "seed"));

  let networkOk = true;
  for (const seed of seeds) {
    const [nav, goo] = await Promise.allSettled([naverAutocomplete(seed), googleAutocomplete(seed)]);
    if (nav.status === "fulfilled") nav.value.forEach((k) => add(k, "naver-ac"));
    if (goo.status === "fulfilled") goo.value.forEach((k) => add(k, "google-ac"));
    if (nav.status === "rejected" && goo.status === "rejected") networkOk = false;
  }
  if (!networkOk) {
    await log("자동완성 API 접속 실패 — 시드 키워드 조합을 '미검증' 후보로 추가합니다 (실제 검색 여부 미확인).");
    for (const seed of seeds) for (const m of PERSONA_MODIFIERS) if (!seed.includes(m)) add(`${seed.split(" ")[0]} ${m}`, "template");
  }
  const trending = await googleTrendingKR().catch(() => []);
  trending.filter((t) => relevance(t) >= 60).forEach((t) => add(t, "google-trends"));
  await log(`후보 키워드 ${sourcesByKeyword.size}개 수집`);
  await ctx?.progress(25);

  // 관련성 낮은 키워드 제거 후 상위 후보만 지표 조회 (API 호출량 절약)
  let candidates = [...sourcesByKeyword.keys()].filter((k) => relevance(k) >= 40).slice(0, 60);

  // 2) 네이버 검색광고 — 월간 검색량/경쟁도 (연관 키워드도 후보로 편입)
  const adMap = new Map<string, Awaited<ReturnType<typeof naverSearchAdKeywords>>[number]>();
  try {
    const ad = await naverSearchAdKeywords(seeds);
    for (const a of ad) {
      adMap.set(normalizeKeyword(a.keyword), a);
      if (relevance(a.keyword) >= 60) {
        add(a.keyword, "naver-searchad");
        candidates.push(displayByNorm.get(normalizeKeyword(a.keyword)) ?? a.keyword);
      }
    }
    if (ad.length) await log(`네이버 검색광고 연관 키워드 ${ad.length}개 조회`);
  } catch (e) {
    await log(`검색광고 API 오류: ${(e as Error).message}`);
  }
  candidates = [...new Set(candidates)].slice(0, 60);

  // 3) 문서 수·트렌드
  const docCounts = new Map<string, number | null>();
  for (const k of candidates.slice(0, 40)) {
    docCounts.set(k, await naverBlogDocCount(k).catch(() => null));
  }
  const momentum = await naverTrendMomentum(candidates.slice(0, 20)).catch(() => ({}) as Record<string, number>);
  await ctx?.progress(50, "검색량·문서수·트렌드 지표 수집 완료");

  const affiliateTags = (await db.affiliateProduct.findMany({ where: { active: true }, select: { tags: true } }))
    .flatMap((p) => p.tags.split(","))
    .map((t) => t.trim())
    .filter(Boolean);

  const scored = candidates
    .map((keyword) => {
      const ad = adMap.get(normalizeKeyword(keyword));
      const metrics: KeywordMetrics = {
        keyword,
        monthlySearch: ad ? ad.monthlyPc + ad.monthlyMobile : null,
        documentCount: docCounts.get(keyword) ?? null,
        compIdx: ad?.compIdx ?? null,
        adDepth: ad?.adDepth ?? null,
        momentum: (momentum as Record<string, number>)[keyword] ?? null,
        sources: [...(sourcesByKeyword.get(keyword) ?? [])],
      };
      return { metrics, scores: scoreKeyword(metrics, affiliateTags) };
    })
    .filter((s) => opts.platform === undefined || opts.platform === "BOTH" || s.scores.targetPlatform !== (opts.platform === "NAVER" ? "BLOGGER" : "NAVER"))
    // 공식 데이터로 확인된 키워드 우선, 같은 수준에서는 우선순위 점수 순
    .sort((a, b) => VERIFICATION_RANK[a.scores.verification] - VERIFICATION_RANK[b.scores.verification] || b.scores.total - a.scores.total)
    .slice(0, Math.max(limit * 2, 20));

  // 이미 다룬 키워드는 제외하고, 한 도구에 쏠리지 않도록 도구별 상한을 둡니다.
  const existing = new Set((await db.topic.findMany({ select: { keyword: true } })).map((t) => normalizeKeyword(t.keyword)));
  const perTool = new Map<string, number>();
  const cap = Math.max(2, Math.ceil(limit / 3));
  const fresh = scored.filter((s) => {
    if (existing.has(normalizeKeyword(s.metrics.keyword))) return false;
    const tool = guessTool(s.metrics.keyword);
    perTool.set(tool, (perTool.get(tool) ?? 0) + 1);
    return perTool.get(tool)! <= cap;
  });
  await ctx?.progress(60, `점수화 완료 — 신규 후보 ${fresh.length}개`);

  // 4) AI 기획: 후보 키워드를 브랜드 주제에 맞는 글 기획으로 변환
  const personaHint =
    opts.persona && opts.persona !== "ANY" ? `이번에는 "${PERSONAS[opts.persona].label}" 독자를 우선하세요.` : "1인 가구·프리랜서·직장인을 고르게 섞으세요.";
  const table = fresh
    .map(
      (s) =>
        `- ${s.metrics.keyword} | ${VERIFICATION_LABEL[s.scores.verification]} | 월검색 ${s.metrics.monthlySearch ?? "미확인"} | 문서수 ${s.metrics.documentCount ?? "미확인"} | 광고경쟁 ${s.metrics.compIdx ?? "미확인"} | 우선순위 ${s.scores.total} | ${INTENT_LABEL[s.scores.intent]}`,
    )
    .join("\n");

  const { ideas } = await generateJson({
    name: "topicIdeas",
    task: "light",
    title: `주제 기획 (${fresh.length}개 후보)`,
    system: `당신은 한국 블로그 수익화(애드센스·애드포스트·쇼핑커넥트) 전문 콘텐츠 기획자입니다.
이번 기획 대상 블로그의 주제: ${opts.domain?.trim() || `${brand.name} — ${brand.mission}`}
독자 페르소나:
${Object.entries(PERSONAS).map(([k, p]) => `- ${k} (${p.label}): ${p.description}. 관심사: ${p.needs.join(", ")}`).join("\n")}`,
    prompt: `아래 후보 키워드 중 위 블로그 주제에 맞고 수익성이 높은 것을 골라 블로그 글 기획 ${limit}개를 만들어 주세요.
${personaHint}
- 이 블로그 주제가 AI 도구와 무관하면, 키워드를 억지로 AI 도구 활용법으로 비틀지 마세요. tool 은 빈 문자열로 두고, title·angle 도 이 블로그 주제 그대로 쓰세요.
- keyword 는 반드시 후보 목록의 키워드를 그대로 사용하세요.
- 같은 키워드로 기획을 두 번 만들지 마세요.
- 제목은 검색 키워드를 앞쪽에 두고, 숫자·연도·대상 독자를 활용해 클릭을 유도하되 과장하지 마세요.
- "공식데이터 확인" 키워드를 우선하세요. "미검증" 키워드는 실제로 검색되는지 모르므로 꼭 필요할 때만 고르세요.
- 우선순위 점수는 정렬용 내부 지표일 뿐 수익·트래픽 예측이 아닙니다. rationale 에 수익을 약속하거나 표에 없는 수치를 쓰지 마세요.

후보 키워드:
${table}`,
    schema: IdeaSchema,
    effort: "medium",
    maxTokens: 8000,
    mock: () => ({
      ideas: fresh.slice(0, limit).map((s, i) => {
        const personas = ["OFFICE", "FREELANCER", "SOLO", "GENERAL"] as const;
        const persona = opts.persona && opts.persona !== "ANY" ? opts.persona : personas[i % 4];
        const tool = guessTool(s.metrics.keyword);
        return {
          keyword: s.metrics.keyword,
          title: `${s.metrics.keyword} 완벽 정리 — ${josa(PERSONAS[persona].label, "을/를")} 위한 ${new Date().getFullYear()} 실전 가이드`,
          angle: `${PERSONAS[persona].label}의 ${PERSONAS[persona].needs[i % PERSONAS[persona].needs.length]} 상황에 ${josa(tool, "을/를")} 적용하는 단계별 가이드`,
          persona,
          tool,
          rationale: evidenceSummary(s.metrics, s.scores),
        };
      }),
    }),
  });

  // 5) 저장
  const byKeyword = new Map(fresh.map((s) => [s.metrics.keyword, s]));
  const created = [];
  const seen = new Set<string>();
  for (const idea of ideas) {
    const s = byKeyword.get(idea.keyword) ?? fresh.find((f) => idea.keyword.includes(f.metrics.keyword));
    if (!s || seen.has(s.metrics.keyword)) continue;
    seen.add(s.metrics.keyword);
    created.push(
      await db.topic.create({
        data: {
          keyword: s.metrics.keyword,
          title: idea.title,
          angle: idea.angle,
          persona: idea.persona,
          tool: idea.tool,
          targetPlatform: s.scores.targetPlatform,
          intent: s.scores.intent,
          normalizedKeyword: normalizeKeyword(s.metrics.keyword),
          searchVolume: s.metrics.monthlySearch ?? null,
          documentCount: s.metrics.documentCount ?? null,
          trendScore: s.scores.trendScore,
          competitionScore: s.scores.competitionScore,
          monetizationScore: s.scores.monetizationScore,
          totalScore: s.scores.total,
          confidence: s.scores.confidence,
          verification: s.scores.verification,
          rationale: idea.rationale,
          signals: { ...s.scores, sources: s.metrics.sources, compIdx: s.metrics.compIdx, momentum: s.metrics.momentum },
        },
      }),
    );
  }
  await ctx?.progress(100, `주제 ${created.length}개 저장`);
  return { created: created.length };
}

/** 실제 수집된 지표만 나열한 선정 근거 (없는 수치를 만들지 않음) */
export function evidenceSummary(m: KeywordMetrics, sc: ReturnType<typeof scoreKeyword>): string {
  const parts = [
    VERIFICATION_LABEL[sc.verification],
    m.monthlySearch != null ? `월 검색 ${m.monthlySearch.toLocaleString("ko-KR")}회` : "검색량 미확인",
    m.compIdx ? `광고경쟁 ${m.compIdx}` : null,
    m.documentCount != null ? `블로그 문서 ${m.documentCount.toLocaleString("ko-KR")}건` : null,
    m.momentum != null ? `최근 4주 추이 ${m.momentum >= 1 ? "상승" : "하락"}(${m.momentum.toFixed(2)}배)` : null,
    INTENT_LABEL[sc.intent],
  ].filter(Boolean);
  return `${parts.join(" · ")}. 우선순위 ${sc.total}점(확인 지표 ${sc.confidence}/3, 수익 예측 아님).`;
}

export function guessTool(keyword: string): string {
  const k = keyword.toLowerCase();
  const map: [RegExp, string][] = [
    [/제미나이|gemini/, "Gemini"],
    [/클로드|claude/, "Claude"],
    [/챗gpt|chatgpt|gpt/, "ChatGPT"],
    [/퍼플렉시티|perplexity/, "Perplexity"],
    [/노트북\s?lm|notebooklm/, "NotebookLM"],
    [/코파일럿|copilot/, "Copilot"],
    [/감마|gamma/, "Gamma"],
    [/캔바|canva/, "Canva AI"],
    [/노션|notion/, "Notion AI"],
  ];
  return map.find(([re]) => re.test(k))?.[1] ?? "";
}
