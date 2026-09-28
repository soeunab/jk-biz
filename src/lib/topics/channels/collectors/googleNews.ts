/**
 * 5-b. 구글 뉴스 — 토픽별 RSS (원본: collectors/google_news.py). 브라우저 없이 fetch 만 씁니다.
 * RSS 설명(description)에 묶인 같은 사건 기사 수(cluster)로 '여러 매체가 동시에 다루는 이슈'를 판별합니다.
 */
import { clean } from "../text";
import type { ChannelConfig } from "../config";
import type { ChannelItem, ChannelResult } from "../types";
import { DESKTOP_UA, emptyResult, firstLine } from "./common";

const RSS = (id: string) => `https://news.google.com/rss/topics/${id}?hl=ko&gl=KR&ceid=KR:ko`;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** XML·HTML 엔티티 풀기 (&amp; &lt; &#39; &#x2F; …) */
export function unescapeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function tagText(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  if (!m) return null;
  const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : unescapeEntities(m[1]);
}

export type RssRow = { title: string; press: string; ageMinutes: number | null; cluster: number; link: string; related: string[] };

/** RSS → [{ title, press, ageMinutes, cluster, link, related }] (원본 parse_rss 와 같은 규칙) */
export function parseGoogleNewsRss(xml: string, now = new Date(), limit = 40): RssRow[] {
  const rows: RssRow[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    if (rows.length >= limit) break;
    const block = m[1];
    let title = tagText(block, "title") ?? "";
    const press = (tagText(block, "source") ?? "").trim();
    if (press && title.endsWith(` - ${press}`)) title = title.slice(0, -` - ${press}`.length);
    else title = title.replace(/\s+-\s+[^-]{2,14}$/, ""); // 매체 표기가 다른 경우('- 조선비즈')도 제거
    const pub = tagText(block, "pubDate");
    const t = pub ? Date.parse(pub) : NaN;
    const ageMinutes = Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / 60_000)) : null;
    const desc = unescapeEntities(tagText(block, "description") ?? "");
    const related = [...desc.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].map((x) => clean(unescapeEntities(x[1])));
    const cluster = Math.max(1, (desc.match(/<li>/g) ?? []).length);
    rows.push({ title: clean(title), press, ageMinutes, cluster, link: tagText(block, "link") ?? "", related });
  }
  return rows;
}

export async function collectGoogleNews(ctx: { cfg: ChannelConfig; now?: Date }): Promise<ChannelResult> {
  const t0 = Date.now();
  const res = emptyResult("google_news", "구글 뉴스");
  const now = ctx.now ?? new Date();
  for (const topic of ctx.cfg.googleNews.topics) {
    try {
      const r = await fetch(RSS(topic.id), { headers: { "User-Agent": DESKTOP_UA }, signal: AbortSignal.timeout(25_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      parseGoogleNewsRss(await r.text(), now, ctx.cfg.googleNews.perTopic).forEach((x, i) => {
        const it: ChannelItem = {
          channel: "google_news",
          source: `구글 뉴스 ${topic.label}`,
          title: x.title,
          url: x.link,
          rank: i + 1,
          category: topic.category,
          ageMinutes: x.ageMinutes,
          clusterSize: x.cluster,
          press: x.press,
          extra: { related: x.related.slice(0, 6) },
        };
        res.items.push(it);
      });
    } catch (e) {
      res.notes.push(`토픽 ${topic.label} 수집 실패: ${firstLine(e)}`);
    }
  }
  res.ok = res.items.length > 0;
  if (!res.ok) res.error = "구글 뉴스 RSS 를 가져오지 못했습니다.";
  res.seconds = (Date.now() - t0) / 1000;
  return res;
}
