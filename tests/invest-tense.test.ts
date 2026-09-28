import { describe, expect, it } from "vitest";
import { mockManuscript } from "@/lib/content/generate";
import { auditManuscript } from "@/lib/content/seo";
import { renderBlogger } from "@/lib/content/render";
import { detectRisk, hasInvestDisclaimer, INVEST_DISCLAIMER, manuscriptRiskText, PREDICTIVE_RE, tradeAdviceFaqs } from "@/lib/content/risk";
import { readinessIssues } from "@/lib/content/readiness";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/content/prompts";
import { entities, findTenseConflicts, periodEnds } from "@/lib/content/tense";
import { DEFAULT_BRAND } from "@/lib/brand";

const brand = { disclosure: DEFAULT_BRAND.disclosure };
const investManuscript = () => {
  const m = mockManuscript({ platform: "BLOGGER", keyword: "AI 주식 종목 분석", persona: "OFFICE", tool: "Claude", today: "2026-09-28" });
  m.faq.push({ q: "지금 사야 하나요?", a: "지금이 기회입니다. 지금 사세요." });
  return m;
};

describe("investment safeguards", () => {
  it("separates investing from general finance", () => {
    expect(detectRisk("AI로 주식 종목 분석하기")?.categories).toContain("INVEST");
    expect(detectRisk("재테크 초보 AI 활용")?.categories).toContain("INVEST");
    const loan = detectRisk("대출 금리 비교");
    expect(loan?.categories).toContain("FINANCE");
    expect(loan?.categories).not.toContain("INVEST");
  });

  it("recognizes the disclaimer by meaning, not exact text", () => {
    expect(hasInvestDisclaimer(INVEST_DISCLAIMER)).toBe(true);
    expect(hasInvestDisclaimer("<p>본 글은 투자 권유가 아니며, 투자 판단의 책임은 투자자 본인에게 있습니다.</p>")).toBe(true);
    expect(hasInvestDisclaimer("투자 권유가 아닙니다.")).toBe(false); // 책임 고지 누락
    expect(hasInvestDisclaimer("정보 제공 목적입니다.")).toBe(false);
  });

  it("flags predictive/recommendation phrases", () => {
    for (const t of ["이 종목은 오를 것이다", "지금이 매수 시점이다", "추천 종목 3선", "지금 매수하세요"]) expect(PREDICTIVE_RE.test(t)).toBe(true);
    expect(PREDICTIVE_RE.test("3분기 실적이 공시됐어요")).toBe(false);
  });

  it("audit checks the disclaimer in the final HTML and trade advice in FAQ", () => {
    const m = investManuscript();
    expect(detectRisk(manuscriptRiskText(m))?.categories).toContain("INVEST");
    const withoutHtml = auditManuscript(m, "BLOGGER", { imageCount: 3, renderedHtml: "<p>본문만 있음</p>" });
    expect(withoutHtml.checks.find((c) => c.id === "invest-disclaimer")?.pass).toBe(false);
    expect(withoutHtml.checks.find((c) => c.id === "invest-faq")?.pass).toBe(false);

    // 렌더러가 고지 문구를 자동 삽입한 실제 HTML 로 확인하면 통과
    const html = renderBlogger(m, { brand: DEFAULT_BRAND, images: [], riskDisclaimers: detectRisk(manuscriptRiskText(m))!.disclaimers });
    expect(auditManuscript(m, "BLOGGER", { imageCount: 3, renderedHtml: html }).checks.find((c) => c.id === "invest-disclaimer")?.pass).toBe(true);
  });

  it("does not flag FAQ answers that give facts and indicators", () => {
    expect(tradeAdviceFaqs([{ q: "지금 사야 하나요?", a: "매수 여부는 대신 판단할 수 없어요. 최근 공시와 다음 실적 발표일을 확인해 보세요." }])).toHaveLength(0);
  });

  it("readiness lists investment issues as readable sentences", () => {
    const ids = readinessIssues(investManuscript(), { brand, renderedHtml: "<p>본문</p>" }).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["invest-disclaimer", "invest-faq"]));
  });

  it("prompts include investment rules in the trust/policy section and per-topic rules", () => {
    expect(buildSystemPrompt(DEFAULT_BRAND, "NAVER")).toContain("투자 권유가 아닙니다");
    const p = buildUserPrompt({ platform: "NAVER", keyword: "AI 주식 종목 분석", persona: "OFFICE", today: "2026-09-28" });
    expect(p).toContain("지켜볼 지표");
  });
});

describe("tense conflicts (already happened, written as future)", () => {
  const base = () => mockManuscript({ platform: "NAVER", keyword: "제미나이 사용법", persona: "OFFICE", tool: "Gemini", today: "2026-09-28" });

  it("parses period ends", () => {
    expect(periodEnds("2026년 3월 출시 예정")[0].end.getMonth()).toBe(2);
    expect(periodEnds("2025년 하반기 도입")[0].end.getFullYear()).toBe(2025);
    expect(entities("Gemini 3 Pro 출시 예정")).toContain("Gemini 3 Pro");
    expect(entities("AI 앱 출시 예정")).toHaveLength(0);
  });

  it("flags a past date written as future", () => {
    const m = base();
    m.intro += " 새 기능은 2026년 3월 출시 예정입니다.";
    const c = findTenseConflicts(m, { today: "2026-09-28" });
    expect(c).toHaveLength(1);
    expect(c[0].reason).toContain("이미 지난");
  });

  it("does not flag a genuinely future date", () => {
    const m = base();
    m.intro += " 새 기능은 2027년 3월 출시 예정입니다.";
    expect(findTenseConflicts(m, { today: "2026-09-28" })).toHaveLength(0);
  });

  it("flags future wording that contradicts research notes", () => {
    const m = base();
    m.sections[0].body += "\n\nGemini 3 Pro 는 아직 출시 전입니다.";
    const notes = "Google 은 2026년 8월 Gemini 3 Pro 를 정식 출시했다. 요금은 월 2만 원대다.";
    const c = findTenseConflicts(m, { today: "2026-09-28", researchNotes: notes });
    expect(c).toHaveLength(1);
    expect(c[0].evidence).toContain("정식 출시");
  });

  it("does not confuse different versions", () => {
    const m = base();
    m.sections[0].body += "\n\nGemini 4 는 출시 예정입니다.";
    expect(findTenseConflicts(m, { today: "2026-09-28", researchNotes: "Gemini 3 Pro 를 정식 출시했다." })).toHaveLength(0);
  });

  it("appears in the audit and readiness", () => {
    const m = base();
    m.intro += " 이 요금제는 2025년 12월 도입 예정입니다.";
    expect(auditManuscript(m, "NAVER", { imageCount: 5, today: "2026-09-28" }).checks.find((c) => c.id === "tense")?.pass).toBe(false);
    expect(readinessIssues(m, { brand, today: "2026-09-28" }).map((i) => i.id)).toContain("tense");
  });
});
