import type { Prisma } from "@prisma/client";
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
  naverRelatedSearch,
  naverTrendMomentum,
  type AdKeyword,
} from "./sources";
import { INTENT_LABEL, normalizeKeyword, relevance, scoreKeyword, type KeywordMetrics, type Verification } from "./scoring";
import { adVolumes, containsAll, containsAny, coreOf, deeperAutocomplete, ensureKeywordInTitle, isHeadKeyword, longtailScore, seedTokens, volumeOf, type RelatedKeyword } from "./longtail";
import { josa, ymd } from "../util";

export type DiscoverOptions = {
  seeds?: string[];
  platform?: "NAVER" | "BLOGGER" | "BOTH";
  persona?: Persona | "ANY";
  limit?: number;
  /** 이번 발굴 묶음의 주제 도메인 (예: "경제·생활 혜택 정보, AI 도구와 무관"). 비우면 브랜드 미션을 그대로 씀 — 브랜드와 다른 콘셉트의 계정을 위해 시드를 따로 줄 때 사용 */
  domain?: string;
};

const VERIFICATION_RANK: Record<Verification, number> = { VERIFIED: 0, SUGGESTED: 1, UNVERIFIED: 2 };
const VERIFICATION_LABEL: Record<Verification, string> = { VERIFIED: "네이버 공식데이터 확인", SUGGESTED: "자동완성 확인", UNVERIFIED: "미검증" };

const PERSONA_MODIFIERS = ["사용법", "무료", "활용법", "프롬프트", "업무", "보고서", "직장인", "프리랜서", "1인 가구", "비교"];

const SOURCE_LABEL: Record<string, string> = {
  seed: "시드",
  "naver-ac": "네이버 자동완성",
  "google-ac": "구글 자동완성",
  "naver-related": "함께 많이 찾는",
  "naver-searchad": "검색광고 연관",
  "google-trends": "구글 트렌드",
  template: "조합(미검증)",
};

export const IdeaSchema = z.object({
  ideas: z.array(
    z.object({
      keyword: z.string().describe("후보 목록의 롱테일 키워드를 글자 그대로 (구체적인 2단어 이상 문구 우선)"),
      title: z.string().describe("keyword 를 형태 변형 없이 맨 앞에 넣은 블로그 제목, 32자 내외"),
      angle: z.string().describe("차별화 관점·구성 한 줄"),
      persona: z.enum(["SOLO", "FREELANCER", "OFFICE", "GENERAL"]),
      tool: z.string().describe("이 글이 실제로 다루는 AI 도구 이름. 주제가 AI 도구 활용과 무관하면 빈 문자열(\"\")로 두세요 — 억지로 AI 도구를 끼워 넣지 마세요"),
      rationale: z.string().describe("선정 이유 1~2문장 — 후보 표에 주어진 지표만 근거로 인용. 표에 없는 수치·수익 예측 금지, 미확인 지표는 미확인이라고 쓸 것"),
    }),
  ),
});

/**
 * 롱테일 발굴: 1) 시드 → 자동완성·"함께 많이 찾는"으로 실제 검색 문구 수집 → 2) 문구마다 검색광고로 실제 월검색량
 * → 3) 헤드 키워드(ai·클로드처럼 과포화된 짧은 단어) 제외, 검색량 순으로 문서수·트렌드 조회 → 4) 점수화
 * → 5) AI 가 후보 롱테일 중에서 골라 제목 맨 앞에 그대로 넣어 기획 → 6) 연관 롱테일 문구와 함께 저장(원고 생성에 사용)
 */
