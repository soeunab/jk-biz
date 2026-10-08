import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/analytics/importCsv";
import { ruleInsights } from "@/lib/insights/engine";
import type { PostPerf } from "@/lib/analytics/queries";

describe("csv", () => {
  it("parses quoted cells, CRLF and BOM", () => {
    const rows = parseCsv('﻿날짜,출처,금액\r\n2026-09-01,"쇼핑,커넥트","1,200"\r\n');
    expect(rows).toEqual([["날짜", "출처", "금액"], ["2026-09-01", "쇼핑,커넥트", "1,200"]]);
  });
});

const post = (over: Partial<PostPerf>): PostPerf => ({
  id: "p", title: "제미나이 사용법", platform: "BLOGGER", account: "a", status: "PUBLISHED", remoteUrl: "https://x", publishedAt: new Date(),
  pageviews: 0, clicks: 0, impressions: 0, ctr: 0, position: null, revenue: 0, seoScore: 90, hasAffiliate: true, hasCardNews: true, engagementSec: null, adUnits: 0, topQueries: [], ...over,
});

describe("rule insights", () => {
  it("suggests retitle for high impressions / low CTR and refresh for page-2 rankings", () => {
    const out = ruleInsights([post({ id: "a", impressions: 1000, clicks: 5, ctr: 0.005, position: 12 })], [], []);
    expect(out.map((o) => o.type)).toEqual(expect.arrayContaining(["RETITLE", "REFRESH"]));
  });

  it("suggests monetization and card news for top posts lacking them", () => {
    const out = ruleInsights([post({ id: "b", pageviews: 500, hasAffiliate: false, hasCardNews: false })], [], []);
    expect(out.map((o) => o.type)).toEqual(expect.arrayContaining(["MONETIZE", "CARDNEWS"]));
  });

  it("finds query gaps as next-topic seeds", () => {
    const out = ruleInsights([post({ topQueries: [{ query: "클로드 엑셀 수식", clicks: 3, impressions: 80, position: 9 }] })], [], []);
    const next = out.find((o) => o.type === "NEXT_TOPIC");
    expect(next?.data?.seeds).toEqual(["클로드 엑셀 수식"]);
  });

  it("warns about cadence and review backlog", () => {
    const out = ruleInsights([], [{ id: "acc", name: "네이버1", platform: "NAVER", published: 2, publishedRecent: 2, pageviews: 0, revenue: 0, adpost: null, rpm: 0 }], [
      { id: "x", title: "오래된 검수", privateAt: new Date(Date.now() - 5 * 86_400_000) },
    ]);
    expect(out.map((o) => o.type)).toEqual(expect.arrayContaining(["CADENCE", "GENERAL"]));
  });
});

describe("광고 밀도 vs 체류시간", () => {
  it("광고 2개 이상 글이 15% 이상 덜 읽히면 제안, 표본이 적으면 침묵", async () => {
    const { adDensityInsight } = await import("@/lib/insights/engine");
    const mk = (id: string, adUnits: number, sec: number) => post({ id, platform: "BLOGGER", status: "PUBLISHED", pageviews: 100, engagementSec: sec, adUnits, hasAffiliate: false });
    const heavy = ["a", "b", "c"].map((id) => mk(id, 2, 3000)); // 조회당 30초
    const light = ["d", "e", "f"].map((id) => mk(id, 1, 6000)); // 조회당 60초
    const out = adDensityInsight([...heavy, ...light]);
    expect(out?.type).toBe("AD_DENSITY");
    expect(out?.body).toContain("50% 짧아요");
    expect(adDensityInsight([...heavy.slice(0, 2), ...light])).toBeNull();
  });
});

describe("저성과 글 정리 후보", () => {
  it("발행 90일 넘고 조회·클릭이 거의 없는 글만", () => {
    const old = new Date(Date.now() - 120 * 86_400_000);
    const recent = new Date(Date.now() - 30 * 86_400_000);
    const out = ruleInsights(
      [
        post({ id: "dead", status: "PUBLISHED", publishedAt: old, pageviews: 1, clicks: 0 }),
        post({ id: "young", status: "PUBLISHED", publishedAt: recent, pageviews: 0, clicks: 0 }),
        post({ id: "alive", status: "PUBLISHED", publishedAt: old, pageviews: 40, clicks: 5 }),
      ],
      [],
      [],
    );
    expect(out.filter((i) => i.type === "PRUNE").map((i) => i.postId)).toEqual(["dead"]);
  });
});

describe("홈판형·검색형 배분", () => {
  it("표본 4개 이상이고 목표와 20%p 이상 차이 날 때만", async () => {
    const { homefeedMixInsights } = await import("@/lib/insights/engine");
    const rows = (acc: string, home: number, search: number) => [
      ...Array.from({ length: home }, () => ({ accountId: acc, accountName: acc, format: "HOMEFEED" })),
      ...Array.from({ length: search }, () => ({ accountId: acc, accountName: acc, format: "SEARCH" })),
    ];
    const out = homefeedMixInsights([...rows("low", 1, 5), ...rows("ok", 4, 2), ...rows("few", 0, 3)], 0.7);
    expect(out.map((i) => i.title)).toEqual(["홈판형·검색형 비율: low"]);
  });
});
