/**
 * 4. 구글 트렌드 — 실시간 인기(Trending now) + 카테고리별 태깅 (원본: collectors/google_trends.py)
 * 카테고리 필터는 실제 클릭이 필요합니다(스크립트 click() 은 반영되지 않음).
 */
import { clean, parseAgoMinutes, parseCount, parsePct } from "../text";
import type { ChannelItem, ChannelResult } from "../types";
import { dump, emptyResult, firstLine, goto, openPage, run, type CollectContext } from "./common";
import { GOOGLE_TRENDS_MENU_COUNTS, GOOGLE_TRENDS_ROWS } from "./scripts";

const URL = (hours: number) => `https://trends.google.com/trending?geo=KR&hl=ko&hours=${hours}`;
const ICONS = new Set(["trending_up", "timelapse", "arrow_upward", "arrow_downward", "trending_flat", "trending_down"]);
const VOL_RE = /^[\d.,]+\s*(천|만|억)?\+?$/;

export type TrendRow = { keyword: string; volume: number | null; pct: number | null; startedMin: number | null; status: string; related: string[] };

/** ['이현중','5천+','arrow_upward','1,000%','12시간 전','trending_up','활성','아시안게임 농구', …, '외 5개'] → 행 */
export function parseTrendRow(lines: string[]): TrendRow | null {
  const ls = lines.filter(Boolean);
  if (!ls.length) return null;
  const row: TrendRow = { keyword: ls[0], volume: null, pct: null, startedMin: null, status: "", related: [] };
  for (const ln of ls.slice(1)) {
    if (ICONS.has(ln) || /^외 \d+개$/.test(ln)) continue;
    if (row.volume === null && VOL_RE.test(ln)) {
      row.volume = parseCount(ln);
      continue;
    }
    if (row.pct === null && /^[\d,]+%$/.test(ln)) {
      row.pct = parsePct(ln);
      continue;
    }
    if (row.startedMin === null && /\d+\s*(분|시간|일)\s*전/.test(ln) && !ln.includes("동안")) {
      row.startedMin = parseAgoMinutes(ln);
      continue;
    }
    if (ln === "활성" || ln.includes("지속됨")) {
      row.status = ln;
      continue;
    }
    row.related.push(ln);
  }
  return row;
}

async function readRows(page: import("playwright").Page): Promise<TrendRow[]> {
  const rows = (await run<string[][]>(page, GOOGLE_TRENDS_ROWS)) ?? [];
  return rows.map(parseTrendRow).filter((r): r is TrendRow => !!r?.keyword);
}

function toItem(r: TrendRow, hours: number, rank: number | null): ChannelItem {
  return {
    channel: "google_trends",
    source: `구글 트렌드 실시간 인기(${hours}시간)`,
    title: clean(r.keyword),
    url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(r.keyword)}&geo=KR`,
    rank,
    volume: r.volume,
    growthPct: r.pct,
    ageMinutes: r.startedMin,
    category: "",
    extra: { status: r.status, related: r.related, categories: [] as string[] },
  };
}

export async function collectGoogleTrends(ctx: CollectContext): Promise<ChannelResult> {
  const t0 = Date.now();
  const res = emptyResult("google_trends", "구글 트렌드");
  const cfg = ctx.cfg.googleTrends;
  const { page, context } = await openPage(ctx, false);
  try {
    let base: TrendRow[] = [];
    try {
      await goto(page, URL(cfg.hours), 2500);
      await page.waitForSelector("tr[data-row-id]", { timeout: 15_000 }).catch(() => undefined);
      base = await readRows(page);
    } catch (e) {
      res.error = `구글 트렌드 접속 실패: ${firstLine(e)}`;
      await dump(ctx, page, "google_trends_error", true);
      return res;
    }
    if (!base.length) {
      res.error = "트렌드 행을 찾지 못했습니다 (화면 구조 변경 또는 로딩 지연).";
      await dump(ctx, page, "google_trends_empty", true);
      return res;
    }
    await dump(ctx, page, "google_trends");

    const byKw = new Map<string, ChannelItem>();
    base.forEach((r, i) => {
      const it = toItem(r, cfg.hours, i + 1);
      byKw.set(it.title, it);
    });

    // 카테고리별 태깅 (진짜 클릭 필요)
    try {
      const button = () => page.getByRole("button", { name: /카테고리 선택/ }).first();
      await button().click();
      await page.waitForTimeout(600);
      const counts = (await run<Record<string, number>>(page, GOOGLE_TRENDS_MENU_COUNTS)) ?? {};
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      for (const [cid, label] of Object.entries(cfg.categories)) {
        if (!counts[cid]) continue;
        let done = false;
        let lastErr = "";
        for (const attempt of [1, 2]) {
          try {
            if (attempt === 2) await goto(page, URL(cfg.hours), 2500); // 첫 시도 실패 시 페이지를 새로 열어 다시
            await button().click({ timeout: 8000 });
            await page.waitForTimeout(500);
            await page.locator(`[role="menu"][aria-label*="카테고리"] [data-value="${cid}"]`).first().click({ timeout: 8000 });
            await page.waitForTimeout(2200);
            for (const r of await readRows(page)) {
              let it = byKw.get(clean(r.keyword));
              if (!it) {
                it = toItem(r, cfg.hours, null);
                delete (it as { url?: string }).url; // 원본과 동일: 카테고리 목록에서만 보인 키워드는 링크 없음
                byKw.set(it.title, it);
              }
              (it.extra!.categories as string[]).push(label);
              if (!it.category) it.category = label;
            }
            done = true;
            break;
          } catch (e) {
            lastErr = firstLine(e);
            await page.keyboard.press("Escape").catch(() => undefined);
          }
        }
        if (!done) res.notes.push(`카테고리 ${cid}(${label}) 태깅 실패: ${lastErr}`);
      }
    } catch (e) {
      res.notes.push(`카테고리 메뉴 조작 실패(전체 목록만 사용): ${firstLine(e)}`);
    }

    // 초신선(지난 N시간) 키워드 표시
    try {
      await goto(page, URL(cfg.freshHours), 2200);
      await page.waitForSelector("tr[data-row-id]", { timeout: 10_000 });
      for (const r of await readRows(page)) {
        const it = byKw.get(clean(r.keyword));
        if (it) it.extra!.fresh = true;
      }
    } catch {}

    res.items = [...byKw.values()];
    res.ok = true;
    return res;
  } finally {
    res.seconds = (Date.now() - t0) / 1000;
    await context.close();
  }
}
