/**
 * 채널 수집기 — 순수 파서는 파이썬 원본 결과(expected.json)와 비교하고,
 * page.evaluate() 추출 스크립트는 원본 선택자 구조로 만든 픽스처 HTML 에 실제 크로미움으로 실행해 확인합니다.
 * (실제 사이트 스크래핑은 네트워크가 되는 맥미니에서 npm run channels:check 로 확인)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import type { Browser, Page } from "playwright";
import { parseTrendRow } from "@/lib/topics/channels/collectors/googleTrends";
import { parseGoogleNewsRss } from "@/lib/topics/channels/collectors/googleNews";
import { articleItems, parseDaumTrend } from "@/lib/topics/channels/collectors/daum";
import { blogPostUrl, feedToItems, type FeedRow } from "@/lib/topics/channels/collectors/naverHome";
import { dedupe, entertainItems, parseViews, pressItems, sectionItems } from "@/lib/topics/channels/collectors/naverRanking";
import { hotNewsItems, mergeKeywordSamples, pannItems } from "@/lib/topics/channels/collectors/nate";
import { run } from "@/lib/topics/channels/collectors/common";
import * as S from "@/lib/topics/channels/collectors/scripts";

const dir = "tests/fixtures/channels";
const P = JSON.parse(readFileSync(`${dir}/expected.json`, "utf8")).parsers;

describe("순수 파서 — 파이썬 원본과 동일", () => {
  it("구글 트렌드 행", () => {
    for (const [lines, want] of P.trend_rows) {
      const got = parseTrendRow(lines);
      expect(got && { keyword: got.keyword, volume: got.volume, pct: got.pct, started_min: got.startedMin, status: got.status, related: got.related }).toEqual(want);
    }
  });
  it("다음 실시간 트렌드 문구", () => {
    for (const [text, want] of P.daum_trends) expect(parseDaumTrend(text)).toEqual(want);
  });
  it("구글 뉴스 RSS (매체명 꼬리 제거·몇 분 전·같은 사건 기사 수·관련 제목)", () => {
    const got = parseGoogleNewsRss(readFileSync(`${dir}/google-news.xml`, "utf8"), new Date(P.rss_now), 40);
    expect(got.map((r) => [r.title, r.press, r.ageMinutes, r.cluster, r.link, r.related])).toEqual(P.rss);
  });
});

describe("수집 결과 → 항목 변환", () => {
  it("네이버 홈판: 노출 순위순, BLOG 아닌 항목은 참고용, 블로그 글 주소", () => {
    const feed: FeedRow[] = [
      { url: "https://tv.naver.com/v/1", title: "영상", service: "TV", clip: false, channel: "", channel_url: "", cid: "", time: "", pages: "", imp_rank: 1, order: 0 },
      { url: "https://in.naver.com/a/contents/1", title: "블로그 글", service: "BLOG", clip: false, channel: "작성자", channel_url: "https://blog.naver.com/abc", cid: "abc_224012345678", time: "2시간 전", pages: "", imp_rank: null, order: 1 },
    ];
    const items = feedToItems(feed);
    expect(items.map((i) => [i.title, i.rank, !!i.extra?.supplementary])).toEqual([["영상", 1, true], ["블로그 글", 2, false]]);
    expect(items[1].ageMinutes).toBe(120);
    expect(items[1].extra?.post_url).toBe("https://m.blog.naver.com/abc/224012345678");
    expect(blogPostUrl({ service: "BLOG", url: "https://blog.naver.com/PostView.naver?blogId=x&logNo=99", channel_url: "", cid: "" })).toBe("https://m.blog.naver.com/x/99");
  });
  it("네이버 랭킹: 조회수·언론사 순위 상한·같은 기사 중복 제거", () => {
    expect(parseViews("조회수 70,294")).toBe(70294);
    expect(parseViews("")).toBeNull();
    expect(dedupe([{ url: "https://n.news.naver.com/article/015/0005336135" }, { url: "https://m.x.com/article/015/0005336135?a=1" }])).toHaveLength(1);
    expect(pressItems([{ press: "A", url: "u1", title: "t", rank: 1, time: "5시간전" }, { press: "A", url: "u2", title: "t2", rank: 6, time: "" }], "뉴스 랭킹(종합)", "", 5)).toHaveLength(1);
    expect(entertainItems([{ url: "https://x/article/1/12345678", title: "t", views: "4.7만", desc: "", rank: "", order: 0 }], "엔터", "")[0]).toMatchObject({ rank: 1, views: 47000, extra: { kind: "ent_rank" } });
    expect(sectionItems({ headline: [], latest: [{ kind: "latest", url: "u", title: "t", press: "", time: "", order: 0 }] }, "경제 섹션", "비즈니스·경제", true)[0].extra?.kind).toBe("section_latest");
  });
  it("네이트: 두 번 읽은 키워드를 순위별로 합침, 판은 커뮤니티, 스포츠 탭만 카테고리", () => {
    const kws = mergeKeywordSamples([[{ rank: 1, keyword: "가", url: "", change: "up", delta: "1" }], [{ rank: 6, keyword: "바", url: "", change: "new", delta: "" }, { rank: 1, keyword: "다른", url: "", change: "", delta: "" }]]);
    expect(kws.map((k) => [k.rank, k.title])).toEqual([[1, "가"], [6, "바"]]);
    expect(pannItems([{ rank: 1, title: "글", url: "u", comments: 3 }])[0].extra?.community).toBe(true);
    expect(hotNewsItems([{ tab: 2, rank: 1, title: "골", url: "a", change: "" }, { tab: 3, rank: 2, title: "열애", url: "b", change: "" }, { tab: 3, rank: 3, title: "중복", url: "b", change: "" }]).map((i) => [i.source, i.category])).toEqual([
      ["네이트 실시간 급상승 관심뉴스(스포츠)", "스포츠"],
      ["네이트 실시간 급상승 관심뉴스(연예)", ""],
    ]);
  });
  it("다음: 처음 발견된 페이지의 카테고리 유지, 마지막 '몇 분 전' 사용", () => {
    const seen = new Set<string>();
    const a = articleItems([{ url: "u1", title: "기사", infos: ["아시아경제", "44분 전"] }], "다음 경제", "비즈니스·경제", seen);
    const b = articleItems([{ url: "u1", title: "기사", infos: [] }, { url: "u2", title: "다른", infos: ["매체"] }], "다음 홈", "", seen);
    expect(a[0]).toMatchObject({ press: "아시아경제", ageMinutes: 44, category: "비즈니스·경제", rank: 1 });
    expect(b.map((i) => [i.url, i.rank])).toEqual([["u2", 2]]);
  });
});

const exe = process.env.CHROMIUM_EXECUTABLE_PATH?.trim() || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
let browser: Browser | null = null;
let page: Page;

describe("추출 스크립트를 픽스처 HTML 에 실제로 실행", () => {
  beforeAll(async () => {
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
      page = await browser.newPage();
      await page.setContent(readFileSync(`${dir}/pages.html`, "utf8"));
    } catch {
      browser = null;
    }
  }, 30_000);
  afterAll(() => browser?.close());

  it("네이버 홈판 피드", async ({ skip }) => {
    if (!browser) skip();
    const feed = await run<FeedRow[]>(page, S.NAVER_HOME_FEED);
    expect(feed.map((f) => [f.title, f.service, f.imp_rank, f.time])).toEqual([
      ["아이폰 18 사전예약 성공 후기", "BLOG", 3, "14시간 전"],
      ["가을 캠핑 준비물", "BLOG", 1, "방금 전"],
      ["언박싱 쇼츠", "", null, ""],
    ]);
    expect(feedToItems(feed).map((i) => i.title)).toEqual(["가을 캠핑 준비물", "아이폰 18 사전예약 성공 후기", "언박싱 쇼츠"]);
  });

  it("네이버 엔터 랭킹·언론사 랭킹·섹션 헤드라인", async ({ skip }) => {
    if (!browser) skip();
    const ent = entertainItems(await run(page, S.NAVER_RANKING_ENTERTAIN), "엔터 많이 본 뉴스", "");
    expect(ent.map((i) => [i.rank, i.title, i.views])).toEqual([[1, "배우 새 드라마 첫방", 70294], [3, "아이돌 컴백", 47000]]);
    const press = pressItems(await run(page, S.NAVER_RANKING_PRESS), "뉴스 랭킹(종합)", "", 5);
    expect(press.map((i) => [i.press, i.rank, i.ageMinutes])).toEqual([["한국경제", 1, 300]]);
    const sec = sectionItems(await run(page, S.NAVER_RANKING_SECTION), "경제 섹션", "비즈니스·경제", false);
    expect(sec.map((i) => [i.title, i.press, i.ageMinutes, i.category])).toEqual([["원산지 표시위반 단속", "연합뉴스", 44, "비즈니스·경제"]]);
  });

  it("네이트 실시간 키워드·판·관심뉴스", async ({ skip }) => {
    if (!browser) skip();
    const kws = mergeKeywordSamples([await run(page, S.NATE_KEYWORDS)]);
    expect(kws.map((k) => [k.rank, k.title, k.extra?.change])).toEqual([[1, "아이폰 18", "up"], [2, "추석 기차표", "new"]]);
    expect(pannItems(await run(page, S.NATE_PANN_LIST)).map((i) => [i.title, i.extra?.comments])).toEqual([["시어머니 이야기", 120]]);
    expect(hotNewsItems(await run(page, S.NATE_HOT_NEWS)).map((i) => [i.title, i.rank])).toEqual([["원산지 단속 결과", 1], ["손흥민 골", 3]]);
  });

  it("구글 트렌드 행·카테고리 메뉴", async ({ skip }) => {
    if (!browser) skip();
    const rows = (await run<string[][]>(page, S.GOOGLE_TRENDS_ROWS)).map(parseTrendRow);
    expect(rows[0]).toMatchObject({ keyword: "고기", volume: 5000, pct: 1000, startedMin: 60, status: "활성", related: ["돼지고기 원산지"] });
    expect(await run(page, S.GOOGLE_TRENDS_MENU_COUNTS)).toEqual({ "3": 12, "15": 0 });
  });

  it("다음 기사·실시간 트렌드", async ({ skip }) => {
    if (!browser) skip();
    const arts = articleItems(await run(page, S.DAUM_ARTICLES), "다음 경제", "비즈니스·경제", new Set());
    expect(arts.map((a) => [a.title, a.press, a.ageMinutes])).toEqual([["원산지 표시 단속 최다 적발", "아시아경제", 44]]);
    const trends = (await run<{ text: string }[]>(page, S.DAUM_TRENDS)).map((t) => parseDaumTrend(t.text));
    expect(trends[0]).toEqual([1, "트럼프 대이란 대응", "신규"]);
    expect(trends).toHaveLength(5);
  });
});
