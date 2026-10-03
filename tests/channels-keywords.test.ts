/**
 * 실시간 소재 → 검색 키워드 (keywords.ts): AI 해석 → 데이터 측정 → 데이터 선택.
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

const llm = vi.hoisted(() => ({ route: "claude-code", stories: [] as unknown[], checks: [] as unknown[] }));
vi.mock("@/lib/llm", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm")>()),
  routeFor: async () => llm.route,
  generateJson: async (req: { name: string }) => (req.name === "channelKeywordCheck" ? { checks: llm.checks } : { stories: llm.stories }),
}));

import { checkCandidates, chooseKeyword, contextFor, interpretStories, measurePhrases } from "@/lib/topics/channels/keywords";
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
  llm.checks = [];
});

describe("측정 — 후보는 제안 검색어를 통째로 포함한 확장만", () => {
  it("'하나은행 해킹' 확장에 '하나은행카드'(다른 주제)는 안 들어옴", async () => {
    net.ac = { "하나은행 해킹": ["하나은행 해킹 피해 확인", "하나은행카드", "하나은행 해킹 보상"] };
    net.vol = { 하나은행해킹: 25, 하나은행해킹피해확인: 12, 하나은행카드: 90000 };
    net.docs = { 하나은행해킹: 3000, 하나은행해킹피해확인: 40 };
    const c = await measurePhrases(["하나은행 해킹"], { network: true, docs: 6 });
    expect(c.map((x) => x.keyword).sort()).toEqual(["하나은행 해킹", "하나은행 해킹 보상", "하나은행 해킹 피해 확인"]);
    expect(c.find((x) => x.keyword === "하나은행 해킹")).toMatchObject({ volume: 25, documentCount: 3000 });
  });

  it("검색량이 있는 롱테일 상위만 문서수를 잼 (헤드 키워드·검색량 없음은 안 잼)", async () => {
    net.ac = { 은행: ["은행 금리 비교", "은행 영업시간"] };
    net.vol = { 은행: 90000, 은행금리비교: 4000, 은행영업시간: 30000 };
    net.docs = { 은행금리비교: 200000, 은행영업시간: 90000 };
    await measurePhrases(["은행"], { network: true, docs: 6 });
    expect(net.docCalls.sort()).toEqual(["은행 금리 비교", "은행 영업시간"]);
    net.docCalls.length = 0;
    await measurePhrases(["은행"], { network: true }); // 기본은 검색량만 (문서수는 후보 확인 뒤에)
    expect(net.docCalls).toEqual([]);
  });

  it("오프라인이면 제안 검색어만 (네트워크 안 씀)", async () => {
    const c = await measurePhrases(["코스피 7000 회복"], { network: false });
    expect(c.map((x) => x.keyword)).toEqual(["코스피 7000 회복"]);
    expect(net.docCalls).toEqual([]);
  });
});

describe("선택 — 데이터가 고르고, 고른 키워드는 항상 문서수까지", () => {
  it("검색량 확인된 롱테일 중 경쟁·검색량 점수 최고", async () => {
    net.ac = { "삼성 반도체 성과급": ["삼성 반도체 성과급 지급일"] };
    net.vol = { 삼성반도체성과급: 2470, 삼성반도체성과급지급일: 300 };
    net.docs = { 삼성반도체성과급: 400000, 삼성반도체성과급지급일: 50 };
    const c = await measurePhrases(["삼성 반도체 성과급"], { network: true, docs: 6 });
    const { pick, reason } = await chooseKeyword(c, ["삼성 반도체 성과급"], true);
    expect(reason).toBe("longtail");
    expect(pick.keyword).toBe("삼성 반도체 성과급 지급일"); // 검색량은 작아도 경쟁이 훨씬 덜함
  });

  it("검색량이 아직 없는 신조어면 헤드가 아닌 첫 제안 검색어 + 문서수 측정 (미확인으로 남지 않게)", async () => {
    net.docs = { ai침투: 120, ai침투흔적: 8 };
    const c = await measurePhrases(["AI", "AI 침투 흔적"], { network: true, docs: 6 });
    const { pick, reason } = await chooseKeyword(c, ["AI", "AI 침투 흔적"], true);
    expect(reason).toBe("phrase");
    expect(pick).toMatchObject({ keyword: "AI 침투 흔적", volume: null, documentCount: 8 });
  });
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

  it("AI 가 무슨 일인지 모른다고 하면 추천 대상에서 빠짐, 아는 소재는 제안 검색어 사용", async () => {
    const [a, b] = buildGroups([trend("배당"), art("코스피 7000선 회복…외국인 순매수")], 1.6, true);
    llm.stories = [
      { groupId: a.id, hasStory: false, summary: "", phrases: [] },
      { groupId: b.id, hasStory: true, summary: "코스피 7000선 회복", phrases: ["코스피 7000 회복", " '코스피 전망' "] },
    ];
    const s = await interpretStories([a, b], new Map(), () => undefined);
    expect(s.get(a.id)!.hasStory).toBe(false);
    expect(s.get(b.id)).toMatchObject({ hasStory: true, by: "ai", phrases: ["코스피 7000 회복", "코스피 전망"] });
  });

  it("수동 모드면 AI 해석 없이 대표어로 (기사·맥락이 있어야 추천)", async () => {
    llm.route = "manual";
    const [a, b] = buildGroups([trend("배당"), art("코스피 7000선 회복…외국인 순매수")], 1.6, true);
    const s = await interpretStories([a, b], new Map([[a.id, []]]), () => undefined);
    expect(s.get(a.id)).toMatchObject({ hasStory: false, by: "fallback" });
    expect(s.get(b.id)).toMatchObject({ hasStory: true, by: "fallback" });
  });
});

describe("확인·같은 사건 — 데이터로 고르기 전에 사건과 어긋나는 후보·중복 사건 제거", () => {
  it("'코스피 7000 회복' 사건에 '코스피 7000선 붕괴'는 검색량이 커도 고르지 않음", async () => {
    const [g] = buildGroups([art("코스피 7000선 회복…외국인 순매수")], 1.6, true);
    llm.stories = [{ groupId: g.id, hasStory: true, summary: "코스피 7000선 회복", phrases: ["코스피 7000"], sameAs: null }];
    net.ac = { "코스피 7000": ["코스피 7000선 붕괴", "코스피 7000선 회복"] };
    net.vol = { 코스피7000: 20000, 코스피7000선붕괴: 9395, 코스피7000선회복: 2625 };
    net.docs = { 코스피7000선붕괴: 4606, 코스피7000선회복: 3000 };
    llm.checks = [{ groupId: g.id, ok: ["코스피 7000선 회복"] }];
    const { planned } = await planTopics([g], [], { limit: 1, existingKeywords: new Set(), network: true, log: () => undefined });
    expect(planned[0].pick.keyword).toBe("코스피 7000선 회복");
    expect(net.docCalls).not.toContain("코스피 7000선 붕괴"); // 걸러진 후보에 문서수 측정 자리를 쓰지 않음
    expect(planned[0].candidates.map((c) => c.keyword)).not.toContain("코스피 7000선 붕괴");
  });

  it("앞 소재와 같은 사건은 하나만 남김", async () => {
    const [a, b] = buildGroups([art("신한은행 고객정보 유출…금융권 비상"), art("금융위 긴급회의 소집, 보안 점검")], 1.6, true);
    llm.stories = [
      { groupId: a.id, hasStory: true, summary: "신한은행 해킹", phrases: ["신한은행 해킹"], sameAs: null },
      { groupId: b.id, hasStory: true, summary: "은행 해킹에 금융위 긴급회의", phrases: ["금융위 긴급회의"], sameAs: a.id },
    ];
    const r = await planTopics([a, b], [], { limit: 2, existingKeywords: new Set(), network: false, log: () => undefined });
    expect(r.planned.map((p) => p.g.id)).toEqual([a.id]);
    expect(r.sameEvent.map((g) => g.id)).toEqual([b.id]);
  });

  it("AI 확인을 못 쓰면(수동) 거르지 않음", async () => {
    llm.route = "manual";
    const c = { keyword: "코스피 전망", sources: [], volume: 100, compIdx: null, adDepth: null, documentCount: null, competitionScore: null, score: 0 };
    expect((await checkCandidates([{ id: 1, summary: "x", candidates: [c] }], () => undefined)).size).toBe(0);
  });
});