export async function discoverTopics(opts: DiscoverOptions, ctx?: JobContext) {
  const brand = await getBrand();
  const seeds = (opts.seeds?.length ? opts.seeds : brand.seedKeywords).slice(0, 12);
  const limit = opts.limit ?? 15;
  const log = (m: string) => ctx?.log(m);
  const today = ymd(new Date());
  // 계정 도메인을 따로 주면 AI 도구 관련 여부로 관련성을 판단하지 않음 — AI 도구와 무관한 계정의 후보가
  // AI_TERMS 가 없다는 이유로 걸러지거나 총점이 깎이지 않도록 (브랜드 미션 기준일 때만 AI 관련성 사용)
  const domainNeutral = !!opts.domain?.trim();
  // 시드 단어를 포함하는 문구 = 그 시드에서 뻗어 나온 롱테일 → 주제 관련성의 1차 기준
  const tokens = seedTokens(seeds);
  const onTopic = (k: string) => containsAny(k, tokens);

  // 1) 후보 문구 수집 (자동완성·"함께 많이 찾는"은 "실제로 검색되는 문구" 후보용, 수요 검증은 검색광고 공식 데이터로)
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
    const [nav, goo, rel] = await Promise.allSettled([naverAutocomplete(seed), googleAutocomplete(seed), naverRelatedSearch(seed)]);
    if (nav.status === "fulfilled") {
      nav.value.forEach((k) => add(k, "naver-ac"));
      // 인기 자동완성 상위 문구에 한 번 더 자동완성 → 한 단계 더 구체적인(경쟁이 덜한) 롱테일
      (await deeperAutocomplete(nav.value.filter((k) => normalizeKeyword(k) !== normalizeKeyword(seed)), 3)).forEach((k) => add(k, "naver-ac"));
    }
    if (goo.status === "fulfilled") goo.value.forEach((k) => add(k, "google-ac"));
    if (rel.status === "fulfilled") rel.value.forEach((k) => add(k, "naver-related"));
    if (nav.status === "rejected" && goo.status === "rejected") networkOk = false;
  }
  if (!networkOk) {
    await log("자동완성 API 접속 실패 — 시드 키워드 조합을 '미검증' 후보로 추가합니다 (실제 검색 여부 미확인).");
    for (const seed of seeds) for (const m of PERSONA_MODIFIERS) if (!seed.includes(m)) add(`${seed.split(" ")[0]} ${m}`, "template");
  }
  const trending = await googleTrendingKR().catch(() => []);
  trending.filter((t) => onTopic(t) || relevance(t, domainNeutral) >= 60).forEach((t) => add(t, "google-trends"));
  const countBy = (src: string) => [...sourcesByKeyword.values()].filter((s) => s.has(src)).length;
  await log(
    `후보 문구 ${sourcesByKeyword.size}개 수집 — 네이버 자동완성 ${countBy("naver-ac")} · 구글 자동완성 ${countBy("google-ac")} · 함께 많이 찾는 ${countBy("naver-related")} · 구글 트렌드 ${countBy("google-trends")}`,
  );
  await ctx?.progress(25);

  // 시드에서 뻗어 나온 문구이거나 브랜드 주제와 관련 있는 것만
  const candidates = [...sourcesByKeyword.keys()].filter((k) => onTopic(k) || relevance(k, domainNeutral) >= 40);

  // 2) 네이버 검색광고 — 시드뿐 아니라 후보 문구 하나하나의 실제 월검색량·광고경쟁도.
  //    검색광고가 돌려준 연관 확장 중 시드 단어를 포함하는 롱테일도 후보로 편입합니다.
  let adMap = new Map<string, AdKeyword>();
  try {
    const bySourcePriority = (k: string) => {
      const s = sourcesByKeyword.get(k);
      return s?.has("naver-ac") || s?.has("naver-related") ? 0 : 1;
    };
    adMap = await adVolumes([...seeds, ...[...candidates].sort((a, b) => bySourcePriority(a) - bySourcePriority(b))], 200);
    let added = 0;
    for (const [n, a] of adMap) {
      const existed = displayByNorm.has(n);
      if (!existed && !onTopic(a.keyword) && relevance(a.keyword, domainNeutral) < 60) continue;
      add(a.keyword, "naver-searchad");
      const d = displayByNorm.get(n);
      if (!existed && d) {
        candidates.push(d);
        added++;
      }
    }
    const measured = candidates.filter((k) => adMap.has(normalizeKeyword(k))).length;
    await log(`네이버 검색광고: 후보 ${candidates.length}개 중 ${measured}개 실제 월검색량 확인 (검색광고 연관 롱테일 ${added}개 추가)`);
  } catch (e) {
    await log(`검색광고 API 오류: ${(e as Error).message}`);
  }
  const volOf = (k: string) => volumeOf(adMap.get(normalizeKeyword(k)));

  // 3) 헤드 키워드는 제목 키워드 후보에서 제외 (롱테일이 하나도 없을 때만 남김) → 검색량 많은 순으로 문서수·트렌드 조회
  const unique = [...new Set(candidates)];
  const heads = unique.filter(isHeadKeyword);
  let pool = unique.filter((k) => !isHeadKeyword(k));
  if (!pool.length) pool = unique;
  else if (heads.length) await log(`헤드 키워드 ${heads.length}개(${heads.slice(0, 5).join(", ")})는 문서가 과포화라 제목 키워드에서 제외 — 롱테일 확장의 출발점으로만 사용`);
  pool = pool.sort((a, b) => (volOf(b) ?? -1) - (volOf(a) ?? -1)).slice(0, 80);
  const metered = pool.slice(0, 60);
  const docCounts = new Map<string, number | null>();
  for (const k of metered) {
    docCounts.set(k, await naverBlogDocCount(k).catch(() => null));
  }
  const momentum = await naverTrendMomentum(metered.slice(0, 40)).catch(() => ({}) as Record<string, number>);
  await ctx?.progress(50, `검색량·문서수·트렌드 지표 수집 완료 (롱테일 후보 ${pool.length}개)`);

  const affiliateTags = (await db.affiliateProduct.findMany({ where: { active: true }, select: { tags: true } }))
    .flatMap((p) => p.tags.split(","))
    .map((t) => t.trim())
    .filter(Boolean);

  const scored = pool
    .map((keyword) => {
      const ad = adMap.get(normalizeKeyword(keyword));
      const metrics: KeywordMetrics = {
        keyword,
        monthlySearch: volumeOf(ad),
        documentCount: docCounts.get(keyword) ?? null,
        compIdx: ad?.compIdx ?? null,
        adDepth: ad?.adDepth ?? null,
        momentum: (momentum as Record<string, number>)[keyword] ?? null,
        sources: [...(sourcesByKeyword.get(keyword) ?? [])],
      };
      return { metrics, scores: scoreKeyword(metrics, affiliateTags, domainNeutral) };
    })
    .filter((s) => opts.platform === undefined || opts.platform === "BOTH" || s.scores.targetPlatform !== (opts.platform === "NAVER" ? "BLOGGER" : "NAVER"))
    // 공식 데이터로 확인된 키워드 우선, 같은 수준에서는 롱테일 점수(경쟁 60%·검색량 40%) → 우선순위 점수 순
    .sort(
      (a, b) =>
        VERIFICATION_RANK[a.scores.verification] - VERIFICATION_RANK[b.scores.verification] ||
        longtailScore(b.metrics.monthlySearch ?? null, b.scores.competitionScore) - longtailScore(a.metrics.monthlySearch ?? null, a.scores.competitionScore) ||
        b.scores.total - a.scores.total,
    )
    .slice(0, Math.max(limit * 2, 20));

  // 이미 다룬 키워드는 제외하고, 한 AI 도구에 쏠리지 않도록 도구별 상한을 둡니다 (AI 도구와 무관한 키워드는 상한 없음).
  const existing = new Set((await db.topic.findMany({ select: { keyword: true } })).map((t) => normalizeKeyword(t.keyword)));
  const perTool = new Map<string, number>();
  const cap = Math.max(2, Math.ceil(limit / 3));
  const fresh = scored.filter((s) => {
    if (existing.has(normalizeKeyword(s.metrics.keyword))) return false;
    const tool = guessTool(s.metrics.keyword);
    if (!tool) return true;
    perTool.set(tool, (perTool.get(tool) ?? 0) + 1);
    return perTool.get(tool)! <= cap;
  });
  await ctx?.progress(60, `점수화 완료 — 신규 롱테일 후보 ${fresh.length}개`);

  // 4) AI 기획: 후보 롱테일 중에서 골라 블로그 주제에 맞는 글 기획으로 변환
  const personaHint =
    opts.persona && opts.persona !== "ANY" ? `이번에는 "${PERSONAS[opts.persona].label}" 독자를 우선하세요.` : "1인 가구·프리랜서·직장인을 고르게 섞으세요.";
  const saturation = (m: KeywordMetrics) =>
    m.documentCount != null && m.monthlySearch ? `${(m.documentCount / m.monthlySearch).toFixed(1)}배` : "미확인";
  const table = fresh
    .map(
      (s) =>
        `- ${s.metrics.keyword} | ${VERIFICATION_LABEL[s.scores.verification]} | 월검색 ${s.metrics.monthlySearch ?? "미확인"} | 문서수 ${s.metrics.documentCount ?? "미확인"} | 경쟁점수 ${s.scores.competitionScore ?? "미확인"}(문서/검색 ${saturation(s.metrics)}) | 광고경쟁 ${s.metrics.compIdx ?? "미확인"} | 롱테일점수 ${longtailScore(s.metrics.monthlySearch ?? null, s.scores.competitionScore)} | 우선순위 ${s.scores.total} | ${INTENT_LABEL[s.scores.intent]} | 출처 ${s.metrics.sources.map((x) => SOURCE_LABEL[x] ?? x).join("·")}`,
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
    prompt: `아래 후보는 실제로 사람들이 검색하는 롱테일 문구(자동완성·"함께 많이 찾는"·검색광고 연관)와 네이버 공식 지표입니다.
이 중 위 블로그 주제에 맞고 상위 노출 가능성이 높은 것을 골라 블로그 글 기획 ${limit}개를 만들어 주세요.
오늘 날짜: ${today}
${personaHint}
[키워드 선택 — 상위 노출·트래픽이 목적]
- keyword 는 반드시 후보 목록의 문구를 글자 그대로 쓰세요(새로 만들거나 줄이지 말 것).
- 검색량이 적당하고(월 수백~수만) 경쟁점수가 높은(문서/검색 배수가 낮은) 구체적인 문구를 우선하세요. 경쟁점수 0~20 은 검색량이 커도 이미 문서가 넘쳐 신생 블로그가 상위 노출되기 어려우니 다른 후보가 있으면 피하세요.
- "네이버 공식데이터 확인" 키워드를 우선하세요. "미검증" 키워드는 실제로 검색되는지 모르므로 꼭 필요할 때만 고르세요.
- 같은 키워드로 기획을 두 번 만들지 마세요.
[제목]
- 제목은 keyword 를 형태 변형 없이(띄어쓰기·조사 붙이지 말고) 맨 앞에 두세요. 네이버는 키워드의 형태적 일치를 중시합니다.
- 뒤쪽에는 같은 주제의 다른 후보 문구를 1개 자연스럽게 섞으면 여러 롱테일에 함께 노출될 수 있습니다(억지 나열 금지).
- 연도를 쓰려면 오늘 날짜 기준 연도(${today.slice(0, 4)}년)만 쓰세요. 지난 연도를 최신인 것처럼 쓰지 마세요.
- 숫자·대상 독자를 활용해 클릭을 유도하되 과장하지 마세요.
[기타]
- 이 블로그 주제가 AI 도구와 무관하면, 키워드를 억지로 AI 도구 활용법으로 비틀지 마세요. tool 은 빈 문자열로 두고, title·angle 도 이 블로그 주제 그대로 쓰세요.
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

  // 5) 저장 — 원고 생성 때 참고할 "함께 검색되는 같은 이야기의 롱테일 문구"도 같이 저장
  const allKeys = [...sourcesByKeyword.keys()];
  const relatedFor = (kw: string): RelatedKeyword[] => {
    const n = normalizeKeyword(kw);
    const own = coreOf(tokens.filter((t) => n.includes(t)));
    if (!own.length) return [];
    // 이 키워드가 가진 시드 핵심 토큰을 모두 포함한 문구만 (하나만 겹치는 다른 이야기는 제외)
    return allKeys
      .filter((k) => normalizeKeyword(k) !== n && containsAll(k, own))
      .sort((a, b) => (volOf(b) ?? -1) - (volOf(a) ?? -1))
      .slice(0, 12)
      .map((k) => ({ keyword: k, volume: volOf(k) }));
  };
  const byNorm = new Map(fresh.map((s) => [normalizeKeyword(s.metrics.keyword), s]));
  const created = [];
  const seen = new Set<string>();
  let fixedTitles = 0;
  for (const idea of ideas) {
    // AI 가 띄어쓰기만 바꿔 적어도 같은 후보로 인정, 후보 밖 키워드는 버림 (지표 없는 키워드를 새로 만들지 않도록)
    const s = byNorm.get(normalizeKeyword(idea.keyword));
    if (!s || seen.has(s.metrics.keyword)) continue;
    seen.add(s.metrics.keyword);
    const title = ensureKeywordInTitle(idea.title, s.metrics.keyword);
    if (title !== idea.title.trim()) fixedTitles++;
    created.push(
      await db.topic.create({
        data: {
          keyword: s.metrics.keyword,
          title,
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
          signals: {
            ...s.scores,
            sources: s.metrics.sources,
            compIdx: s.metrics.compIdx,
            momentum: s.metrics.momentum,
            related: relatedFor(s.metrics.keyword),
          } as unknown as Prisma.InputJsonValue,
        },
      }),
    );
  }
  if (fixedTitles) await log(`제목에 핵심 키워드가 그대로 없던 ${fixedTitles}개는 키워드를 제목 앞에 붙였습니다`);
  const dropped = ideas.length - created.length;
  if (dropped > 0) await log(`AI 가 후보 목록에 없는 키워드를 쓰거나 중복한 기획 ${dropped}개는 저장하지 않았습니다`);
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
