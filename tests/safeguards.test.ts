import { describe, expect, it } from "vitest";
import { mockManuscript } from "@/lib/content/generate";
import { auditManuscript, countPlaceholders } from "@/lib/content/seo";
import { applyPlaceholders, renderBlogger, renderNaverSegments } from "@/lib/content/render";
import { detectRisk, manuscriptRiskText } from "@/lib/content/risk";
import { readinessIssues } from "@/lib/content/readiness";
import { recipeFor } from "@/lib/content/recipes";
import { applyChange } from "@/lib/content/review";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/content/prompts";
import { DEFAULT_BRAND } from "@/lib/brand";

const base = { keyword: "제미나이 사용법", persona: "OFFICE" as const, tool: "Gemini", today: "2026-09-28" };
const brand = { disclosure: DEFAULT_BRAND.disclosure };

describe("experience placeholders (AI does not invent experience)", () => {
  it("mock manuscript uses placeholders, not fabricated first-person experience", () => {
    const m = mockManuscript({ ...base, platform: "NAVER" });
    expect(JSON.stringify(m)).not.toMatch(/제가 직접 해보니/);
    expect(countPlaceholders(m)).toBeGreaterThan(0);
  });

  it("prompts forbid fabricated experience and invented proper nouns", () => {
    const sys = buildSystemPrompt(DEFAULT_BRAND, "NAVER");
    expect(sys).toContain("1인칭 경험");
    expect(sys).toContain("고유명사");
    expect(sys).not.toContain('("제가 직접 해보니", "실제로 3분 걸렸어요")');
  });

  it("audit flags unfilled placeholders and passes once filled", () => {
    const m = mockManuscript({ ...base, platform: "BLOGGER" });
    expect(auditManuscript(m, "BLOGGER", { imageCount: 3 }).checks.find((c) => c.id === "experience")?.pass).toBe(false);
    const filled = JSON.parse(JSON.stringify(m).replace(/\[경험 추가:[^\]]*\]/g, "실제로 해보니 5분 걸렸어요."));
    expect(auditManuscript(filled, "BLOGGER", { imageCount: 3 }).checks.find((c) => c.id === "experience")?.pass).toBe(true);
  });

  it("strips placeholders from published HTML and highlights them in preview", () => {
    const m = mockManuscript({ ...base, platform: "BLOGGER" });
    const pub = renderBlogger(m, { brand: DEFAULT_BRAND, images: [], placeholders: "strip" });
    const preview = renderBlogger(m, { brand: DEFAULT_BRAND, images: [], placeholders: "highlight" });
    expect(pub).not.toContain("경험 추가");
    expect(preview).toContain("<mark");
    expect(applyPlaceholders("<p>[경험 추가: x]</p><p>본문</p>")).toBe("<p>본문</p>");
    const segs = renderNaverSegments(m, { brand: DEFAULT_BRAND, images: [], placeholders: "strip" });
    expect(segs.map((s) => (s.type === "html" ? s.html : "")).join("")).not.toContain("경험 추가");
  });
});

describe("AEO self-contained answers", () => {
  it("flags answers that depend on the body text", () => {
    const m = mockManuscript({ ...base, platform: "BLOGGER" });
    m.faq[0].a = "위에서 설명했듯이 무료로 쓸 수 있어요.";
    const check = auditManuscript(m, "BLOGGER", { imageCount: 3 }).checks.find((c) => c.id === "self-contained");
    expect(check?.pass).toBe(false);
    expect(check?.detail).toContain("FAQ 1");
  });
});

