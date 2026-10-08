/**
 * 제목-본문 일치: AI 검수의 섹션·FAQ별 판정을 승인 전 확인 사항으로 (공식 % 기준은 없어 "모든 부분 일치"를 기준으로 함)
 */
import { describe, expect, it } from "vitest";
import { alignmentFrom, readinessIssues } from "@/lib/content/readiness";
import { mockManuscript } from "@/lib/content/generate";

const m = mockManuscript({ platform: "BLOGGER", keyword: "ai 해킹 사건", persona: "GENERAL", today: "2026-10-06" });
const brand = { disclosure: { affiliate: "", ad: "" } } as never;
const ids = (alignment: ReturnType<typeof alignmentFrom> | undefined) => readinessIssues(m, { brand, alignment }).map((i) => i.id);

describe("제목-본문 일치 확인 사항", () => {
  it("검수 전이면 검수하라고 안내, 판정이 없으면(예전 검수) 마찬가지", () => {
    expect(ids(alignmentFrom(null))).toContain("alignment-unchecked");
    expect(ids(alignmentFrom({ summary: "" }))).toContain("alignment-unchecked");
  });

  it("어긋난 부분이 하나라도 있으면 경고, 모두 맞으면 없음", () => {
    const off = alignmentFrom({ mainKeyword: "ai 해킹 공격", alignment: [{ part: "sections.0", onTopic: true, note: "" }, { part: "sections.1", onTopic: false, note: "보안 제품 소개" }] });
    const issues = readinessIssues(m, { brand, alignment: off });
    const msg = issues.find((i) => i.id === "alignment")?.message ?? "";
    expect(msg).toContain("2개 중 1개");
    expect(msg).toContain("sections.1: 보안 제품 소개");
    expect(ids(alignmentFrom({ alignment: [{ part: "sections.0", onTopic: true, note: "" }] }))).not.toContain("alignment");
  });

  it("검사하지 않는 호출(alignment 미지정)은 영향 없음", () => {
    expect(ids(undefined)).not.toContain("alignment-unchecked");
  });
});

describe("원고 지시 — 글 전체가 메인 키워드 내용", async () => {
  const { buildUserPrompt } = await import("@/lib/content/prompts");
  const base = { platform: "BLOGGER" as const, persona: "GENERAL" as const, today: "2026-10-06" };
  it("롱테일이면 메인 키워드를 함께 명시", () => {
    const p = buildUserPrompt({ ...base, keyword: "ai 해킹 은행", mainKeyword: "ai 해킹 공격", relatedKeywords: [{ keyword: "ai 해킹 사건", volume: 180 }] });
    expect(p).toContain("메인 키워드: ai 해킹 공격");
    expect(p).toContain("메인 키워드(ai 해킹 공격)에 대한 하위 질문");
    expect(p).toContain("키워드 스터핑");
  });
  it("메인 키워드 = 핵심 키워드면 핵심 키워드 기준", () => {
    const p = buildUserPrompt({ ...base, keyword: "서울 아파트값" });
    expect(p).toContain("핵심 키워드(서울 아파트값)에 대한 내용");
    expect(p).not.toContain("메인 키워드: ");
  });
});
