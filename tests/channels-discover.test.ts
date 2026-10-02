/**
 * 실시간 채널 발굴 파이프라인 — 수집(픽스처 모드) → 교차검증·점수 → 제외·주제 밖 분리 → AI 기획(mock) → 저장
 * DB 는 메모리로 흉내 내고, AI 는 LLM_PROVIDER=mock 으로 기존 라우팅을 그대로 탑니다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

const created: Record<string, unknown>[] = [];
let existing: { keyword: string; normalizedKeyword: string }[] = [];
vi.mock("@/lib/db", () => ({
  db: {
    setting: { findUnique: async () => null },
    affiliateProduct: { findMany: async () => [] },
    topic: {
      findMany: async () => existing,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `t${created.length}`, ...data };
      },
    },
  },
}));

import { analyzeItems, discoverFromChannels, evidenceLines } from "@/lib/topics/channels/discover";
import { NO_RESTRICTION } from "@/lib/topics/channels/filters";
import { readFileSync } from "node:fs";
import type { ChannelItem } from "@/lib/topics/channels/types";

const FIXTURE = path.resolve("tests/fixtures/channels/items.json");
const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const items = (JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>[]).map(
  (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [camel(k), v])) as ChannelItem,
);

const logs: string[] = [];
const ctx = { log: async (m: string) => void logs.push(m), progress: async () => undefined } as never;

beforeEach(() => {
  created.length = 0;
  logs.length = 0;
  existing = [];
  process.env.CHANNELS_FIXTURE = FIXTURE;
  process.env.LLM_PROVIDER = "mock";
});

describe("analyzeItems", () => {
  it("추천은 점수순, 부정 사건·정치는 제외, 카테고리 밖은 따로", () => {
    const a = analyzeItems(items, ["비즈니스·경제"]);
    // 원본과 다른 점(config.tuning): '최태원'은 원본에선 미분류(주제 밖, 51점)였는데 가중 분류로 기사 4건 중 1건(IPO)만 경제라
    // '애매함'으로 표시된 채 경제로 들어옴(실제 발굴에선 AI 재분류 대상) — 주제 밖 감점이 빠지고 네이버 랭킹 1시간 전 기사가
    // 신선도에 들어가 74점. SK하닉 소재도 네이버 기사 시각이 신선도에 들어가 29 → 33.
    expect(a.ranked.map((g) => [g.label, g.score])).toEqual([
      ["최태원", 74],
      ["고기", 66],
      ["자영업", 63],
      ["국내 기름값 19주 연속 하락…추석 연휴 고속도로 주유소도 100원↓", 54],
      ["수도권 광역급행철도 c노선", 47],
      ["스타벅스", 45],
      ["‘적자 기업’서 200조 몸값으로…SK하닉 솔리다임, 내년 美 상장 시동", 33],
    ]);
    expect(a.ranked[0].categoryAmbiguous).toBe(true);
    expect(a.ranked.slice(1).every((g) => !g.categoryAmbiguous)).toBe(true);
    expect(a.excluded.map((g) => g.label)).toEqual(["아파트 화재", "국정감사 일정"]);
    expect(a.offTopic.map((g) => g.category)).toContain("IT·컴퓨터");
    expect(a.ranked.every((g) => g.category === "비즈니스·경제")).toBe(true);
  });

  it("'주제 선택 보류'면 카테고리로 거르지 않고 감점도 없음", () => {
    const a = analyzeItems(items, [NO_RESTRICTION]);
    expect(a.offTopic).toHaveLength(0);
    expect(a.ranked.some((g) => g.label === "아이폰 18 사전예약")).toBe(true);
    expect(a.ranked.flatMap((g) => g.reasons).some((r) => r.includes("주제 밖"))).toBe(false);
  });

  it("방송사·포털 이름 그 자체인 키워드형 항목은 소재에서 뺌 (ignore_keywords)", () => {
    const extra: ChannelItem = { channel: "google_trends", source: "구글 트렌드 실시간 인기(24시간)", title: "유튜브", rank: 1, growthPct: 1000, extra: { related: [] } };
    const a = analyzeItems([...items, extra], [NO_RESTRICTION]);
    expect(a.groups.some((g) => g.label === "유튜브")).toBe(false);
  });

  it("AI 에게 주는 근거 줄은 수집 값만", () => {
    const g = analyzeItems(items, ["비즈니스·경제"]).ranked.find((x) => x.label === "고기")!;
    const lines = evidenceLines(g);
    expect(lines).toContain("구글 트렌드 / 구글 트렌드 실시간 인기(24시간) / 고기 (검색량 1,000%↑, 1시간 전)");
    expect(lines.split("\n")).toHaveLength(5);
  });
});

describe("discoverFromChannels", () => {
  it("추천 소재만 저장, 모르는 지표는 null, 근거는 signals 에 구조화", async () => {
    const r = await discoverFromChannels({ category: "비즈니스·경제", limit: 3 }, ctx);
    expect(r).toMatchObject({ created: 3, excluded: 2 });
    // "자영업"은 참여 항목 대부분(1320·420·420분)이 6시간을 넘어 수집 단계에서 빠지고 신선한 항목(120분)
    // 하나만 남아 채널 수·점수가 크게 줄어 3위 밖으로 밀려남 — "수도권 광역급행철도 c노선"이 그 자리로 올라옴
    expect(created.map((t) => t.keyword)).toEqual(["고기", "국내 기름값", "수도권 광역급행철도 c노선"]);
    const t = created[0] as Record<string, unknown> & { signals: Record<string, unknown> };
    expect(t).toMatchObject({
      origin: "channels",
      category: "비즈니스·경제",
      totalScore: 66,
      confidence: 3,
      verification: "VERIFIED",
      searchVolume: null,
      documentCount: null,
      trendScore: null,
      competitionScore: null,
      tool: "",
      targetPlatform: "NAVER",
    });
    expect(String(t.rationale)).toContain("4개 채널에서 동시 확인");
    expect(t.signals.evidence).toHaveLength(5);
    expect((t.signals.evidence as { url: string | null }[])[0].url).toContain("trends.google.com");
    expect((t.signals.metrics as { trendPct: number }).trendPct).toBe(1000);
    expect((t.signals.channelStatus as { ok: boolean }[]).length).toBe(6);
    // 부정 사건·정치 이슈는 저장하지 않고 로그에만
    expect(created.some((c) => String(c.keyword).includes("화재") || String(c.keyword).includes("국정감사"))).toBe(false);
    expect(logs.some((l) => l.includes("픽스처 모드"))).toBe(true);
    expect(logs.some((l) => l.startsWith("제외(부정 사건·정치)"))).toBe(true);
    expect(logs.some((l) => l.startsWith("주제 밖이지만 화제"))).toBe(true);
  });

  it("이미 저장된 소재는 다시 저장하지 않음", async () => {
    existing = [{ keyword: "고기", normalizedKeyword: "고기" }];
    await discoverFromChannels({ category: "비즈니스·경제", limit: 2 }, ctx);
    expect(created.map((t) => t.keyword)).toEqual(["국내 기름값", "수도권 광역급행철도 c노선"]);
  });

  it("채널 하나만 골라도 동작 (한 채널 소재는 SUGGESTED)", async () => {
    await discoverFromChannels({ category: "비즈니스·경제", limit: 5, channels: ["google_trends"] }, ctx);
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((t) => t.verification === "SUGGESTED" && t.confidence === 1)).toBe(true);
  });

  it("6시간 넘은 자료는 수집 직후(교차검증 전)에 걸러져 소재 구성에 아예 안 들어감", async () => {
    // "스타벅스"의 참여 항목 2건(1260분·1440분)이 전부 6시간 밖이라 수집 단계에서 다 빠지고,
    // 항목이 하나도 안 남아 그룹 자체가 안 만들어짐 — limit 을 넉넉히 줘도 저장 대상이 될 수 없음
    await discoverFromChannels({ category: "비즈니스·경제", limit: 20 }, ctx);
    expect(created.some((t) => t.keyword === "스타벅스")).toBe(false);
    expect(logs.some((l) => l.includes("6시간 넘은 자료") && l.includes("제외"))).toBe(true);
  });
});
