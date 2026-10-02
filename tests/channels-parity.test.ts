/**
 * contents-finder(파이썬) → TS 포팅 동등성 테스트.
 * 기대값 tests/fixtures/channels/expected.json 은 원본 파이썬 코드를 그대로 실행해 만든 것입니다
 * (python3 tests/fixtures/channels/gen_expected.py). 픽스처 항목은 example-report.md 의 실제 수집 근거에서 가져왔습니다.
 *
 * 원본과 의도적으로 다르게 바꾼 동작은 config.tuning 스위치로 켜져 있고(기본 설정), 여기서는 ORIGINAL_CHANNEL_CONFIG(전부 끔)로
 * 원본 동작이 그대로 유지되는지 봅니다. 기본 설정과의 차이는 맨 아래 "원본과 다른 점" 블록에 명시합니다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildGroups, type Group } from "@/lib/topics/channels/crossref";
import { scoreGroup } from "@/lib/topics/channels/scoring";
import { DEFAULT_CHANNEL_CONFIG, ORIGINAL_CHANNEL_CONFIG } from "@/lib/topics/channels/config";
import { classifyText, flagText, resolveCategory } from "@/lib/topics/channels/filters";
import { fmtAgo, fmtCount, norm, parseAgoMinutes, parseCount, parsePct, tokens } from "@/lib/topics/channels/text";
import type { ChannelItem } from "@/lib/topics/channels/types";

const dir = "tests/fixtures/channels";
type PyItem = Record<string, unknown>;
const pyItems = JSON.parse(readFileSync(`${dir}/items.json`, "utf8")) as PyItem[];
const expected = JSON.parse(readFileSync(`${dir}/expected.json`, "utf8"));

const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const snake = (k: string) => k.replace(/([A-Z])/g, "_$1").replace(/(\d+)/g, "_$1").toLowerCase().replace(/__/g, "_");

export function fixtureItems(): ChannelItem[] {
  return pyItems.map((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [camel(k), v])) as ChannelItem);
}

function run(include: string[]) {
  const groups = buildGroups(fixtureItems());
  for (const g of groups) scoreGroup(g, ORIGINAL_CHANNEL_CONFIG, include);
  return groups;
}

function asPython(g: Group) {
  const { preempt, ...rest } = g.metrics!;
  const metrics = Object.fromEntries(Object.entries(rest).map(([k, v]) => [snake(k), v]));
  return {
    label: g.label,
    titles: g.items.map((i) => i.title),
    score: g.score,
    reasons: g.reasons,
    category: g.category,
    excluded_reason: g.excludedReason,
    metrics: { ...metrics, preempt },
    flags: g.flags,
  };
}

describe("교차검증·점수 — 파이썬 원본과 동일", () => {
  for (const [key, include] of [["groups_business", ["비즈니스·경제"]], ["groups_it", ["IT·컴퓨터"]]] as const) {
    it(`${include[0]} 기준 그룹 구성·점수·근거 문장·카테고리·제외 사유`, () => {
      const got = run([...include]).map(asPython);
      expect(got.map((g) => g.label)).toEqual(expected[key].map((g: { label: string }) => g.label));
      for (const [i, g] of got.entries()) expect(g).toEqual(expected[key][i]);
    });
  }

  it("example-report 의 실제 점수 재현 (고기 66 · 자영업 63 · 최태원 51 · 수도권 광역급행철도 c노선 47 · 스타벅스 45)", () => {
    const by = Object.fromEntries(run(["비즈니스·경제"]).map((g) => [g.label, g]));
    expect(by["고기"].score).toBe(66);
    expect(by["고기"].reasons).toContain("구글 트렌드 검색량 1,000%↑ (1시간 전부터) → 당일 즉시 소재");
    expect(by["고기"].reasons).toContain("논란성 표현 포함(적발, 위반) - 감점");
    expect(by["자영업"].score).toBe(63);
    expect(by["최태원"].score).toBe(51);
    expect(by["수도권 광역급행철도 c노선"].score).toBe(47);
    expect(by["수도권 광역급행철도 c노선"].metrics?.preempt).toBe(true);
    expect(by["스타벅스"].score).toBe(45);
  });

  it("커뮤니티 글·홈판 쇼츠는 소재 묶음에서 빠짐", () => {
    const titles = run(["IT·컴퓨터"]).flatMap((g) => g.items.map((i) => i.title));
    expect(titles).not.toContain("시어머니가 아이폰 사전예약을 해달래요");
    expect(titles).not.toContain("아이폰 18 언박싱 쇼츠");
  });
});

describe("텍스트 유틸 — 파이썬 원본과 동일", () => {
  it("tokens / norm", () => {
    for (const [t, toks] of Object.entries(expected.tokens)) expect([...tokens(t)].sort()).toEqual([...(toks as string[])].sort());
    for (const [t, n] of Object.entries(expected.norm)) expect(norm(t)).toBe(n);
  });
  it("숫자·시간 파싱과 표기", () => {
    for (const [t, v] of Object.entries(expected.parse_count)) expect(parseCount(t)).toBe(v);
    for (const [t, v] of Object.entries(expected.parse_ago)) expect(parseAgoMinutes(t)).toBe(v);
    for (const [t, v] of Object.entries(expected.parse_pct)) expect(parsePct(t)).toBe(v);
    for (const [n, s] of expected.fmt_count as [number | null, string][]) expect(fmtCount(n)).toBe(s);
    for (const [n, s] of expected.fmt_ago as [number | null, string][]) expect(fmtAgo(n)).toBe(s);
  });
  it("카테고리 분류·필터", () => {
    for (const [t, c] of Object.entries(expected.classify)) expect(classifyText(t)).toBe(c);
    for (const [t, f] of Object.entries(expected.flags)) expect(flagText(t, DEFAULT_CHANNEL_CONFIG.filters)).toEqual(f);
    for (const [votes, text, c] of expected.resolve as [string[], string, string][]) expect(resolveCategory(votes, text)).toBe(c);
  });
});
