/**
 * 3. 네이트 — 실시간 이슈 키워드 / 판 Top랭킹 / 급상승 관심뉴스 (원본: collectors/nate.py)
 * 판 Top랭킹은 커뮤니티 글이라 교차검증에서 빼고(community) 참고용으로만 둡니다.
 */
import { clean } from "../text";
import type { ChannelItem, ChannelResult } from "../types";
import { dump, emptyResult, firstLine, goto, openPage, run, type CollectContext } from "./common";
import { NATE_HOT_NEWS, NATE_KEYWORDS, NATE_PANN_LIST } from "./scripts";

type KwRow = { rank: number; keyword: string; url: string; change: string; delta: string };
type HotRow = { tab: number; rank: number; title: string; url: string; change: string };
type PannRow = { rank: number; title: string; url: string; comments: number | null };

const TAB_LABEL: Record<number, string> = { 1: "시사", 2: "스포츠", 3: "연예" };
export const NATE_KEYWORD_SOURCE = "네이트 실시간 이슈 키워드";

/** 위젯이 1~5위 / 6~10위를 번갈아 보여 주므로 여러 번 읽은 결과를 순위별로 합칩니다 */
export function mergeKeywordSamples(samples: KwRow[][]): ChannelItem[] {
  const byRank = new Map<number, KwRow>();
  for (const rows of samples) for (const r of rows) if (r.keyword && r.rank && !byRank.has(r.rank)) byRank.set(r.rank, r);
  return [...byRank.keys()]
    .sort((a, b) => a - b)
    .map((rank) => {
      const r = byRank.get(rank)!;
      return { channel: "nate", source: NATE_KEYWORD_SOURCE, title: clean(r.keyword), url: r.url ?? "", rank, extra: { change: r.change, delta: r.delta } };
    });
}

export function pannItems(rows: PannRow[]): ChannelItem[] {
  return rows
    .filter((r) => r.title)
    .map((r) => ({ channel: "nate", source: "네이트 판 Top랭킹", title: clean(r.title), url: r.url ?? "", rank: r.rank || null, extra: { comments: r.comments, community: true } }));
}

export function hotNewsItems(rows: HotRow[]): ChannelItem[] {
  const seen = new Set<string>();
  const out: ChannelItem[] = [];
  for (const r of rows) {
    if (!r.title || seen.has(r.url)) continue;
    seen.add(r.url);
    const tab = TAB_LABEL[r.tab] ?? String(r.tab);
    // 연예 탭은 기사별 키워드 분류에 맡김 (드라마/스타·연예인/방송 등으로 세분)
    out.push({ channel: "nate", source: `네이트 실시간 급상승 관심뉴스(${tab})`, title: clean(r.title), url: r.url, rank: r.rank || null, category: tab === "스포츠" ? "스포츠" : "", extra: { change: r.change ?? "" } });
  }
  return out;
}

export async function collectNate(ctx: CollectContext): Promise<ChannelResult> {
  const t0 = Date.now();
  const res = emptyResult("nate", "네이트 실시간 이슈");
  const cfg = ctx.cfg.nate;
  const { page, context } = await openPage(ctx, false);
  try {
    // 1) 실시간 이슈 키워드 (핵심)
    try {
      await goto(page, cfg.keywordUrl, 1200);
      const samples: KwRow[][] = [];
      for (let i = 0; i < 12; i++) {
        samples.push((await run<KwRow[]>(page, NATE_KEYWORDS)) ?? []);
        if (new Set(samples.flat().filter((r) => r.keyword && r.rank).map((r) => r.rank)).size >= 10) break;
        await page.waitForTimeout(1200);
      }
      const kws = mergeKeywordSamples(samples);
      res.items.push(...kws);
      if (kws.length < 10) res.notes.push(`이슈 키워드 ${kws.length}/10건만 수집`);
      if (!kws.length) await dump(ctx, page, "nate_keywords", true);
      res.items.push(...pannItems((await run<PannRow[]>(page, NATE_PANN_LIST)) ?? []));
      await dump(ctx, page, "nate_main");
    } catch (e) {
      res.notes.push(`이슈 키워드 수집 실패: ${firstLine(e)}`);
      await dump(ctx, page, "nate_keywords_error", true);
    }
    // 2) 판 메인: 급상승 관심뉴스 (스포츠/연예 탭은 마우스를 올려야 로딩됨)
    try {
      await goto(page, cfg.pannUrl, 1500);
      for (const tab of [2, 3]) {
        await page.hover(`#news_tab${tab}`, { timeout: 3000 }).catch(() => undefined);
        await page.waitForTimeout(500);
      }
      res.items.push(...hotNewsItems((await run<HotRow[]>(page, NATE_HOT_NEWS)) ?? []));
      await dump(ctx, page, "nate_pann");
    } catch (e) {
      res.notes.push(`판 수집 실패: ${firstLine(e)}`);
      await dump(ctx, page, "nate_pann_error", true);
    }
    res.ok = res.items.some((i) => i.source === NATE_KEYWORD_SOURCE);
    if (!res.ok) res.error = "실시간 이슈 키워드를 가져오지 못했습니다.";
    return res;
  } finally {
    res.seconds = (Date.now() - t0) / 1000;
    await context.close();
  }
}
