/**
 * 그룹(소재)별 점수화와 근거 문장 (원본: reference/contents-finder/finder/analysis/scoring.py).
 * 점수는 "지금 여러 채널에서 화제인가"를 나타내는 정렬용 지표이며 수익·트래픽 예측이 아닙니다.
 * 근거 문장은 수집된 값만으로 만들고, 없는 값은 문장에 넣지 않습니다.
 */
import type { ChannelConfig } from "./config";
import type { Group, GroupMetrics } from "./crossref";
import { flagText, NO_RESTRICTION, resolveCategory, resolveCategoryWeighted } from "./filters";
import { comma, fmtAgo, fmtCount } from "./text";
import type { ChannelItem } from "./types";

export const MAIN_CHANNELS = ["naver_home", "naver_ranking", "nate", "google_trends", "daum", "google_news"] as const;
export const CHANNEL_LABEL: Record<string, string> = {
  naver_home: "네이버 홈판",
  naver_ranking: "네이버 랭킹",
  nate: "네이트",
  google_trends: "구글 트렌드",
  daum: "다음",
  google_news: "구글 뉴스",
  creator_advisor: "크리에이터 어드바이저",
};

const nums = (vals: (number | null | undefined)[]) => vals.filter((v): v is number => v != null);
const minOf = (vals: (number | null | undefined)[]) => (nums(vals).length ? Math.min(...nums(vals)) : null);
const maxOf = (vals: (number | null | undefined)[]) => (nums(vals).length ? Math.max(...nums(vals)) : null);
const kind = (i: ChannelItem) => i.extra?.kind;

export function computeMetrics(g: Group, tuning?: Partial<ChannelConfig["tuning"]>): GroupMetrics {
  // 세부 섹션 최신 기사는 인기순이 아니라 '이 채널에 올랐다'는 신호가 아님 (tuning.latestNotChannel)
  const counted = tuning?.latestNotChannel ? g.items.filter((i) => kind(i) !== "section_latest") : g.items;
  const by = (ch: string) => counted.filter((i) => i.channel === ch);
  const trends = by("google_trends");
  const nate = by("nate").filter((i) => i.source === "네이트 실시간 이슈 키워드");
  const nateNews = by("nate").filter((i) => i.source !== "네이트 실시간 이슈 키워드");
  const nav = by("naver_ranking");
  const rankItems = nav.filter((i) => kind(i) === "ent_rank"); // 조회수가 표시되는 엔터 랭킹
  const pressItems = nav.filter((i) => kind(i) === "press_rank"); // 언론사별 랭킹(종합)
  const headItems = nav.filter((i) => kind(i) === "section_headline"); // 섹션 헤드라인
  const home = by("naver_home").filter((i) => i.extra?.service !== "CLIP");
  const gn = by("google_news");
  const daum = by("daum");

  return {
    channels: MAIN_CHANNELS.filter((c) => by(c).length),
    trendPct: maxOf(trends.map((i) => i.growthPct)),
    trendStartedMin: minOf(trends.map((i) => i.ageMinutes)),
    trendVolume: maxOf(trends.map((i) => i.volume)),
    trendFresh: trends.some((i) => !!i.extra?.fresh),
    newestAge: minOf([...daum, ...gn, ...trends, ...(tuning?.newestAgeAllChannels ? [...home, ...nav] : [])].map((i) => i.ageMinutes)),
    naverBestRank: minOf(rankItems.map((i) => i.rank)),
    naverMaxViews: maxOf(rankItems.map((i) => i.views || null)),
    homeHit: home.length > 0,
    pressHits: new Set(pressItems.map((i) => i.press).filter(Boolean)).size,
    pressBestRank: minOf(pressItems.map((i) => i.rank)),
    headlineHits: new Set(headItems.map((i) => i.url ?? "")).size,
    nateRank: minOf(nate.map((i) => i.rank)),
    nateChange: nate[0]?.extra?.change ?? null,
    nateNewsHit: nateNews.length > 0,
    gnewsCluster: maxOf(gn.map((i) => i.clusterSize || null)),
    daumCount: new Set(daum.filter((i) => i.source !== "다음 실시간 트렌드").map((i) => i.url || i.title)).size,
    daumTrendRank: minOf(daum.filter((i) => i.source === "다음 실시간 트렌드").map((i) => i.rank)),
  };
}

/**
 * 점수·근거·카테고리·필터를 그룹에 채웁니다.
 * @param include 내 블로그 주제(카테고리) 목록. NO_RESTRICTION 이 들어 있으면 주제 밖 감점을 하지 않습니다.
 */
