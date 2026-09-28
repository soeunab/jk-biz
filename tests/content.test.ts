import { describe, expect, it } from "vitest";
import { mockManuscript } from "@/lib/content/generate";
import { auditManuscript } from "@/lib/content/seo";
import { manuscriptText, renderBlogger, renderNaverSegments } from "@/lib/content/render";
import { similarity } from "@/lib/content/similarity";
import { ManuscriptSchema } from "@/lib/content/types";
import { DEFAULT_BRAND } from "@/lib/brand";
import { josa } from "@/lib/util";

const base = { keyword: "제미나이 사용법", persona: "OFFICE" as const, tool: "Gemini", today: "2026-09-28" };

describe("manuscript", () => {
  it("mock manuscript satisfies the schema", () => {
    expect(ManuscriptSchema.safeParse(mockManuscript({ ...base, platform: "NAVER" })).success).toBe(true);
  });

  it("audit rewards complete manuscripts and flags missing parts", () => {
    const m = mockManuscript({ ...base, platform: "BLOGGER" });
    const good = auditManuscript(m, "BLOGGER", { imageCount: 5, bannedPhrases: DEFAULT_BRAND.bannedPhrases });
    const broken = auditManuscript({ ...m, faq: [], directAnswer: "", sources: [], title: "짧은 제목" }, "BLOGGER", { imageCount: 0 });
    expect(good.score).toBeGreaterThan(broken.score);
    const failed = broken.checks.filter((c) => !c.pass).map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(["faq", "direct-answer", "sources", "title-kw", "images"]));
  });

  it("flags banned phrases", () => {
    const m = mockManuscript({ ...base, platform: "NAVER" });
    m.intro += " 무조건 따라 하세요.";
    const r = auditManuscript(m, "NAVER", { imageCount: 6, bannedPhrases: ["무조건"] });
    expect(r.checks.find((c) => c.id === "banned")?.pass).toBe(false);
  });

  it("renders Blogger HTML with JSON-LD, TOC, ad slots and affiliate disclosure", () => {
    const m = mockManuscript({ ...base, platform: "BLOGGER", affiliateProducts: [{ id: "p1", name: "키보드" }] });
    const html = renderBlogger(m, {
      brand: DEFAULT_BRAND,
      images: [{ slot: "thumbnail", src: "https://x/t.png", alt: "썸네일" }],
      products: [{ id: "p1", name: "키보드", url: "https://link", program: "COUPANG" }],
      adsense: { client: "ca-pub-1", slot: "123" },
    });
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain("목차");
    expect(html.match(/adsbygoogle/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain(DEFAULT_BRAND.disclosure.affiliate);
    expect(html).toContain('rel="sponsored noopener"');
    expect(html).not.toMatch(/<script>[^<]*<\/script>\s*$/); // JSON-LD 는 type 지정
  });

  it("escapes </script> inside JSON-LD", () => {
    const m = mockManuscript({ ...base, platform: "BLOGGER" });
    m.faq[0].a = "</script><script>alert(1)</script>";
    const html = renderBlogger(m, { brand: DEFAULT_BRAND, images: [] });
    expect(html).not.toContain("</script><script>alert(1)");
  });

  it("splits Naver content into text and image segments in order", () => {
    const m = mockManuscript({ ...base, platform: "NAVER" });
    const segs = renderNaverSegments(m, {
      brand: DEFAULT_BRAND,
      images: [
        { slot: "thumbnail", src: "/t.png", localPath: "/tmp/t.png", alt: "t" },
        { slot: "img1", src: "/1.png", localPath: "/tmp/1.png", alt: "1" },
      ],
    });
    expect(segs[0]).toMatchObject({ type: "image", localPath: "/tmp/t.png" });
    expect(segs.filter((s) => s.type === "image")).toHaveLength(2);
    expect(segs.some((s) => s.type === "html" && s.html.includes("자주 묻는 질문"))).toBe(true);
  });

  it("similarity detects near-duplicates across platforms", () => {
    const a = manuscriptText(mockManuscript({ ...base, platform: "NAVER" }));
    const b = manuscriptText(mockManuscript({ ...base, platform: "BLOGGER" }));
    const c = manuscriptText(mockManuscript({ ...base, keyword: "퍼플렉시티 논문 검색", tool: "Perplexity", persona: "SOLO", platform: "NAVER" }));
    expect(similarity(a, b)).toBeGreaterThan(0.8);
    expect(similarity(a, c)).toBeLessThan(similarity(a, b));
  });

  it("chooses Korean particles by final consonant", () => {
    expect(josa("직장인", "을/를")).toBe("직장인을");
    expect(josa("프리랜서", "을/를")).toBe("프리랜서를");
    expect(josa("직장인", "이라면/라면")).toBe("직장인이라면");
    expect(josa("Claude", "은/는")).toBe("Claude는");
  });
});

import { mediaPath, MEDIA_DIR } from "@/lib/storage";
describe("media path", () => {
  it("blocks path traversal outside the media dir", () => {
    expect(mediaPath(["posts", "a.png"])).toBe(`${MEDIA_DIR}/posts/a.png`);
    expect(mediaPath(["..", "..", ".env"])).toBeNull();
    expect(mediaPath(["posts", "..", "..", "dev.db"])).toBeNull();
  });
});
