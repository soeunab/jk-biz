/**
 * 롱테일 키워드 공통 로직 — 검색어 기반 발굴·실시간 트렌드 발굴·키워드로 바로 원고 만들기·원고 생성이 함께 씁니다.
 *
 * 왜: "ai"·"클로드"처럼 짧은 헤드 키워드는 검색량은 크지만 문서가 수백만 건이라 신생 블로그가 상위 노출되기 어렵습니다.
 * 실제로 사람들이 치는 구체적인 문구(자동완성·"함께 많이 찾는")를 후보로 모으고, 문구마다 네이버 공식 데이터로
 * 검색량·문서수를 재서 "검색은 되는데 경쟁이 덜한" 롱테일을 제목의 핵심 키워드로 씁니다.
 * 숫자는 전부 네이버 검색광고·검색 API 값이고, 후보 문구 수집(자동완성·화면)은 숫자를 만들지 않습니다.
 */
import { naverAutocomplete, naverBlogDocCount, naverRelatedSearch, naverSearchAdKeywords, type AdKeyword } from "./sources";
import { competitionScore, normalizeKeyword, volumeScore } from "./scoring";

/** 헤드 키워드: 띄어쓰기 없는 4글자 이하 (ai·클로드·연말정산·삼성전자) — 제목 핵심 키워드로 쓰지 않고 롱테일 확장의 출발점으로만 씀 */
export function isHeadKeyword(k: string): boolean {
  return !/\s/.test(k.trim()) && normalizeKeyword(k).length <= 4;
}

/** 시드에서 주제 판단용 토큰 (2글자 이상) */
export function seedTokens(seeds: string[]): string[] {
  return [...new Set(seeds.flatMap((s) => s.split(/\s+/)).map(normalizeKeyword).filter((t) => t.length >= 2))];
}

export function containsAny(k: string, tokens: string[]): boolean {
  const n = normalizeKeyword(k);
  return tokens.some((t) => n.includes(t));
}

export const volumeOf = (a?: AdKeyword | null): number | null => (a ? a.monthlyPc + a.monthlyMobile : null);

/** 후보 문구들의 실제 월검색량 (검색광고). 결과에는 힌트 자신과 검색광고가 돌려준 연관 확장이 함께 들어 있음 */
export async function adVolumes(hints: string[], max = 120): Promise<Map<string, AdKeyword>> {
  const seen = new Set<string>();
  const uniq = hints.filter((h) => {
    const n = normalizeKeyword(h);
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  const map = new Map<string, AdKeyword>();
  for (const a of await naverSearchAdKeywords(uniq.slice(0, max))) {
    const n = normalizeKeyword(a.keyword);
    if (!map.has(n)) map.set(n, a);
  }
  return map;
}

export type LongtailCandidate = {
  keyword: string;
  sources: string[];
  /** 월 검색량 (PC+모바일). null = 네이버 검색광고에 데이터 없음 */
  volume: number | null;
  compIdx: string | null;
  documentCount: number | null;
  /** 0~100, 문서수÷검색량 포화도가 낮을수록 높음. null = 미확인 */
  competitionScore: number | null;
  /** 롱테일 선택용 내부 점수 (수익·트래픽 예측 아님) */
  score: number;
};

export type RelatedKeyword = { keyword: string; volume: number | null };

export type LongtailResult = {
  base: string;
  /** 제목 핵심 키워드로 쓸 최적 롱테일 (헤드 키워드 제외, 실제 검색량 확인된 것 중). 없으면 null */
  best: LongtailCandidate | null;
  candidates: LongtailCandidate[];
  /** 원고 소제목·FAQ 에 녹일 함께 검색되는 문구 (best 제외, 검색량 순) */
  related: RelatedKeyword[];
};

/** 자동완성 결과(인기순) 상위 문구에 다시 자동완성을 돌려 한 단계 더 구체적인 롱테일을 얻습니다 (키 불필요, 가벼운 호출) */
export async function deeperAutocomplete(phrases: string[], top = 5): Promise<string[]> {
  const out: string[] = [];
  for (const p of phrases.slice(0, top)) out.push(...(await naverAutocomplete(p).catch(() => [] as string[])));
  return out;
}

/**
 * 키워드 하나를 롱테일로 확장합니다: 자동완성(2단계) + "함께 많이 찾는" → 검색광고로 문구별 실제 검색량
 * → 검색량이 확인된 롱테일부터 문서수(경쟁) 측정.
 * network=false 면(픽스처·오프라인) 아무것도 조회하지 않고 base 만 돌려줍니다.
 */
export async function expandKeyword(base: string, opts: { network?: boolean; relatedSearch?: boolean; docs?: number } = {}): Promise<LongtailResult> {
  const network = opts.network ?? true;
  const tokens = seedTokens([base]);
  const cands = new Map<string, { keyword: string; sources: Set<string> }>();
  const add = (k: string, src: string) => {
    const text = k.trim().replace(/\s+/g, " ");
    if (text.length < 2 || text.length > 40) return;
    const n = normalizeKeyword(text);
    const e = cands.get(n) ?? { keyword: text, sources: new Set<string>() };
    e.sources.add(src);
    cands.set(n, e);
  };
  add(base, "seed");
  let ad = new Map<string, AdKeyword>();
  if (network) {
    const [nav, rel] = await Promise.all([
      naverAutocomplete(base).catch(() => [] as string[]),
      opts.relatedSearch === false ? Promise.resolve([] as string[]) : naverRelatedSearch(base).catch(() => [] as string[]),
    ]);
    nav.forEach((k) => add(k, "naver-ac"));
    rel.forEach((k) => add(k, "naver-related"));
    (await deeperAutocomplete(nav.filter((k) => normalizeKeyword(k) !== normalizeKeyword(base)))).forEach((k) => add(k, "naver-ac"));
    ad = await adVolumes([...cands.values()].map((c) => c.keyword)).catch(() => new Map<string, AdKeyword>());
    // 검색광고 연관 확장 중 기준 키워드를 포함하는 문구도 롱테일 후보로
    for (const a of ad.values()) if (containsAny(a.keyword, tokens)) add(a.keyword, "naver-searchad");
  }
  const list = [...cands.entries()]
    .filter(([, c]) => c.sources.has("seed") || containsAny(c.keyword, tokens))
    .map(([n, c]) => ({ n, c, volume: volumeOf(ad.get(n)) }))
    .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));

  // 문서수(경쟁)는 제목 키워드가 될 수 있는 문구 — 헤드 키워드가 아니고 검색량이 확인된 것 — 부터 잽니다
  const docLimit = network ? (opts.docs ?? 15) : 0;
  const measureSet = new Set(
    list
      .filter(({ c, volume }) => volume != null && volume >= 10 && !isHeadKeyword(c.keyword))
      .slice(0, docLimit)
      .map(({ n }) => n),
  );
  const candidates: LongtailCandidate[] = [];
  for (const { n, c, volume } of list) {
    const a = ad.get(n);
    const docs = measureSet.has(n) ? await naverBlogDocCount(c.keyword).catch(() => null) : null;
    const cs = competitionScore(docs, volume);
    candidates.push({
      keyword: c.keyword,
      sources: [...c.sources],
      volume,
      compIdx: a?.compIdx ?? null,
      documentCount: docs,
      competitionScore: cs,
      score: longtailScore(volume, cs),
    });
  }
  const best = pickLongtail(candidates);
  const related = candidates
    .filter((c) => c.keyword !== best?.keyword)
    .slice(0, 12)
    .map((c) => ({ keyword: c.keyword, volume: c.volume }));
  return { base, best, candidates: candidates.slice(0, 20), related };
}

