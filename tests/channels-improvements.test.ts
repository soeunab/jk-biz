/**
 * 실시간 트렌드 발굴 — 원본(contents-finder)에서 개선한 동작 (config.tuning 및 discover.ts).
 * 원본 동작 자체는 channels-parity.test.ts 가 ORIGINAL_CHANNEL_CONFIG 로 계속 검증합니다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";

const created: Record<string, unknown>[] = [];
let keywordRows: { keyword: string; normalizedKeyword: string }[] = [];
let recentRows: { signals: unknown }[] = [];
vi.mock("@/lib/db", () => ({
  db: {
    setting: { findUnique: async () => null },
    affiliateProduct: { findMany: async () => [] },
    topic: {
      findMany: async (q: { where?: { origin?: string } }) => (q?.where?.origin ? recentRows : keywordRows),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `t${created.length}`, ...data };
      },
    },
  },
}));

const llm = vi.hoisted(() => ({ route: "claude-code", categories: [] as { groupId: number; category: string }[], calls: [] as string[] }));
vi.mock("@/lib/llm", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm")>()),
  routeFor: async () => llm.route,
  generateJson: async (req: { name: string; mock: () => unknown }) => {
    llm.calls.push(req.name);
    return req.name === "channelCategories" ? { items: llm.categories } : req.mock();
  },
}));

import { analyzeItems, discoverFromChannels, isSeenStory, reclassifyAmbiguous, rescore, seenStories } from "@/lib/topics/channels/discover";
import { buildGroups } from "@/lib/topics/channels/crossref";
import { DEFAULT_CHANNEL_CONFIG, ORIGINAL_CHANNEL_CONFIG } from "@/lib/topics/channels/config";
import { classifyWeighted, hasWord, NO_RESTRICTION, pickCategory } from "@/lib/topics/channels/filters";
import { computeMetrics } from "@/lib/topics/channels/scoring";
import { clusterAgeMinutes, parseAgeMinutes, parseAgoMinutes } from "@/lib/topics/channels/text";
import type { ChannelItem } from "@/lib/topics/channels/types";

const FIXTURE = path.resolve("tests/fixtures/channels/items.json");
const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const fixtureItems = () =>
  (JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>[]).map((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [camel(k), v])) as ChannelItem);

const logs: string[] = [];
const ctx = { log: async (m: string) => void logs.push(m), progress: async () => undefined } as never;
const art = (title: string, extra: Partial<ChannelItem> = {}): ChannelItem => ({ channel: "daum", source: "다음 홈(이 시각 주요뉴스)", title, url: `https://v.daum.net/v/${encodeURIComponent(title)}`, ageMinutes: 30, ...extra });
const trend = (title: string, extra: Partial<ChannelItem> = {}): ChannelItem => ({ channel: "google_trends", source: "구글 트렌드 실시간 인기(24시간)", title, rank: 1, growthPct: 500, ageMinutes: 60, extra: { status: "활성", related: [] }, ...extra });

beforeEach(() => {
  created.length = 0;
  logs.length = 0;
  keywordRows = [];
  recentRows = [];
  llm.route = "claude-code";
  llm.categories = [];
  llm.calls.length = 0;
  process.env.CHANNELS_FIXTURE = FIXTURE;
  process.env.LLM_PROVIDER = "mock";
});

describe("시간 파싱 (#6) — 원본이 null(=신선 통과)로 두던 형식", () => {
  const now = new Date("2026-10-02T19:52:00+09:00");
  it("주·개월·어제·절대 날짜", () => {
    expect(parseAgeMinutes("1주 전", now)).toBe(10_080);
    expect(parseAgeMinutes("2개월 전", now)).toBe(86_400);
    expect(parseAgeMinutes("어제", now)).toBe(1440);
    expect(parseAgeMinutes("2026.10.01. 오후 3:12", now)).toBe(28 * 60 + 40);
    expect(parseAgeMinutes("2026-10-02 18:52", now)).toBe(60);
    expect(parseAgeMinutes("10.02. 09:00", now)).toBe(652);
  });
  it("원본 형식은 그대로, 시각이 아닌 글자는 null", () => {
    expect(parseAgeMinutes("56분 전", now)).toBe(56);
    expect(parseAgeMinutes("3시간전", now)).toBe(180);
    expect(parseAgeMinutes("6시간 동안 지속됨", now)).toBeNull();
    expect(parseAgeMinutes("EBN산업경제", now)).toBeNull();
    expect(parseAgoMinutes("1주 전")).toBeNull(); // 원본 함수는 바꾸지 않음 (동등성)
  });
  it("네이버 섹션 헤드라인은 기사 시각이 없어 클러스터 생성 시각을 씀", () => {
    expect(clusterAgeMinutes("/cluster/c_202610021430_00001216/section/101?oid=277", now)).toBe(322);
    expect(clusterAgeMinutes("", now)).toBeNull();
  });
});

describe("카테고리 분류 (#3)", () => {
  it("공통어 하나로 엉뚱한 분야가 되지 않음", () => {
    expect(classifyWeighted("스타벅스 가을 신메뉴")).toMatchObject({ category: "미분류", ambiguous: true });
    expect(classifyWeighted("오픈AI 기업가치 상장 추진").category).toBe("비즈니스·경제");
    expect(classifyWeighted("클로드 새 모델 공개, 제미나이와 비교").category).toBe("IT·컴퓨터");
    expect(classifyWeighted("가을 캠핑 준비물 체크리스트").category).toBe("국내여행");
  });
  it("공통어뿐이거나 동점이면 애매함 → AI 재분류 대상", () => {
    expect(classifyWeighted("출시 업데이트 소식").ambiguous).toBe(true); // IT·게임 공통어 동점
    expect(classifyWeighted("갤럭시 신제품 출시").ambiguous).toBe(false);
    expect(classifyWeighted("아무 관련 없는 문장").ambiguous).toBe(true);
    expect(classifyWeighted("코스피 상승에 주식 투자 늘어").ambiguous).toBe(false);
  });
  it("영문 낱말은 단어 경계로만", () => {
    expect(hasWord("costco 할인", "OS")).toBe(false);
    expect(hasWord("새 OS 업데이트", "OS")).toBe(true);
    expect(hasWord("OpenAI 새 모델", "AI")).toBe(false);
    expect(hasWord("오픈AI 새 모델", "AI")).toBe(true);
  });
  it("수집 페이지 'A,B' 지정은 제목으로 둘 중 하나", () => {
    expect(pickCategory("다낭 무비자 입국 확대", "국내여행,세계여행")).toBe("세계여행");
    expect(pickCategory("단풍 축제 명소", "국내여행,세계여행")).toBe("국내여행");
    expect(pickCategory("아무 제목", "국내여행,세계여행")).toBe("국내여행");
    expect(pickCategory("아무 제목", "건강·의학")).toBe("건강·의학");
  });
});

describe("소재 묶기 (#5)", () => {
  const items = [art("오픈AI 기업가치 5000억달러 상장 추진"), { ...art("오픈AI 새 추론 모델 공개"), channel: "google_news", source: "구글 뉴스 과학/기술" }];
  it("기사 시드 그룹은 희귀 토큰 하나만 같으면 묶지 않음", () => {
    expect(buildGroups(items, 1.6, false)).toHaveLength(1); // 원본: '오픈ai' 1.6점 = 문턱
    expect(buildGroups(items, 1.6, true)).toHaveLength(2);
  });
  it("실시간 키워드 시드 그룹은 원본 규칙 그대로", () => {
    expect(buildGroups([trend("오픈AI"), ...items], 1.6, true)).toHaveLength(1);
  });
});

describe("신선도·채널 수 (#7, #11)", () => {
  it("가장 최근 기사에 네이버 기사 시각도 포함", () => {
    const g = buildGroups([art("기름값 하락 주유소", { ageMinutes: 300 }), { channel: "naver_ranking", source: "뉴스 랭킹(종합)", title: "기름값 하락 주유소 가격", ageMinutes: 20, extra: { kind: "press_rank" } }])[0];
    expect(computeMetrics(g, ORIGINAL_CHANNEL_CONFIG.tuning).newestAge).toBe(300);
    expect(computeMetrics(g, DEFAULT_CHANNEL_CONFIG.tuning).newestAge).toBe(20);
  });
  it("세부 섹션 최신 기사는 채널 수에 안 셈 (인기순이 아님)", () => {
    const g = buildGroups([art("단풍 축제 명소 개방"), { channel: "naver_ranking", source: "여행/레저", title: "단풍 축제 명소 개방 일정", category: "국내여행", ageMinutes: 10, extra: { kind: "section_latest" } }])[0];
    expect(computeMetrics(g, ORIGINAL_CHANNEL_CONFIG.tuning).channels).toEqual(["naver_ranking", "daum"]);
    expect(computeMetrics(g, DEFAULT_CHANNEL_CONFIG.tuning).channels).toEqual(["daum"]);
  });
});

describe("중복 (#1)", () => {
  it("최근 저장한 소재와 근거 기사가 겹치면 같은 사건", () => {
    const g = buildGroups([art("국내 기름값 19주 연속 하락…주유소 100원 내려"), art("휘발유 가격 하락세 계속")], 1.6, true);
    const seen = seenStories([{ signals: { evidence: [{ channel: "daum", title: "국내 기름값 19주 연속 하락…주유소 100원 내려", url: "https://other.example/1" }] } }, { signals: null }]);
    expect(isSeenStory(g[0], seen)).toBe(true);
    expect(isSeenStory(g[1], seen)).toBe(false);
    expect(isSeenStory(g[0], seenStories([]))).toBe(false);
  });

  it("같은 사건은 건너뛰고, 그래도 요청한 개수만큼 저장", async () => {
    const goGi = analyzeItems(fixtureItems(), ["비즈니스·경제"]).ranked.find((x) => x.label === "고기")!;
    recentRows = [{ signals: { evidence: goGi.items.map((i) => ({ channel: i.channel, title: i.title, url: i.url })) } }];
    const r = await discoverFromChannels({ category: "비즈니스·경제", limit: 3 }, ctx);
    expect(r.created).toBe(3);
    expect(created.map((t) => t.keyword)).not.toContain("고기");
    expect(logs.some((l) => l.includes("같은 사건"))).toBe(true);
  });

  it("저장 단계에서 키워드가 겹쳐 빠져도 예비 소재로 개수를 채움", async () => {
    keywordRows = [{ keyword: "국내 기름값", normalizedKeyword: "국내기름값" }]; // 소재명은 달라 선정 단계는 통과, 저장 때 키워드가 겹침
    const r = await discoverFromChannels({ category: "비즈니스·경제", limit: 3 }, ctx);
    expect(r.created).toBe(3);
    expect(created.map((t) => t.keyword)).not.toContain("국내 기름값");
  });
});

describe("신선도 필터 (#4)", () => {
  it("구글 트렌드는 시작이 6시간 전이어도 아직 '활성'이면 유지, 끝난 것은 제외", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ch-"));
    const file = path.join(dir, "items.json");
    writeFileSync(
      file,
      JSON.stringify([
        trend("단풍 명소", { ageMinutes: 600, extra: { status: "활성", related: [] } }),
        trend("추석 귀성길", { ageMinutes: 600, extra: { status: "10시간 동안 지속됨", related: [] } }),
        // 기사 맥락이 있어야 추천 대상 (실시간 검색어 한 줄뿐인 소재는 무슨 일인지 몰라 빠짐)
        art("단풍 명소 이번 주말 절정"),
      ]),
    );
    process.env.CHANNELS_FIXTURE = file;
    await discoverFromChannels({ category: NO_RESTRICTION, limit: 5 }, ctx);
    expect(created.map((t) => t.keyword)).toEqual(["단풍 명소"]);
  });
});

describe("AI 재분류 (#3)", () => {
  const items = () => [
    art("클로드 새 모델 공개 성능 비교"),
    art("오픈AI 기업가치 상장 추진 IPO"),
    art("삼성전자 3분기 실적 영업이익 증가"),
    art("출시 업데이트 소식"),
  ];

  it("애매한 소재만 AI 에 보내고, 결과로 다시 점수화", async () => {
    const a = analyzeItems(items(), ["IT·컴퓨터"]);
    const unsure = a.groups.find((g) => g.label === "출시 업데이트 소식")!;
    expect(unsure.categoryAmbiguous).toBe(true);
    llm.categories = [{ groupId: unsure.id, category: "IT·컴퓨터" }];
    expect(await reclassifyAmbiguous(a.groups, (m) => logs.push(m))).toBe(1);
    const b = rescore(a.groups, ["IT·컴퓨터"]);
    expect(b.ranked.map((g) => g.label)).toContain("출시 업데이트 소식");
    expect(logs.some((l) => l.includes("AI 로 재분류"))).toBe(true);
  });

  it("수동 모드면 AI 재분류를 건너뜀 (붙여넣기 작업을 늘리지 않음)", async () => {
    llm.route = "manual";
    const a = analyzeItems(items(), ["IT·컴퓨터"]);
    expect(await reclassifyAmbiguous(a.groups, (m) => logs.push(m))).toBe(0);
    expect(llm.calls).not.toContain("channelCategories");
  });
});

describe("저장 값 (#10)", () => {
  it("검색 의도는 키워드로 판정", async () => {
    await discoverFromChannels({ category: "비즈니스·경제", limit: 3 }, ctx);
    expect(created.every((t) => typeof t.intent === "string")).toBe(true);
    expect(created.every((t) => t.targetPlatform === "NAVER")).toBe(true);
  });
});
