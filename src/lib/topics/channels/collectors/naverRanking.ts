/**
 * 2. 네이버 랭킹 뉴스 (원본: collectors/naver_ranking.py)
 *  - entertain : 엔터 '많이 본 뉴스' — 조회수가 표시되는 유일한 순위
 *  - press     : 뉴스 랭킹(종합) — 언론사별 '많이 본 뉴스' 상위 5건. 여러 언론사에 동시에 오르면 '큰 이슈' 신호
 *  - section   : 섹션 페이지 헤드라인
 * 각 항목의 extra.kind 는 ent_rank / press_rank / section_headline 이며 점수에서 종류별로 다르게 씁니다.
 * (원본의 상위 기사 본문 분량·사진 수 분석은 점수에 쓰이지 않아 옮기지 않았습니다)
 */
import { clean, parseAgoMinutes, parseCount } from "../text";
import type { ChannelItem, ChannelResult } from "../types";
import { dump, emptyResult, firstLine, goto, openPage, run, type CollectContext } from "./common";
import { NAVER_RANKING_ENTERTAIN, NAVER_RANKING_PRESS, NAVER_RANKING_SECTION } from "./scripts";

type EntRow = { url: string; title: string; views: string; desc: string; rank: string; order: number };
type PressRow = { press: string; url: string; title: string; rank: number | null; time: string };
type SecRow = { kind: string; url: string; title: string; press: string; time: string; order: number };

const ART_RE = /article\/(\d{3})\/(\d{6,12})/;

/** '조회수 70,294' → 70294 */
export function parseViews(text: string): number | null {
  const t = (text ?? "").replace(/조회수?/g, "");
  return /\d/.test(t) ? parseCount(t.trim()) : null;
}

/** 같은 기사(언론사·기사번호)를 한 번만 */
export function dedupe<T extends { url?: string }>(rows: T[], seen = new Set<string>()): T[] {
  return rows.filter((r) => {
    const m = (r.url ?? "").match(ART_RE);
    const key = m ? `${m[1]}_${m[2]}` : r.url ?? "";
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const SOURCE = "naver_ranking";

export function entertainItems(rows: EntRow[], name: string, category: string): ChannelItem[] {
  const out: ChannelItem[] = [];
  for (const r of dedupe(rows)) {
    const m = (r.rank ?? "").match(/\d+/);
    out.push({
      channel: SOURCE,
      source: name,
      title: clean(r.title),
      url: r.url,
      rank: m ? Number(m[0]) : out.length + 1,
      category,
      views: parseViews(r.views),
      extra: { kind: "ent_rank", desc: clean(r.desc).slice(0, 90) },
    });
  }
  return out;
}

export function pressItems(rows: PressRow[], name: string, category: string, pressMax: number): ChannelItem[] {
  return rows
    .filter((r) => !(r.rank && r.rank > pressMax))
    .map((r) => ({
      channel: SOURCE,
      source: name,
      title: clean(r.title),
      url: r.url,
      rank: r.rank,
      category,
      press: r.press ?? "",
      ageMinutes: parseAgoMinutes(r.time),
      extra: { kind: "press_rank" },
    }));
}

export function sectionItems(data: { headline: SecRow[]; latest: SecRow[] }, name: string, category: string, includeLatest: boolean): ChannelItem[] {
  const out: ChannelItem[] = dedupe(data.headline ?? []).map((r, i) => ({
    channel: SOURCE,
    source: name,
    title: clean(r.title),
    url: r.url,
    rank: i + 1,
    category,
    press: r.press ?? "",
    ageMinutes: parseAgoMinutes(r.time),
    extra: { kind: "section_headline" },
  }));
  if (includeLatest) {
    const seen = new Set(out.map((i) => i.url));
    for (const [i, r] of (data.latest ?? []).entries()) {
      if (seen.has(r.url)) continue;
      out.push({ channel: SOURCE, source: `${name} 최신`, title: clean(r.title), url: r.url, rank: i + 1, category, press: r.press ?? "", ageMinutes: parseAgoMinutes(r.time), extra: { kind: "section_latest" } });
    }
  }
  return out;
}

export async function collectNaverRanking(ctx: CollectContext): Promise<ChannelResult> {
  const t0 = Date.now();
  const res = emptyResult("naver_ranking", "네이버 랭킹 뉴스");
  const cfg = ctx.cfg.naverRanking;
  const { page, context } = await openPage(ctx, false);
  try {
    for (const pg of cfg.pages) {
      const type = pg.type ?? (pg.url.includes("entertain") ? "entertain" : pg.url.includes("/section/") ? "section" : "press");
      try {
        await goto(page, pg.url, 2500);
        const items =
          type === "entertain"
            ? entertainItems((await run<EntRow[]>(page, NAVER_RANKING_ENTERTAIN)) ?? [], pg.name, pg.category)
            : type === "press"
              ? pressItems((await run<PressRow[]>(page, NAVER_RANKING_PRESS)) ?? [], pg.name, pg.category, cfg.pressRankMax)
              : sectionItems((await run<{ headline: SecRow[]; latest: SecRow[] }>(page, NAVER_RANKING_SECTION)) ?? { headline: [], latest: [] }, pg.name, pg.category, cfg.includeLatest);
        if (!items.length) {
          res.notes.push(`${pg.name}: 기사 0건 (storage/channels/debug 확인)`);
          await dump(ctx, page, `naver_ranking_${pg.name}`, true);
          continue;
        }
        await dump(ctx, page, `naver_ranking_${pg.name}`);
        res.items.push(...items);
      } catch (e) {
        res.notes.push(`${pg.name} 수집 실패: ${firstLine(e)}`);
        await dump(ctx, page, `naver_ranking_error_${pg.name}`, true);
      }
    }
    res.ok = res.items.length > 0;
    if (!res.ok) res.error = "네이버 랭킹 기사를 가져오지 못했습니다.";
    return res;
  } finally {
    res.seconds = (Date.now() - t0) / 1000;
    await context.close();
  }
}
