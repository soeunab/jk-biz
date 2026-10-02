/**
 * 5-a. 다음 뉴스 — 주요뉴스·카테고리별 기사 '몇 분 전' + 실시간 트렌드 키워드 (원본: collectors/daum_news.py)
 * 카테고리는 기사가 처음 발견된 페이지 기준만 씁니다. 섹션 페이지 사이드바의 '많이 본 뉴스'에는 다른 분야 기사가 섞여 있어,
 * 나중 페이지에서 덮어쓰면 엉뚱한 카테고리가 붙기 때문입니다(원본 주석 참고).
 */
import { clean, parseAgeMinutes } from "../text";
import type { ChannelItem, ChannelResult } from "../types";
import { dump, emptyResult, firstLine, goto, openPage, run, type CollectContext } from "./common";
import { DAUM_ARTICLES, DAUM_TRENDS } from "./scripts";

type ArticleRow = { url: string; title: string; infos: string[] };
export const DAUM_TREND_SOURCE = "다음 실시간 트렌드";

/** '1위, 트럼프 대이란 대응 , 신규' → [1, '트럼프 대이란 대응', '신규'] */
export function parseDaumTrend(text: string): [number, string, string] | null {
  const parts = text.split(",").map((p) => p.trim());
  const num = parts[0].replace("위", "").trim();
  if (!/^[+-]?\d+$/.test(num) || parts.length < 2) return null; // 파이썬 int() 가 실패하는 경우와 같게
  return [Number(num), parts[1], parts[2] ?? ""];
}

/** 한 페이지의 기사 → 항목 (이미 본 URL 은 건너뜀) */
export function articleItems(rows: ArticleRow[], name: string, category: string, seen: Set<string>): ChannelItem[] {
  const out: ChannelItem[] = [];
  rows.forEach((r, i) => {
    if (!r.title || seen.has(r.url)) return;
    seen.add(r.url);
    const infos = r.infos ?? [];
    let age: number | null = null;
    for (const x of infos) {
      const a = parseAgeMinutes(x);
      if (a !== null) age = a;
    }
    out.push({ channel: "daum", source: name, title: clean(r.title), url: r.url, rank: i + 1, category, ageMinutes: age, press: infos[0] ?? "" });
  });
  return out;
}

export async function collectDaum(ctx: CollectContext): Promise<ChannelResult> {
  const t0 = Date.now();
  const res = emptyResult("daum", "다음 뉴스");
  const cfg = ctx.cfg.daum;
  const { page, context } = await openPage(ctx, false);
  const seen = new Set<string>();
  try {
    for (const pg of cfg.pages) {
      try {
        await goto(page, pg.url, 1800);
        const items = articleItems((await run<ArticleRow[]>(page, DAUM_ARTICLES)) ?? [], pg.name, pg.category, seen);
        res.items.push(...items);
        if (!items.length) {
          res.notes.push(`${pg.name}: 기사 0건`);
          await dump(ctx, page, `daum_${pg.name}`, true);
        } else await dump(ctx, page, `daum_${pg.name}`);
        if (cfg.trendKeywords && pg.url.replace(/\/$/, "").endsWith("news.daum.net")) {
          for (const t of (await run<{ text: string; href: string }[]>(page, DAUM_TRENDS)) ?? []) {
            const p = parseDaumTrend(t.text);
            if (!p) continue;
            res.items.push({ channel: "daum", source: DAUM_TREND_SOURCE, title: clean(p[1]), url: t.href ?? "", rank: p[0], extra: { change: p[2], keyword_only: true } });
          }
        }
      } catch (e) {
        res.notes.push(`${pg.name} 수집 실패: ${firstLine(e)}`);
        await dump(ctx, page, `daum_error_${pg.name}`, true);
      }
    }
    res.ok = res.items.some((i) => i.source !== DAUM_TREND_SOURCE);
    if (!res.ok) res.error = "다음 뉴스 기사를 가져오지 못했습니다.";
    return res;
  } finally {
    res.seconds = (Date.now() - t0) / 1000;
    await context.close();
  }
}
