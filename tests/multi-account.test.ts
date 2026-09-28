import { describe, expect, it } from "vitest";
import { mockManuscript } from "@/lib/content/generate";
import { renderBlogger, renderNaverSegments } from "@/lib/content/render";
import { buildUserPrompt, conceptRules, republishRules } from "@/lib/content/prompts";
import { detectRisk, hasInvestDisclaimer, manuscriptRiskText } from "@/lib/content/risk";
import { auditManuscript } from "@/lib/content/seo";
import { readinessIssues } from "@/lib/content/readiness";
import { allocateAdpost } from "@/lib/analytics/adpost";
import { conceptOverlaps } from "@/lib/accounts";
import { DEFAULT_BRAND } from "@/lib/brand";

const brand = { disclosure: DEFAULT_BRAND.disclosure };
const naverHtml = (segs: ReturnType<typeof renderNaverSegments>) => segs.map((s) => (s.type === "html" ? s.html : "")).join("");

describe("A-2 INVEST detection without stock words", () => {
  it.each(["삼성전자 4분기 실적", "테슬라 배당금 지급일", "카카오 공시 정리", "SK하이닉스 목표주가", "엔비디아 실적발표 일정", "애플 시가총액", "삼성전자 PER 비교"])(
    "%s → INVEST",
    (t) => expect(detectRisk(t)?.categories).toContain("INVEST"),
  );
  it.each(["업무 실적 보고서 AI로 쓰기", "직장인 실적 평가 준비", "프로젝트 성과 per 인원 계산"])("%s → not INVEST", (t) => {
    expect(detectRisk(t)?.categories ?? []).not.toContain("INVEST");
  });
});

describe("A-3 investment disclaimer on the Naver render path", () => {
  it("renderNaverSegments inserts the disclaimer and the audit passes on Naver HTML", () => {
    const m = mockManuscript({ platform: "NAVER", keyword: "삼성전자 4분기 실적", persona: "OFFICE", tool: "Claude", today: "2026-09-28" });
    const risk = detectRisk(manuscriptRiskText(m))!;
    expect(risk.categories).toContain("INVEST");
    const html = naverHtml(renderNaverSegments(m, { brand: DEFAULT_BRAND, images: [], riskDisclaimers: risk.disclaimers }));
    expect(hasInvestDisclaimer(html)).toBe(true);
    expect(auditManuscript(m, "NAVER", { imageCount: 5, renderedHtml: html }).checks.find((c) => c.id === "invest-disclaimer")?.pass).toBe(true);
  });
});

describe("B-3 cross-platform republish", () => {
  const src = { platform: "BLOGGER" as const, accountName: "블로거 AI", title: "제미나이 보고서 작성법", headings: ["제미나이란?", "보고서 프롬프트"], keyPoints: ["핵심 요약"] };

  it("prompt forbids copying and asks for new angle/structure/examples with a source link token", () => {
    const rules = republishRules({ platform: "NAVER", republishOf: src });
    expect(rules).toContain("원본을 그대로 복사하지 마세요");
    expect(rules).toContain("관점·구성·예시를 새로 쓰세요");
    expect(rules).toContain("{{원본링크}}");
    expect(buildUserPrompt({ platform: "NAVER", keyword: "제미나이 보고서", persona: "OFFICE", today: "2026-09-28", republishOf: src })).toContain("크로스플랫폼 재발행");
  });

  it("replaces the token with a backlink on both renderers", () => {
    const m = mockManuscript({ platform: "NAVER", keyword: "제미나이 보고서", persona: "OFFICE", tool: "Gemini", today: "2026-09-28", republishOf: { title: "x" } });
    const link = { title: "제미나이 보고서 작성법", url: "https://jiwon4u.blogspot.com/2026/09/gemini.html" };
    const nh = naverHtml(renderNaverSegments(m, { brand: DEFAULT_BRAND, images: [], sourceLink: link }));
    const bh = renderBlogger(m, { brand: DEFAULT_BRAND, images: [], sourceLink: link });
    for (const h of [nh, bh]) {
      expect(h).toContain(`href="${link.url}"`);
      expect(h).not.toContain("{{원본링크}}");
      expect(h.match(new RegExp(link.url.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "g"))).toHaveLength(1);
    }
  });

  it("auto-inserts a backlink sentence when the manuscript never mentions the source", () => {
    const m = mockManuscript({ platform: "NAVER", keyword: "제미나이 보고서", persona: "OFFICE", tool: "Gemini", today: "2026-09-28" });
    const html = naverHtml(renderNaverSegments(m, { brand: DEFAULT_BRAND, images: [], sourceLink: { title: "원본 글", url: "https://example.com/a" } }));
    expect(html).toContain("다른 관점에서 정리한 글");
    expect(html).toContain('href="https://example.com/a"');
  });

  it("without a source the token is removed, never leaked", () => {
    const m = mockManuscript({ platform: "BLOGGER", keyword: "제미나이 보고서", persona: "OFFICE", tool: "Gemini", today: "2026-09-28", republishOf: { title: "x" } });
    expect(renderBlogger(m, { brand: DEFAULT_BRAND, images: [] })).not.toContain("{{원본링크}}");
  });

  it("readiness warns when too similar to the source or the source has no URL yet", () => {
    const m = mockManuscript({ platform: "NAVER", keyword: "제미나이 보고서", persona: "OFFICE", tool: "Gemini", today: "2026-09-28" });
    const ids = readinessIssues(m, { brand, republish: { sourceTitle: "원본", sourceUrl: null, similarity: 0.6, warn: true } }).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["republish-similar", "republish-no-url"]));
  });
});