export function scoreGroup(g: Group, cfg: ChannelConfig, include: string[]): void {
  const w = cfg.scoring;
  const m = computeMetrics(g, cfg.tuning);
  g.metrics = m;
  let score = 0;
  const why: string[] = [];

  const nCh = Math.min(m.channels.length, 5);
  if (nCh) {
    score += nCh * w.perChannel;
    if (m.channels.length >= 2) why.push(`${m.channels.length}개 채널에서 동시 확인(${m.channels.map((c) => CHANNEL_LABEL[c]).join(", ")})`);
  }

  const pct = m.trendPct;
  if (pct != null) {
    const started = fmtAgo(m.trendStartedMin);
    const line = `구글 트렌드 검색량 ${comma(pct)}%↑ (${started}부터)`;
    if (pct >= 1000) {
      score += w.trend1000;
      why.push(`${line} → 당일 즉시 소재`);
    } else if (pct >= 500) {
      score += w.trend500;
      why.push(line);
    } else if (pct >= 200) {
      score += w.trend200;
      why.push(line);
    } else if (pct >= 100) {
      score += w.trend100;
      why.push(line);
    }
  }
  if (m.trendFresh) why.push(`최근 ${cfg.googleTrends.freshHours}시간 안에 시작된 초신선 키워드`);

  const age = m.newestAge;
  if (age != null) {
    if (age <= 30) score += w.fresh30;
    else if (age <= 60) score += w.fresh60;
    else if (age <= 180) score += w.fresh180;
    else if (age <= 360) score += w.fresh360;
    if (age <= 360) why.push(`가장 최근 기사 ${fmtAgo(age)} (다른 블로거가 아직 덜 다뤘을 가능성)`);
  }

  const br = m.naverBestRank;
  if (br != null) {
    score += br <= 3 ? w.naverRankTop3 : br <= 10 ? w.naverRankTop10 : w.naverRankOther;
    why.push(`네이버 엔터 랭킹 ${br}위${m.naverMaxViews ? ` · 조회수 ${fmtCount(m.naverMaxViews)}` : ""}`);
  }
  const mv = m.naverMaxViews;
  if (mv) {
    if (mv >= 50_000) score += w.naverViews50k;
    else if (mv >= 30_000) score += w.naverViews30k;
  }
  const ph = m.pressHits;
  if (ph) {
    if (ph >= 5) score += w.naverPress5;
    else if (ph >= 3) score += w.naverPress3;
    else if (ph >= 2) score += w.naverPress2;
    why.push(ph >= 2 ? `네이버 언론사 랭킹 ${ph}곳에 동시에 오름(최고 ${m.pressBestRank ?? 0}위)` : `네이버 언론사 랭킹 진입(${m.pressBestRank ?? 0}위)`);
  }
  if (m.headlineHits) {
    score += w.naverHeadline;
    why.push("네이버 섹션 헤드라인 노출");
  }
  if (m.homeHit) {
    score += w.naverHome;
    why.push("네이버 모바일 홈판 노출 확인 (실제 클릭 검증)");
  }
  if (m.nateRank != null) {
    score += m.nateRank <= 5 ? w.nateTop5 : w.nateOther;
    why.push(`네이트 실시간 이슈 키워드 ${m.nateRank}위`);
  }
  if (m.daumTrendRank != null) why.push(`다음 실시간 트렌드 ${m.daumTrendRank}위`);
  const gc = m.gnewsCluster;
  if (gc && gc >= 5) {
    score += w.gnewsCluster5;
    why.push("구글 뉴스 같은 사건 기사 5건 이상 묶임(여러 매체가 동시에 보도)");
  } else if (gc && gc >= 3) {
    score += w.gnewsCluster3;
    why.push(`구글 뉴스 같은 사건 기사 ${gc}건 묶임`);
  }
  if (m.daumCount >= 3) {
    score += w.daumMulti3;
    why.push(`다음에 서로 다른 제목의 기사 ${m.daumCount}건 (트래픽 커지는 중)`);
  }

  // 카테고리 / 주제 적합성
  const votes: string[] = [];
  for (const i of g.items) {
    if (i.category) votes.push(i.category);
    votes.push(...(((i.extra?.categories as string[] | undefined) ?? []).filter(Boolean)));
  }
  const text = g.items.map((i) => i.title).join(" ");
  if (g.categoryOverride) {
    g.category = g.categoryOverride;
    g.categoryAmbiguous = false;
  } else if (cfg.tuning?.weightedClassify) {
    const articles = g.items.filter((i) => i.channel !== "google_trends" && !i.extra?.keyword_only && i.source !== "네이트 실시간 이슈 키워드").map((i) => i.title);
    const guess = resolveCategoryWeighted(votes, text, articles);
    g.category = guess.category;
    g.categoryAmbiguous = guess.ambiguous;
  } else g.category = resolveCategory(votes, text);
  if (!include.includes(NO_RESTRICTION) && !include.includes(g.category)) {
    score += w.offTopicPenalty;
    why.push(`내 블로그 주제 밖(${g.category}) - 감점`);
  }

  // 필터
  const flags = flagText(text, cfg.filters);
  g.flags = flags;
  if (flags.soft.length) {
    score += w.softNegativePenalty;
    why.push(`논란성 표현 포함(${flags.soft.slice(0, 3).join(", ")}) - 감점`);
  }
  if (flags.hard.length) g.excludedReason = `부정적 사건/이슈 키워드: ${flags.hard.slice(0, 4).join(", ")}`;
  else if (cfg.filters.excludePolitics && flags.politics.length) g.excludedReason = `정치 이슈 (블로그 주제 밖): ${flags.politics.slice(0, 3).join(", ")}`;

  // 선점 후보: 네이트/트렌드/다음에서는 보이는데 네이버 랭킹·홈판엔 아직 없음
  const early = ["nate", "google_trends", "daum"].some((c) => m.channels.includes(c));
  const onNaver = m.homeHit || br != null || !!m.pressHits || !!m.headlineHits;
  m.preempt = early && !onNaver && (age == null || age <= 360);
  if (m.preempt) why.push("선점 후보: 네이버 랭킹/홈판에는 아직 없음");

  g.score = Math.max(0, Math.min(100, score));
  g.reasons = why;
}
