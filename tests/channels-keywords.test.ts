/**
 * 실시간 소재 → 메인 키워드(씨드) (keywords.ts): AI 해석 → 네이버 검색량·문서수로 확인. 롱테일은 여기서 만들지 않음.
 * 네이버 API 는 실제 응답 모양으로 흉내 냅니다 (2026-10-02~03 실측에서 문제가 된 사례 기반).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({
  ac: {} as Record<string, string[]>,
  vol: {} as Record<string, number>,
  docs: {} as Record<string, number>,
  docCalls: [] as string[],
}));
const n = (s: string) => s.toLowerCase().replace(/[\s\p{P}]/gu, "");
vi.mock("@/lib/topics/sources", () => ({
  naverAutocomplete: async (q: string) => net.ac[q] ?? [],
  naverSearchAdKeywords: async (hints: string[]) =>
    hints.filter((h) => net.vol[n(h)] != null).map((h) => ({ keyword: h, monthlyPc: 0, monthlyMobile: net.vol[n(h)], monthlyClicks: 0, compIdx: "중간", adDepth: 5 })),
  naverBlogDocCount: async (q: string) => {
    net.docCalls.push(q);
    return net.docs[n(q)] ?? null;
  },
  naverRelatedSearch: async () => [],
  naverTrendMomentum: async () => ({}),
}));

const llm = vi.hoisted(() => ({ route: "claude-code", stories: [] as unknown[] }));
vi.mock("@/lib/llm", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm")>()),
  routeFor: async () => llm.route,
  generateJson: async () => ({ stories: llm.stories }),
}));

import { chooseMain, contextFor, interpretStories, type Story } from "@/lib/topics/channels/keywords";
import { planTopics } from "@/lib/topics/channels/discover";
import { buildGroups } from "@/lib/topics/channels/crossref";
import type { ChannelItem } from "@/lib/topics/channels/types";

const art = (title: string, channel = "daum"): ChannelItem => ({ channel, source: "다음 홈(이 시각 주요뉴스)", title, url: `https://x/${encodeURIComponent(title)}`, ageMinutes: 30 });
const trend = (title: string): ChannelItem => ({ channel: "google_trends", source: "구글 트렌드 실시간 인기(24시간)", title, growthPct: 1000, ageMinutes: 60, extra: { status: "활성", related: [] } });

beforeEach(() => {
  net.ac = {};
  net.vol = {};
  net.docs = {};
  net.docCalls.length = 0;
  llm.route = "claude-code";
  llm.stories = [];
});

describe("해석 — 기사 없는 키워드형 소재", () => {
  const pool = [art("신한·국민 이어 하나은행도 해킹…은행권 비상"), art("은행 예금금리 하락", "google_news"), art("자동차 신차 출시"), art("[오늘의 설교] 당신은 행복한 사람입니다")];

  it("같은 단어가 나온 기사를 맥락으로 붙임 (채널 다양하게)", () => {
    const g = buildGroups([trend("은행")], 1.6, true)[0];
    // 단어 앞부분 일치만 ('은행권'은 걸리고 '당신은 행복한'은 안 걸림 — 띄어쓰기 살려 비교)
    expect(contextFor(g, pool).map((i) => i.title)).toEqual(["신한·국민 이어 하나은행도 해킹…은행권 비상", "은행 예금금리 하락"]);
    const withArticle = buildGroups([trend("코스피"), art("코스피 7000선 회복")], 1.6, true)[0];
    expect(contextFor(withArticle, pool)).toEqual([]); // 기사가 있으면 그대로
  });

  it("AI 가 무슨 일인지 모른다고 하면 추천 대상에서 빠짐, 아는 소재는 메인 키워드 + 대안", async () => {
    const [a, b] = buildGroups([trend("배당"), art("코스피 7000선 회복…외국인 순매수")], 1.6, true);
    llm.stories = [
      { groupId: a.id, hasStory: false, summary: "", mainKeyword: "", phrases: [] },
      { groupId: b.id, hasStory: true, summary: "코스피 7000선 회복", mainKeyword: " '코스피 7000' ", phrases: ["코스피 7000 회복", "코스피 7000"] },
    ];
    const s = await interpretStories([a, b], new Map(), () => undefined);
    expect(s.get(a.id)!.hasStory).toBe(false);
    expect(s.get(b.id)).toMatchObject({ hasStory: true, by: "ai", main: "코스피 7000", phrases: ["코스피 7000 회복"] }); // 메인과 같은 대안은 뺌
  });

  it("수동 모드면 AI 해석 없이 대표어로 (기사·맥락이 있어야 추천)", async () => {
    llm.route = "manual";
    const [a, b] = buildGroups([trend("배당"), art("코스피 7000선 회복…외국인 순매수")], 1.6, true);
    const s = await interpretStories([a, b], new Map([[a.id, []]]), () => undefined);
    expect(s.get(a.id)).toMatchObject({ hasStory: false, by: "fallback" });
    expect(s.get(b.id)).toMatchObject({ hasStory: true, by: "fallback" });
    expect(s.get(b.id)!.main.length).toBeGreaterThan(1); // 대표어를 메인 키워드로
  });
});

describe("메인 키워드 확정 — 데이터로 확인", () => {
  const story = (main: string, phrases: string[]): Story => ({ hasStory: true, summary: "x", main, phrases, by: "ai" });

  it("AI 메인 키워드에 검색량이 잡히면 그대로 + 문서수 측정", async () => {
    net.vol = { 신한은행유출: 10870, 신한은행해킹: 30000 };
    net.docs = { 신한은행유출: 4200 };
    const r = await chooseMain(story("신한은행 유출", ["신한은행 해킹"]), true);
    expect(r).toMatchObject({ measured: true, main: { keyword: "신한은행 유출", volume: 10870, documentCount: 4200 } });
    expect(r.alternates.map((c) => c.keyword)).toEqual(["신한은행 해킹"]);
  });

  it("메인 키워드에 검색량이 없으면 검색량 잡힌 대안 중 가장 큰 것 — 대상 이름 하나뿐인 헤드('신한은행')는 제외", async () => {
    net.vol = { 신한은행: 1194200, 신한은행정보유출: 900 };
    const r = await chooseMain(story("신한은행 고객정보 침해", ["신한은행", "신한은행 정보유출"]), true);
    expect(r.main.keyword).toBe("신한은행 정보유출");
    expect(r.measured).toBe(true);
  });

  it("아무것도 검색량이 없으면(막 터진 이슈) AI 메인 키워드 그대로, measured=false, 문서수는 측정", async () => {
    net.docs = { 아르곤출시: 12 };
    const r = await chooseMain(story("아르곤 출시", ["아르곤 사용법"]), true);
    expect(r).toMatchObject({ measured: false, main: { keyword: "아르곤 출시", volume: null, documentCount: 12 } });
  });

  it("오프라인이면 네트워크 없이 AI 메인 키워드", async () => {
    const r = await chooseMain(story("코스피 7000", []), false);
    expect(r.main.keyword).toBe("코스피 7000");
    expect(net.docCalls).toEqual([]);
  });
});

describe("같은 사건·키워드 중복", () => {
  it("앞 소재와 같은 사건은 하나만 남기고, 저장 소재는 메인 키워드만", async () => {
    const [a, b] = buildGroups([art("신한은행 고객정보 유출…금융권 비상"), art("금융위 긴급회의 소집, 보안 점검")], 1.6, true);
    llm.stories = [
      { groupId: a.id, hasStory: true, summary: "신한은행 해킹", mainKeyword: "신한은행 유출", phrases: ["신한은행 해킹"], sameAs: null },
      { groupId: b.id, hasStory: true, summary: "은행 해킹에 금융위 긴급회의", mainKeyword: "금융위 긴급회의", phrases: [], sameAs: a.id },
    ];
    const r = await planTopics([a, b], [], { limit: 2, existingKeywords: new Set(), network: false, log: () => undefined });
    expect(r.planned.map((p) => [p.g.id, p.main.keyword])).toEqual([[a.id, "신한은행 유출"]]);
    expect(r.sameEvent.map((g) => g.id)).toEqual([b.id]);
  });

  it("이미 저장된 메인 키워드는 건너뜀", async () => {
    const [a] = buildGroups([art("신한은행 고객정보 유출…금융권 비상")], 1.6, true);
    llm.stories = [{ groupId: a.id, hasStory: true, summary: "x", mainKeyword: "신한은행 유출", phrases: [], sameAs: null }];
    const r = await planTopics([a], [], { limit: 2, existingKeywords: new Set(["신한은행유출"]), network: false, log: () => undefined });
    expect(r.planned).toEqual([]);
    expect(r.dupKeyword).toBe(1);
  });
});