describe("B-1 Adpost pooled allocation", () => {
  it("splits pooled revenue by pageview share, regardless of which member it was entered under", () => {
    const r = allocateAdpost([
      { accountId: "n1", name: "네이버1", masterId: null, pageviews: 300, adpostRevenue: 4000 },
      { accountId: "n2", name: "네이버2", masterId: "n1", pageviews: 100, adpostRevenue: 0 },
    ]);
    expect(r.get("n1")!.allocated).toBeCloseTo(3000);
    expect(r.get("n2")!.allocated).toBeCloseTo(1000);
    expect(r.get("n2")!.groupName).toBe("네이버1");
    expect(r.get("n1")!.groupRevenue).toBe(4000);
  });

  it("keeps independent accounts separate and handles zero traffic", () => {
    const r = allocateAdpost([
      { accountId: "n1", name: "네이버1", pageviews: 0, adpostRevenue: 2000 },
      { accountId: "n2", name: "네이버2", masterId: "n1", pageviews: 0, adpostRevenue: 0 },
      { accountId: "n3", name: "네이버3(독립)", pageviews: 50, adpostRevenue: 500 },
    ]);
    expect(r.get("n1")!.allocated).toBe(2000);
    expect(r.get("n1")!.note).toBeTruthy();
    expect(r.get("n2")!.allocated).toBe(0);
    expect(r.get("n3")!.allocated).toBe(500);
    expect(r.get("n3")!.groupSize).toBe(1);
  });
});

describe("B-2 account concepts", () => {
  it("different concepts produce different prompts with explicit title/angle/example rules", () => {
    const a = conceptRules("직장인 업무 자동화 후기형");
    const b = conceptRules("1인 가구 생활 AI");
    expect(a).not.toBe(b);
    expect(a).toContain("제목");
    expect(a).toContain("예시");
    expect(conceptRules("")).toContain("미설정");
  });

  it("warns about empty concept before approval", () => {
    const m = mockManuscript({ platform: "NAVER", keyword: "제미나이 보고서", persona: "OFFICE", tool: "Gemini", today: "2026-09-28" });
    expect(readinessIssues(m, { brand, accountConcept: "" }).map((i) => i.id)).toContain("concept-empty");
    expect(readinessIssues(m, { brand, accountConcept: "직장인 자동화" }).map((i) => i.id)).not.toContain("concept-empty");
  });

  it("flags overlapping concepts on the same platform but exempts republish partners", () => {
    const base = { platform: "NAVER", concept: "직장인을 위한 AI 업무 자동화 실전 가이드" };
    expect(conceptOverlaps([{ id: "a", name: "A", partnerIds: [], ...base }, { id: "b", name: "B", partnerIds: [], ...base }])).toHaveLength(1);
    expect(conceptOverlaps([{ id: "a", name: "A", partnerIds: ["b"], ...base }, { id: "b", name: "B", partnerIds: ["a"], ...base }])).toHaveLength(0);
    // 블로거-네이버는 플랫폼이 달라 비교하지 않음
    expect(conceptOverlaps([{ id: "a", name: "A", partnerIds: [], ...base }, { id: "b", name: "B", partnerIds: [], ...base, platform: "BLOGGER" }])).toHaveLength(0);
  });
});
