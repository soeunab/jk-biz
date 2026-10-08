import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { getBrand } from "../brand";
import { generateJson } from "../llm";
import type { JobContext } from "../jobs/queue";
import {
  googleAutocomplete,
  googleTrendingKR,
  naverAutocomplete,
  naverBlogDocCount,
  naverRelatedSearch,
  naverTrendProfile,
  type AdKeyword,
} from "./sources";
import { ANSWER_TYPE_LABEL, INTENT_LABEL, normalizeKeyword, scoreKeyword, type KeywordMetrics, type Verification } from "./scoring";
import { adVolumes, containsAny, deeperAutocomplete, isHeadKeyword, longtailScore, seedTokens, volumeOf, type RelatedKeyword } from "./longtail";
import { ymd } from "../util";
import { findTimeForms, fixYearOrder, LIFESPAN_LABEL, lifespanOf, stripTitleNoise, titleRulesText, yearLead } from "./titleRules";
import {
  docRatio,
  filterSameTopic,
  keywordFirst,
  MIN_MONTHLY_SEARCH,
  naverSerpBenchmark,
  shorteningLadder,
  startsWithKeyword,
  TITLE_NUMBER_RULE,
  TITLE_TYPE_GUIDE,
  TITLE_TYPES,
  TitleSchema,
  isFloorVolume,
  mainKeywordOf,
  type SerpBenchmark,
} from "./expand";

export type DiscoverOptions = {
  /** 사용자가 입력한 시드 키워드 — 시드 자체가 주제입니다 (비우면 브랜드 기본 키워드) */
  seeds?: string[];
  limit?: number;
};

const VERIFICATION_RANK: Record<Verification, number> = { VERIFIED: 0, SUGGESTED: 1, UNVERIFIED: 2 };
const VERIFICATION_LABEL: Record<Verification, string> = { VERIFIED: "네이버 공식데이터 확인", SUGGESTED: "자동완성 확인", UNVERIFIED: "미검증" };

/** 자동완성 접속 실패 때만 쓰는 조합용 꼬리말 (실제 검색 여부 미확인) — 독자층 단어(1인 가구·프리랜서 등)는 붙이지 않음 */
const FALLBACK_MODIFIERS = ["사용법", "방법", "비교", "조건", "신청", "정리"];

/**
 * 롱테일 발굴 (제목은 만들지 않음 — 토큰 절약): 1) 시드 → 자동완성·"함께 많이 찾는"으로 실제 검색 문구 수집
 * → 2) 문구마다 검색광고로 실제 월검색량, 월 ${MIN_MONTHLY_SEARCH}회 미만 제외 → 3) 같은 주제·블로그로 답할 수 있는 검색어인지 AI 확인(커뮤니티명 등 제외)
 * → 4) 헤드 키워드 제외, 문서수·트렌드 조회 → 5) 점수화 → 6) 상위 limit 개를 지표·연관 문구와 함께 저장 (개수를 못 채워도 억지로 채우지 않음)
 * 제목 6가지 유형은 사용자가 고른 키워드에서만 generateTitles() 로 만듭니다.
 */
