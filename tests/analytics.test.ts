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
  pageviews: 0, clicks: 0, impressions: 0, ctr: 0, position: null, revenue: 0, seoScore: 90, hasAffiliate: true, hasCardNews: true, topQueries: [], ...over,
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
    const out = ruleInsights([], [{ id: "acc", name: "네이버1", platform: "NAVER", published: 2, publishedRecent: 2, pageviews: 0, revenue: 0, rpm: 0 }], [
      { id: "x", title: "오래된 검수", privateAt: new Date(Date.now() - 5 * 86_400_000) },
    ]);
    expect(out.map((o) => o.type)).toEqual(expect.arrayContaining(["CADENCE", "GENERAL"]));
  });
});
