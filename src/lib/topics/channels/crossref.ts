/**
 * 교차검증: 서로 다른 채널의 항목을 '같은 소재' 그룹으로 묶습니다 (원본: reference/contents-finder/finder/analysis/crossref.py).
 * 시드(깨끗한 키워드 우선)를 기준으로 그룹을 만들고, 제목 토큰이 겹치는 항목을 붙입니다.
 * 연쇄 결합(체이닝)을 막기 위해 '그룹 핵심 토큰'(처음 3개 멤버까지의 토큰)과만 비교합니다.
 */
import { norm, tokens } from "./text";
import type { ChannelItem } from "./types";
import type { Flags } from "./filters";

/** 시드 우선순위 (낮을수록 먼저 시드가 됨) — "채널|세부출처" 또는 "채널|*" */
const SEED_PRIORITY: Record<string, number> = {
  "google_trends|*": 0,
  "nate|네이트 실시간 이슈 키워드": 1,
  "daum|다음 실시간 트렌드": 1,
  "naver_ranking|*": 2,
  "naver_home|*": 3,
  "nate|*": 4,
  "daum|*": 5,
  "google_news|*": 6,
};

function priority(it: ChannelItem): number {
  return SEED_PRIORITY[`${it.channel}|${it.source}`] ?? SEED_PRIORITY[`${it.channel}|*`] ?? 9;
}

export type GroupMetrics = {
  channels: string[];
  trendPct: number | null;
  trendStartedMin: number | null;
  trendVolume: number | null;
  trendFresh: boolean;
  newestAge: number | null;
  naverBestRank: number | null;
  naverMaxViews: number | null;
  homeHit: boolean;
  pressHits: number;
  pressBestRank: number | null;
  headlineHits: number;
  nateRank: number | null;
  nateChange: unknown;
  nateNewsHit: boolean;
  gnewsCluster: number | null;
  daumCount: number;
  daumTrendRank: number | null;
  preempt?: boolean;
};

export type Group = {
  id: number;
  /** 시드 항목의 제목 (구글 트렌드·실시간 키워드가 있으면 그 키워드) */
  label: string;
  items: ChannelItem[];
  core: Set<string>;
  seedNorm: string;
  memberNorms: string[];
  metrics?: GroupMetrics;
  score: number;
  reasons: string[];
  category: string;
  flags?: Flags;
  excludedReason: string;
};

export function groupChannels(g: Group): Set<string> {
  return new Set(g.items.map((i) => i.channel));
}

function itemTokens(it: ChannelItem): Set<string> {
  const toks = tokens(it.title);
  if (it.channel === "google_trends") {
    for (const r of (it.extra?.related as string[] | undefined) ?? []) for (const t of tokens(r)) toks.add(t);
  }
  return toks;
}

export function buildGroups(items: ChannelItem[], threshold = 1.6): Group[] {
  // 커뮤니티 글(네이트 판)과 보조 항목(홈판 쇼츠·영상)은 소재 판별에서 제외
  const pool = items.filter((i) => !i.extra?.community && !i.extra?.supplementary);
  const toks = new Map(pool.map((i) => [i, itemTokens(i)] as const));
  const df = new Map<string, number>();
  for (const i of pool) for (const t of toks.get(i)!) df.set(t, (df.get(t) ?? 0) + 1);

  const weight = (t: string) => {
    const n = df.get(t) ?? 0;
    if (t.length >= 4 && n <= 8) return 1.6;
    if (t.length >= 3 && n <= 4) return 1.0;
    return t.length >= 3 ? 0.6 : 0.4;
  };

  const ordered = pool
    .map((it, idx) => ({ it, idx }))
    .sort((a, b) => priority(a.it) - priority(b.it) || (a.it.rank ?? 999) - (b.it.rank ?? 999) || a.idx - b.idx)
    .map((x) => x.it);

  const groups: Group[] = [];
  for (const it of ordered) {
    const itToks = toks.get(it)!;
    const itNorm = norm(it.title);
    let best: Group | null = null;
    let bestScore = 0;
    for (const g of groups) {
      let s = 0;
      for (const t of itToks) if (g.core.has(t)) s += weight(t);
      if (g.seedNorm.length >= 3 && itNorm.includes(g.seedNorm)) s += 2.0;
      if (itNorm.length >= 3 && itNorm.length <= 14 && g.memberNorms.some((m) => m.includes(itNorm))) s += 2.0;
      if (s > bestScore) [best, bestScore] = [g, s];
    }
    if (best && bestScore >= threshold) {
      best.items.push(it);
      if (best.items.length <= 3) for (const t of itToks) best.core.add(t); // 초반 멤버만 핵심 토큰 확장
      best.memberNorms.push(itNorm);
    } else {
      groups.push({
        id: groups.length + 1,
        label: it.title,
        items: [it],
        core: new Set(itToks),
        seedNorm: itNorm,
        memberNorms: [itNorm],
        score: 0,
        reasons: [],
        category: "",
        excludedReason: "",
      });
    }
  }
  return groups;
}