export async function discoverTopics(opts: DiscoverOptions, ctx?: JobContext) {
  const brand = await getBrand();
  const seeds = (opts.seeds?.length ? opts.seeds : brand.seedKeywords).slice(0, 12);
  const limit = opts.limit ?? 15;
  const log = (m: string) => ctx?.log(m);
  const today = ymd(new Date());
  // 시드 단어를 포함하는 문구 = 그 시드에서 뻗어 나온 롱테일 → 주제 관련성 기준
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
  // 1-1) 키워드 줄이기 — '신한은행 유출' → '신한은행' 처럼 줄일수록 연관 검색어가 많아짐. 줄인 키워드의 자동완성·"함께 많이 찾는"도 후보로
  //      (줄인 키워드에서 온 후보는 다른 주제가 섞여 있어, 아래 3-1 에서 같은 주제인지 확인)
  const shortRungs = [...new Set(seeds.flatMap((s) => shorteningLadder(s).slice(1)))].filter((r) => !seeds.some((s) => normalizeKeyword(s) === normalizeKeyword(r)));
  if (networkOk && shortRungs.length) {
    for (const rung of shortRungs.slice(0, 6)) {
      // 네이버 자동완성이 비는 작은 주제('ai 해킹')도 구글 자동완성은 'ai 해킹 사건·은행' 같은 구체적인 문구를 줌
      const [nav, rel, goo] = await Promise.allSettled([naverAutocomplete(rung), naverRelatedSearch(rung), googleAutocomplete(rung)]);
      if (nav.status === "fulfilled") nav.value.forEach((k) => add(k, "naver-ac-short"));
      if (rel.status === "fulfilled") rel.value.forEach((k) => add(k, "naver-related-short"));
      if (goo.status === "fulfilled") goo.value.forEach((k) => add(k, "google-ac-short"));
    }
    await log(`키워드 줄이기: ${shortRungs.slice(0, 6).join(", ")} 로도 연관 검색어 수집`);
  }
  if (!networkOk) {
    await log("자동완성 API 접속 실패 — 시드 키워드 조합을 '미검증' 후보로 추가합니다 (실제 검색 여부 미확인).");
    for (const seed of seeds) for (const m of FALLBACK_MODIFIERS) if (!seed.includes(m)) add(`${seed.split(" ")[0]} ${m}`, "template");
  }
  const trending = await googleTrendingKR().catch(() => []);
  trending.filter((t) => onTopic(t)).forEach((t) => add(t, "google-trends"));
  const countBy = (src: string) => [...sourcesByKeyword.values()].filter((s) => s.has(src)).length;
  await log(
    `후보 문구 ${sourcesByKeyword.size}개 수집 — 네이버 자동완성 ${countBy("naver-ac")} · 구글 자동완성 ${countBy("google-ac")} · 함께 많이 찾는 ${countBy("naver-related")} · 줄인 키워드 ${countBy("naver-ac-short") + countBy("naver-related-short") + countBy("google-ac-short")} · 구글 트렌드 ${countBy("google-trends")}`,
  );
  await ctx?.progress(25);

  // 시드에서 뻗어 나온 문구만 (시드 단어 포함)
  const candidates = [...sourcesByKeyword.keys()].filter((k) => onTopic(k));

  // 2) 네이버 검색광고 — 시드뿐 아니라 후보 문구 하나하나의 실제 월검색량·광고경쟁도.
  //    검색광고가 돌려준 연관 확장 중 시드 단어를 포함하는 롱테일도 후보로 편입합니다.
  let adMap = new Map<string, AdKeyword>();
  try {
    const bySourcePriority = (k: string) => {
      const s = sourcesByKeyword.get(k);
      return s?.has("naver-ac") || s?.has("naver-related") ? 0 : 1;
    };
    adMap = await adVolumes([...seeds, ...shortRungs, ...[...candidates].sort((a, b) => bySourcePriority(a) - bySourcePriority(b))], 200);
    let added = 0;
    for (const [n, a] of adMap) {
      const existed = displayByNorm.has(n);
      if (!existed && !onTopic(a.keyword)) continue;
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

  // 2-1) 월검색량 하한 — 검색광고 데이터가 있으면 월 MIN_MONTHLY_SEARCH 회 미만(바닥값 "< 10" 포함)은 후보에서 뺌
  //      (검색광고 API 가 아예 실패했으면 검색량을 모르므로 거르지 않고 '미검증'으로 둠)
  //      시드(메인 키워드)는 검색량이 적어도 빼지 않음 — 목록에 '검색량 적음'으로 표시
  const isSeed = (k: string) => seeds.some((x) => normalizeKeyword(x) === normalizeKeyword(k));
  if (adMap.size) {
    const before = new Set(candidates).size;
    for (let i = candidates.length - 1; i >= 0; i--) if (!isSeed(candidates[i]) && (volOf(candidates[i]) ?? 0) < MIN_MONTHLY_SEARCH) candidates.splice(i, 1);
    await log(`월검색량 ${MIN_MONTHLY_SEARCH}회 미만 제외: 후보 ${before}개 → ${new Set(candidates).size}개`);
    for (const sd of seeds) {
      const v = volOf(sd);
      if (v == null || v < MIN_MONTHLY_SEARCH) await log(`메인 키워드 '${sd}'는 월검색량 ${v == null ? "미확인" : isFloorVolume(v) ? "10 미만" : `${v}회`}이라 검색 수요가 적어요 — 메인 키워드로는 표시하고, 아래 롱테일에서 수요가 있는 표현을 찾습니다`);
    }
  }

  // 3-1) 롱테일 기준 + 같은 주제 확인
  //  - 롱테일은 메인 키워드(시드 전체 또는 2단어 이상 핵심)를 반드시 포함 ('ai 해킹 공격' → 'ai 해킹 사건' O, 'AI 보안 솔루션' X)
  //  - 메인 키워드가 없는 후보는 같은 주제여도 롱테일이 아니라 원고 연관어로만 — 동의어('인공지능 해킹'),
  //    두 단어 시드의 한 단어 줄임말만 포함한 것('서울 아파트 매매', '신한은행 해킹': AI 가 같은 주제라 해도 메인 키워드가 없음)
  //  - 모든 후보를 AI 가 확인해 커뮤니티명('○○ 더쿠')·다른 주제를 뺌
  const fromFullSeed = (k: string) => [...(sourcesByKeyword.get(k) ?? [])].some((x) => x === "naver-ac" || x === "naver-related" || x === "google-ac" || x === "seed");
  const byVol = (a: string, b: string) => (volOf(b) ?? -1) - (volOf(a) ?? -1);
  const tokenHits = (k: string) => tokens.filter((t) => normalizeKeyword(k).includes(t)).length;
  const strictOf = (k: string) => mainKeywordOf(k, seeds)?.strict === true;
  const uniqCands = [...new Set(candidates)].filter((k) => !isSeed(k));
  const others = uniqCands.filter((k) => !strictOf(k));
  // 확인 순서: 메인 키워드를 포함한 후보 먼저, 나머지는 시드 단어를 많이 포함한 것·줄이지 않은 시드에서 온 것 순
  // ('ai'처럼 너무 넓은 줄임말에서 온 일반 검색어가 진짜 후보를 밀어내지 않게)
  const checkList = [
    ...uniqCands.filter(strictOf).sort(byVol).slice(0, 40),
    ...others.sort((a, b) => tokenHits(b) - tokenHits(a) || Number(fromFullSeed(b)) - Number(fromFullSeed(a)) || byVol(a, b)).slice(0, 40),
  ];
  // 메인 키워드(시드)도 같은 호출에 넣어 질문 유형(AI 내성)을 판정받게 함 — 빠지면 시드만 배율 1.0 이 되어
  // 롱테일(최대 1.14배)보다 불리하게 순위가 매겨지던 문제 (추가 AI 호출 없음, 시드는 원래 항상 통과)
  const allowed = await filterSameTopic(seeds.join(", "), undefined, [...seeds, ...checkList], log);
  const checked = new Set(checkList.map(normalizeKeyword));
  const approved = (k: string) => checked.has(normalizeKeyword(k)) && !!allowed?.has(normalizeKeyword(k));
  // AI 를 못 쓰면 커뮤니티명 등을 거를 수 없지만, 메인 키워드 포함 기준은 그대로
  const longtailOk = (k: string) => isSeed(k) || (strictOf(k) && (allowed ? approved(k) : true));
  const relatedOk = (k: string) => (allowed ? approved(k) : strictOf(k));
  const relatedKeys = [...new Set(candidates)].filter((k) => !isSeed(k) && relatedOk(k));
  {
    const before = new Set(candidates).size;
    for (let i = candidates.length - 1; i >= 0; i--) if (!longtailOk(candidates[i])) candidates.splice(i, 1);
    const synonyms = relatedKeys.filter((k) => !strictOf(k));
    await log(
      `메인 키워드 포함·같은 주제 확인 후 롱테일 후보 ${before}개 → ${new Set(candidates).size}개${synonyms.length ? ` (메인 키워드 없는 같은 주제 표현 ${synonyms.slice(0, 5).join(", ")}는 원고 연관어로만 사용)` : ""}`,
    );
  }

  // 3) 헤드 키워드는 제목 키워드 후보에서 제외 (롱테일이 하나도 없을 때만 남김) → 검색량 많은 순으로 문서수·트렌드 조회
  //    시드(메인 키워드)는 헤드 키워드여도 항상 목록에 포함
  const unique = [...new Set(candidates)];
  const heads = unique.filter((k) => isHeadKeyword(k) && !isSeed(k));
  let pool = unique.filter((k) => !heads.includes(k));
  if (!pool.length) pool = unique;
  else if (heads.length) await log(`헤드 키워드 ${heads.length}개(${heads.slice(0, 5).join(", ")})는 문서가 과포화라 제목 키워드에서 제외 — 롱테일 확장의 출발점으로만 사용`);
  pool = [...pool.filter(isSeed), ...pool.filter((k) => !isSeed(k)).sort(byVol)].slice(0, 80);
  const metered = pool.slice(0, 60);
  const docCounts = new Map<string, number | null>();
  for (const k of metered) {
    docCounts.set(k, await naverBlogDocCount(k).catch(() => null));
  }
  // 1년치 추이 한 번으로 모멘텀(최근 4주)과 수요 성격(상시형·변동형·이슈형)을 함께
  const trend = await naverTrendProfile(metered.slice(0, 40)).catch(() => ({}) as Awaited<ReturnType<typeof naverTrendProfile>>);
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
        monthlyClicks: ad?.monthlyClicks ?? null,
        momentum: trend[keyword]?.momentum ?? null,
        answerType: allowed?.types?.get(normalizeKeyword(keyword)) ?? null,
        sources: [...(sourcesByKeyword.get(keyword) ?? [])],
      };
      return { metrics, scores: scoreKeyword(metrics, affiliateTags) };
    })
    // 공식 데이터로 확인된 키워드 우선, 같은 수준에서는 롱테일 점수(경쟁 60%·검색량 40%) → 우선순위 점수 순
    .sort(
      (a, b) =>
        VERIFICATION_RANK[a.scores.verification] - VERIFICATION_RANK[b.scores.verification] ||
        // AI 내성: 정의·요약형(AI 브리핑이 답하고 끝나는 질의)은 같은 검증 수준 안에서 뒤로
        Number(a.metrics.answerType === "definition") - Number(b.metrics.answerType === "definition") ||
        longtailScore(b.metrics.monthlySearch ?? null, b.scores.competitionScore) - longtailScore(a.metrics.monthlySearch ?? null, a.scores.competitionScore) ||
        b.scores.total - a.scores.total,
    )
    .filter((x, i) => i < Math.max(limit * 2, 20) || isSeed(x.metrics.keyword));

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

  // 4) 저장 — 원고 생성 때 소제목·FAQ 에 녹일 "함께 검색되는 롱테일 문구"도 같이 저장. 제목은 키워드 그대로(제목 만들기 전)
  // 같은 주제 확인을 통과한 후보만 (다른 주제 검색어가 원고 소제목·FAQ 에 섞이지 않게)
  // 연관어: 같은 메인 키워드에서 뻗은 것 + 메인 키워드 없는 같은 주제 표현(시드가 하나일 때만 — 어느 시드인지 알 수 있으므로)
  const mainOf = (k: string) => mainKeywordOf(k, seeds)?.seed ?? (isSeed(k) ? seeds.find((x) => normalizeKeyword(x) === normalizeKeyword(k)) : undefined) ?? (seeds.length === 1 ? seeds[0] : undefined);
  const relatedFor = (kw: string): RelatedKeyword[] => {
    const n = normalizeKeyword(kw);
    const main = mainOf(kw);
    return [...new Set([...relatedKeys, ...candidates])]
      .filter((k) => normalizeKeyword(k) !== n && mainOf(k) === main)
      .sort(byVol)
      .slice(0, 12)
      .map((k) => ({ keyword: k, volume: volOf(k) }));
  };
  const existingSeeds = seeds.filter((sd) => existing.has(normalizeKeyword(sd)));
  if (existingSeeds.length) await log(`메인 키워드 ${existingSeeds.join(", ")}는 이미 주제 목록에 있어 다시 저장하지 않았습니다`);
  // 메인 키워드(시드)는 항상 먼저, 나머지는 점수 순
  const picked = [...fresh.filter((x) => isSeed(x.metrics.keyword)), ...fresh.filter((x) => !isSeed(x.metrics.keyword)).slice(0, limit)];
  for (const s of picked) {
    await db.topic.create({
      data: {
        keyword: s.metrics.keyword,
        title: s.metrics.keyword,
        angle: "",
        persona: "GENERAL",
        tool: guessTool(s.metrics.keyword),
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
        rationale: evidenceSummary(s.metrics, s.scores),
        signals: {
          ...s.scores,
          sources: s.metrics.sources,
          compIdx: s.metrics.compIdx,
          momentum: s.metrics.momentum,
          monthlyClicks: s.metrics.monthlyClicks,
          seasonality: trend[s.metrics.keyword]?.seasonality ?? null,
          related: relatedFor(s.metrics.keyword),
          ratio: docRatio(s.metrics.documentCount, s.metrics.monthlySearch),
          mainKeyword: mainOf(s.metrics.keyword) ?? s.metrics.keyword,
          isMain: isSeed(s.metrics.keyword),
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }
  const longtails = picked.filter((x) => !isSeed(x.metrics.keyword)).length;
  if (longtails < limit) await log(`조건(메인 키워드 포함·월검색량 ${MIN_MONTHLY_SEARCH}회 이상·같은 주제)을 통과한 신규 롱테일이 ${longtails}개라 ${limit}개를 채우지 않았습니다`);
  await ctx?.progress(100, `롱테일 키워드 ${picked.length}개 저장 — 고른 키워드에서 [제목 만들기]`);
  return { created: picked.length };
}

/**
 * 고른 롱테일 키워드 하나에 6가지 유형 제목 (AI 1회, 짧게). 이때만 네이버 상위 글 제목·AI 브리핑을 가져와 벤치마킹.
 * 제목을 바꿔도 검색량·문서수는 키워드 기준이라 그대로입니다.
 */
export async function generateTitles(topicId: string, ctx?: JobContext) {
  const log = (m: string) => ctx?.log(m);
  const topic = await db.topic.findUnique({ where: { id: topicId } });
  // 대기하는 사이 주제를 지웠으면 실패가 아니라 건너뜀 (AI 호출도 하지 않음)
  if (!topic) {
    await log("주제가 삭제되어 제목을 만들지 않았어요");
    return { skipped: "deleted" };
  }
  const kw = topic.keyword;
  const sig = (topic.signals ?? {}) as Record<string, unknown>;
  const related = ((sig.related as RelatedKeyword[] | undefined) ?? []).slice(0, 10);
  const today = ymd(new Date());

  await ctx?.progress(10, "네이버 상위 글·AI 브리핑 확인");
  const benchmark: SerpBenchmark = await naverSerpBenchmark(kw);
  await log(`벤치마킹: 상위 글 ${benchmark.titles.length}개${benchmark.aiBriefing ? " · AI 브리핑" : ""}`);
  const benchmarkBlock =
    benchmark.titles.length || benchmark.aiBriefing
      ? `\n\n[벤치마킹 — 네이버에서 이 키워드로 상위 노출된 글 (형태만 참고, 문장을 베끼지 말 것)]\n${benchmark.titles.slice(0, 8).map((t) => `- ${t}`).join("\n")}${benchmark.aiBriefing ? `\nAI 브리핑 요약: ${benchmark.aiBriefing}` : ""}`
      : "";

  // 시간 표현은 검색량으로 판단 — "2026 근로장려금"처럼 실제로 검색되는 형태(어순 포함)만 제목에 (검색광고, 블로그 검색 API 한도와 별개)
  const timeForms = await findTimeForms(kw).catch(() => []);
  const lifespan = lifespanOf({ origin: topic.origin, seasonality: sig.seasonality as string | null, timeForms });
  await log(`제목 수명: ${LIFESPAN_LABEL[lifespan]}${timeForms.length ? ` · 검색되는 시간 표현 ${timeForms.map((f) => `${f.form}(${f.volume.toLocaleString("ko-KR")})`).join(", ")}` : " · 연도·회차를 붙여 검색하는 형태 없음"}`);

  await ctx?.progress(40, "제목 6가지 유형 작성");
  const out = await generateJson({
    name: "topicTitles",
    task: "light",
    title: `제목 만들기 (${kw})`,
    system: `당신은 한국 블로그 제목을 쓰는 편집자입니다. 키워드 자체가 글의 주제입니다. 독자층(1인 가구·프리랜서·직장인 등)을 임의로 정해 제목에 붙이지 마세요.`,
    prompt: `키워드: ${kw}
오늘 날짜: ${today}
연관 검색어(월검색량): ${related.length ? related.map((r) => `${r.keyword}(${r.volume ?? "미확인"})`).join(", ") : "없음"}

[제목 — 6가지 유형으로 하나씩]
- 모든 제목은 키워드를 형태 변형 없이(띄어쓰기·조사 붙이지 말고) 맨 왼쪽에 두세요. 네이버는 키워드의 형태적 일치를 중시합니다.
- 키워드 뒤에는 연관 검색어에서 온 말(예: 전망, 추이, 확인방법)을 1개까지 자연스러운 문장으로 이어 붙여도 됩니다. 키워드와 뜻이 겹치는 말을 반복하거나(예: '서울 아파트 가격 아파트값 상승률') 검색어를 나열하지 마세요. 사람이 읽어 어색하면 붙이지 마세요.
- 유형별 쓰는 법 (예시는 다른 주제의 형태 참고용):
${TITLE_TYPES.map((t) => `  · ${t}: ${TITLE_TYPE_GUIDE[t]}`).join("\n")}
- bestType 에는 이 키워드의 검색 의도에 가장 맞는 유형을 고르세요.
- ${TITLE_NUMBER_RULE}
${titleRulesText({ keyword: kw, lifespan, timeForms, today })}
- angle 에는 상위 글과 다르게 쓸 관점·구성을 한 줄로.${benchmarkBlock}`,
    schema: TitleSchema,
    effort: "low",
    maxTokens: 1500,
    mock: () => ({
      titles: [
        { type: "정보형" as const, title: `${kw} 핵심 정리, 확인 방법과 순서` },
        { type: "궁금증형" as const, title: `${kw}, 지금 꼭 알아야 할 것은?` },
        { type: "행동형" as const, title: `${kw} 바로 확인하는 방법` },
      ],
      bestType: "정보형" as const,
      angle: `${kw} 핵심만 단계별로 정리`,
    }),
  });

  // 모든 유형의 제목이 키워드로 시작하도록 (AI 가 어기면 코드가 키워드를 맨 왼쪽으로 옮김)
  let fixed = 0;
  const titleOptions = out.titles.map((t) => {
    const clean = stripTitleNoise(t.title, kw);
    // 검색되는 연도 형태("2026 근로장려금 신청")로 시작하면 그대로, 아니면 키워드를 맨 앞으로 → 연도 어순 바로잡기
    const lead = yearLead(kw, timeForms);
    if (lead && startsWithKeyword(clean, lead)) return { type: t.type, title: clean };
    if (!startsWithKeyword(clean, kw)) fixed++;
    return { type: t.type, title: fixYearOrder(keywordFirst(clean, kw), kw, timeForms) };
  });
  if (fixed) await log(`키워드가 맨 왼쪽에 없던 제목 ${fixed}개는 키워드를 맨 앞으로 옮겼습니다`);
  const title = (titleOptions.find((t) => t.type === out.bestType) ?? titleOptions[0])?.title ?? kw;
  // 제목을 만드는 사이 주제를 지웠으면 저장하지 않고 끝냄 (update 는 없는 행에서 오류를 내므로 updateMany)
  const saved = await db.topic.updateMany({
    where: { id: topicId },
    data: {
      title,
      angle: out.angle,
      signals: { ...sig, titleOptions, bestType: out.bestType, benchmark, timeForms, lifespan, titleLocked: false } as unknown as Prisma.InputJsonValue,
    },
  });
  if (!saved.count) {
    await log("제목을 만드는 사이 주제가 삭제되어 저장하지 않았어요");
    return { skipped: "deleted" };
  }
  await ctx?.progress(100, `제목 ${titleOptions.length}개 작성`);
  return { titles: titleOptions.length };
}

/** 실제 수집된 지표만 나열한 선정 근거 (없는 수치를 만들지 않음) */
export function evidenceSummary(m: KeywordMetrics, sc: ReturnType<typeof scoreKeyword>): string {
  const parts = [
    VERIFICATION_LABEL[sc.verification],
    m.monthlySearch != null ? `월 검색 ${m.monthlySearch.toLocaleString("ko-KR")}회` : "검색량 미확인",
    m.compIdx ? `광고경쟁 ${m.compIdx}` : null,
    m.monthlyClicks ? `월 광고클릭 ${Math.round(m.monthlyClicks).toLocaleString("ko-KR")}회` : null,
    m.documentCount != null ? `블로그 문서 ${m.documentCount.toLocaleString("ko-KR")}건` : null,
    m.momentum != null ? `최근 4주 추이 ${m.momentum >= 1 ? "상승" : "하락"}(${m.momentum.toFixed(2)}배)` : null,
    INTENT_LABEL[sc.intent],
    sc.answerType ? `${ANSWER_TYPE_LABEL[sc.answerType]}(AI 내성 ${sc.aiResistance})` : null,
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
