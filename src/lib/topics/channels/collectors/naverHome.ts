/**
 * 1. 네이버 모바일 홈판 (m.naver.com) — 실제 사람들이 클릭 중인 '노출 검증 완료' 글 (원본: collectors/naver_home.py)
 * 피드 항목은 data-title / data-url / data-service(BLOG·CAFE·CLIP·TV·CHZZK) 속성을 가진 요소입니다.
 * BLOG 가 아닌 항목(쇼츠·영상 등)은 교차검증에서 빼고 참고용(supplementary)으로만 둡니다.
 * (원본의 상위 글 본문 구조 분석 — 사진 수·분량 — 은 점수에 쓰이지 않아 옮기지 않았습니다)
 */
import { clean, parseAgeMinutes } from "../text";
import type { ChannelItem, ChannelResult } from "../types";
import { dump, emptyResult, firstLine, goto, openPage, run, scroll, type CollectContext } from "./common";
import { HOST_HISTOGRAM, NAVER_HOME_FEED } from "./scripts";

export type FeedRow = {
  url: string;
  title: string;
  service: string;
  clip: boolean;
  channel: string;
  channel_url: string;
  cid: string;
  time: string;
  pages: string;
  imp_rank: number | null;
  order: number;
};

const CID_RE = /_(\d{6,})$/;
const BLOG_ID_RE = /blog\.naver\.com\/([\w.-]+)/;

/** blog.naver.com/{id}/{no} 또는 PostView.naver?blogId=&logNo= → m.blog.naver.com/{id}/{no} */
export function toMobileBlogUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.host.includes("blog.naver.com")) return url;
    const id = u.searchParams.get("blogId");
    const no = u.searchParams.get("logNo");
    if (id && no) return `https://m.blog.naver.com/${id}/${no}`;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && /^\d+$/.test(parts[1])) return `https://m.blog.naver.com/${parts[0]}/${parts[1]}`;
  } catch {}
  return url;
}

/** 피드 항목에서 블로그 글 주소를 만듭니다 (BLOG 가 아니면 "") */
export function blogPostUrl(r: Pick<FeedRow, "service" | "url" | "channel_url" | "cid">): string {
  if (r.service !== "BLOG") return "";
  if (r.url.includes("blog.naver.com")) return toMobileBlogUrl(r.url);
  const id = r.channel_url.match(BLOG_ID_RE)?.[1];
  const no = r.cid.match(CID_RE)?.[1];
  return id && no ? `https://m.blog.naver.com/${id}/${no}` : "";
}

/** 추출 결과 → 항목 (노출 순위 순) */
export function feedToItems(feed: FeedRow[]): ChannelItem[] {
  const sorted = [...feed].sort((a, b) => (a.imp_rank ?? 1e6) - (b.imp_rank ?? 1e6) || a.order - b.order);
  const items: ChannelItem[] = [];
  for (const [i, r] of sorted.entries()) {
    const title = clean(r.title);
    if (!title) continue;
    const service = r.service || (r.clip ? "CLIP" : "");
    items.push({
      channel: "naver_home",
      source: "네이버 모바일 홈판",
      title,
      url: r.url,
      rank: i + 1,
      press: r.channel ?? "",
      ageMinutes: parseAgeMinutes(r.time),
      extra: { service, clip: !!r.clip, pages: r.pages ?? "", post_url: blogPostUrl(r), ...(service !== "BLOG" ? { supplementary: true } : {}) },
    });
  }
  return items;
}

export async function collectNaverHome(ctx: CollectContext): Promise<ChannelResult> {
  const t0 = Date.now();
  const res = emptyResult("naver_home", "네이버 모바일 홈판");
  const { page, context } = await openPage(ctx, true);
  try {
    let feed: FeedRow[] = [];
    try {
      await goto(page, ctx.cfg.naverHome.url, 3000);
      await scroll(page, ctx.cfg.naverHome.scrollTimes, 1300, 900);
      feed = (await run<FeedRow[]>(page, NAVER_HOME_FEED)) ?? [];
    } catch (e) {
      res.error = `네이버 모바일 홈 접속/스크롤 실패: ${firstLine(e)}`;
      await dump(ctx, page, "naver_home_error", true);
      return res;
    }
    if (!feed.length) {
      const hist = await run<[string, number][]>(page, HOST_HISTOGRAM).catch(() => []);
      res.error = "홈판에서 피드 항목(data-title/data-url)을 찾지 못했습니다. 네이버가 화면 구조를 바꿨을 수 있습니다.";
      res.notes.push(`링크 도메인 분포(진단용): ${hist.map(([h, c]) => `${h}×${c}`).join(", ")}`);
      await dump(ctx, page, "naver_home_empty", true);
      return res;
    }
    await dump(ctx, page, "naver_home");
    res.items = feedToItems(feed);
    res.ok = true;
    return res;
  } finally {
    res.seconds = (Date.now() - t0) / 1000;
    await context.close();
  }
}