/**
 * 롱테일 선택용 점수 (0~100, 내부 정렬용 — 수익·트래픽 예측 아님).
 * 상위 노출 가능성이 목적이라 경쟁(문서수÷검색량 포화도) 60%, 검색량 40%. 경쟁 미확인은 중간값 40 으로 봅니다.
 */
export function longtailScore(volume: number | null, cs: number | null): number {
  return Math.round((volumeScore(volume) ?? 0) * 0.4 + (cs ?? 40) * 0.6);
}

/**
 * 헤드 키워드를 빼고, 실제 검색량(월 10회 이상)이 확인된 문구 중 점수가 가장 높은 롱테일.
 * 경쟁(문서수)을 잰 문구가 하나라도 있으면 잰 것 중에서만 고릅니다 — 안 잰 문구가 경쟁 감점을 피해 뽑히지 않도록.
 */
export function pickLongtail(candidates: LongtailCandidate[]): LongtailCandidate | null {
  const eligible = candidates.filter((c) => !isHeadKeyword(c.keyword) && c.volume != null && c.volume >= 10);
  const measured = eligible.filter((c) => c.competitionScore != null);
  return [...(measured.length ? measured : eligible)].sort((a, b) => b.score - a.score || (b.volume ?? 0) - (a.volume ?? 0))[0] ?? null;
}

/** Topic.signals 에 저장된 연관 롱테일 문구 */
export function relatedOf(signals: unknown): RelatedKeyword[] | null {
  const r = (signals as { related?: unknown } | null)?.related;
  if (!Array.isArray(r)) return null;
  const out = r
    .map((x) => (typeof x === "string" ? { keyword: x, volume: null } : (x as RelatedKeyword)))
    .filter((x) => x && typeof x.keyword === "string" && x.keyword.trim());
  return out.length ? out : null;
}

/** 제목에 핵심 키워드가 형태 그대로(띄어쓰기 무시) 들어 있지 않으면 앞에 붙입니다 */
export function ensureKeywordInTitle(title: string, keyword: string): string {
  const t = title.trim();
  if (!t) return keyword;
  return normalizeKeyword(t).includes(normalizeKeyword(keyword)) ? t : `${keyword}, ${t}`;
}