describe("high-risk topics", () => {
  it("detects tax/welfare/housing but not incidental words", () => {
    expect(detectRisk("프리랜서 종합소득세 AI로 준비하기")?.categories).toContain("TAX");
    expect(detectRisk("1인 가구 청년 지원금 신청")?.categories).toContain("WELFARE");
    expect(detectRisk("청약 가점 계산")?.categories).toContain("HOUSING");
    expect(detectRisk("시간을 투자해 제미나이 사용법 익히기")).toBeNull();
  });

  it("requires sources, flags predictive claims, and injects prompt rules", () => {
    const m = mockManuscript({ ...base, keyword: "프리랜서 종합소득세 AI", platform: "NAVER" });
    m.sources = [];
    m.intro += " 이렇게 하면 무조건 받는 환급이에요.";
    const r = auditManuscript(m, "NAVER", { imageCount: 5 });
    expect(r.checks.find((c) => c.id === "risk-sources")?.pass).toBe(false);
    expect(detectRisk(manuscriptRiskText(m))).not.toBeNull();
    const issues = readinessIssues(m, { brand }).map((i) => i.id);
    expect(issues).toEqual(expect.arrayContaining(["risk-sources", "experience"]));
    const prompt = buildUserPrompt({ platform: "NAVER", keyword: "프리랜서 종합소득세 신고", persona: "FREELANCER", today: "2026-09-28" });
    expect(prompt).toContain("고위험 주제 규칙");
  });

  it("adds disclaimers to rendered output", () => {
    const m = mockManuscript({ ...base, platform: "BLOGGER" });
    const html = renderBlogger(m, { brand: DEFAULT_BRAND, images: [], riskDisclaimers: ["세무 전문가에게 확인하세요."] });
    expect(html).toContain("세무 전문가에게 확인하세요.");
  });
});

describe("readiness", () => {
  it("reports empty affiliate disclosure and similarity warnings as readable sentences", () => {
    const m = mockManuscript({ ...base, platform: "NAVER", affiliateProducts: [{ id: "p", name: "키보드" }] });
    const issues = readinessIssues(m, {
      brand: { disclosure: { ...DEFAULT_BRAND.disclosure, affiliate: "" } },
      similarity: { warn: true, max: 0.5, with: { title: "비슷한 글" } },
    });
    expect(issues.map((i) => i.id)).toEqual(expect.arrayContaining(["disclosure", "similarity"]));
    expect(issues.every((i) => i.message.length > 10)).toBe(true);
  });
});

describe("recipes by search intent", () => {
  it("maps intent + keyword to an article type", () => {
    expect(recipeFor("transactional", "클로드 유료 구매")).toBe("BUYING_GUIDE");
    expect(recipeFor("commercial", "제미나이 클로드 비교")).toBe("COMPARISON");
    expect(recipeFor("commercial", "퍼플렉시티 사용 후기")).toBe("REVIEW");
    expect(recipeFor("informational", "챗GPT 보고서 프롬프트")).toBe("TUTORIAL");
    expect(recipeFor("informational", "제미나이 사용법")).toBe("HOWTO");
    const p = buildUserPrompt({ platform: "BLOGGER", keyword: "제미나이 클로드 비교", persona: "OFFICE", intent: "commercial", today: "2026-09-28" });
    expect(p).toContain("상업조사형");
    expect(p).toContain("비교표");
  });
});

describe("AI review suggestions", () => {
  it("applies only exact-match changes at the given path", () => {
    const m = mockManuscript({ ...base, platform: "BLOGGER" });
    const q = m.faq[0].q;
    expect(applyChange(m, { field: "faq.0.q", before: q, after: "수정된 질문" })).toBe(true);
    expect(m.faq[0].q).toBe("수정된 질문");
    expect(applyChange(m, { field: "faq.0.q", before: "없는 문장", after: "x" })).toBe(false);
    expect(applyChange(m, { field: "nope.1.x", before: "a", after: "b" })).toBe(false);
  });
});

describe("naver sources", () => {
  it("shows reference links on Naver too (links are not penalized)", () => {
    const m = mockManuscript({ ...base, platform: "NAVER" });
    const html = renderNaverSegments(m, { brand: DEFAULT_BRAND, images: [] }).map((s) => (s.type === "html" ? s.html : "")).join("");
    expect(html).toContain("참고 자료");
  });
});
