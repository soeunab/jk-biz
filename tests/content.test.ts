import { describe, expect, it } from "vitest";
import { mockManuscript } from "@/lib/content/generate";
import { auditManuscript } from "@/lib/content/seo";
import { manuscriptText, renderBlogger, renderNaverSegments } from "@/lib/content/render";
import { similarity } from "@/lib/content/similarity";
import { ManuscriptSchema } from "@/lib/content/types";
import { DEFAULT_BRAND, PROGRAM_DISCLOSURE } from "@/lib/brand";
import { josa } from "@/lib/util";
import { buildSystemPrompt, buildUserPrompt, storyContextBlock, userSourcesBlock } from "@/lib/content/prompts";
import { researchQuestionFor } from "@/lib/content/generate";

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
    // jw-post 디자인 (블로거 테마 CSS 클래스) — 목차는 테마 자동 목차가 <noscript> 자리에 만듦
    expect(html.startsWith('<div class="jw-post">')).toBe(true);
    expect(html).toContain("<noscript></noscript>");
    for (const cls of ["jw-lead", "jw-summary", "jw-faq", "jw-q", "jw-a", "jw-closing", "jw-meta"]) expect(html).toContain(`class="${cls}"`);
    expect(html).not.toMatch(/<(div|p|table|nav)[^>]*style="[^"]*(background|border)/); // 색·테두리는 테마 CSS 가 담당
    expect(html).toContain('class="separator"'); // 썸네일은 블로거 '아주 크게 + 가운데' 형식
    expect(html.match(/adsbygoogle/g)?.length).toBeGreaterThanOrEqual(2);
    // 쿠팡 상품은 쿠팡 파트너스 정책 문구 + 링크 옆 표시
    expect(html).toContain(PROGRAM_DISCLOSURE.COUPANG);
    expect(html).toContain("(쿠팡 파트너스 링크)");
    expect(html).toContain('rel="sponsored noopener"');
    expect(html).not.toMatch(/<script>[^<]*<\/script>\s*$/); // JSON-LD 는 type 지정
  });

  it("escapes </script> inside JSON-LD", () => {
    const m = mockManuscript({ ...base, platform: "BLOGGER" });
    m.faq[0].a = "</script><script>alert(1)</script>";
    const html = renderBlogger(m, { brand: DEFAULT_BRAND, images: [] });
    expect(html).not.toContain("</script><script>alert(1)");
  });

  it("jw-post 디자인은 블로거 원고에만 — 네이버 원고에는 안 들어감", () => {
    const m = mockManuscript({ ...base, platform: "NAVER" });
    const segs = renderNaverSegments(m, { brand: DEFAULT_BRAND, images: [] });
    expect(JSON.stringify(segs)).not.toContain("jw-");
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
    // 소제목은 네이버 실제 "소제목" 서식으로 넣도록 별도 세그먼트로 분리됨 (HTML <h2> 붙여넣기는 인식 안 됨)
    expect(segs.some((s) => s.type === "heading" && s.text === "자주 묻는 질문")).toBe(true);
    expect(m.sections.every((sec) => segs.some((s) => s.type === "heading" && s.text === sec.heading))).toBe(true);
    // 모든 소제목 바로 위에 구분선(가장 긴 "구분선 2"는 발행 시 선택) — 사용자 지정 양식
    const headingIdx = segs.flatMap((s, i) => (s.type === "heading" ? [i] : []));
    expect(headingIdx.length).toBeGreaterThan(1);
    expect(headingIdx.every((i) => segs[i - 1]?.type === "divider")).toBe(true);
    expect(segs.filter((s) => s.type === "divider")).toHaveLength(headingIdx.length);
  });

  it("제휴 고지 문구는 각 프로그램이 정한 원문 그대로", () => {
    expect(PROGRAM_DISCLOSURE.COUPANG).toBe("이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.");
    expect(PROGRAM_DISCLOSURE.SHOPPING_CONNECT).toBe("이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.");
  });

  it("네이버 쇼핑 커넥트 고지는 썸네일보다 앞, 글 맨 첫 문단에 본문 크기로", () => {
    const m = mockManuscript({ ...base, platform: "NAVER", affiliateProducts: [{ id: "p1", name: "키보드" }] });
    const segs = renderNaverSegments(m, {
      brand: DEFAULT_BRAND,
      images: [{ slot: "thumbnail", src: "/t.png", localPath: "/tmp/t.png", alt: "t" }],
      products: [{ id: "p1", name: "키보드", url: "https://link", program: "SHOPPING_CONNECT" }],
    });
    expect(segs[0].type).toBe("html");
    const first = segs[0] as { type: "html"; html: string };
    expect(first.html).toContain(PROGRAM_DISCLOSURE.SHOPPING_CONNECT);
    expect(first.html).not.toContain("font-size:13px"); // 회색 작은 글씨가 아님
    expect(segs[1]).toMatchObject({ type: "image", localPath: "/tmp/t.png" });
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

describe("원고 사실성 — 소설 방지 프롬프트 (B2·B3·B4)", () => {
  const brief = { platform: "NAVER" as const, keyword: "힉스필드 현대차 광고", persona: "OFFICE" as const, today: "2026-10-03" };

  it("연관 문구는 골라 쓰기, 관계·회사를 끌어오지 않기 — '검색량이 큰 것부터 녹여' 지시는 없음", () => {
    const p = buildUserPrompt({ ...brief, relatedKeywords: [{ keyword: "현대차 AI 투자", volume: 900 }] });
    expect(p).toContain("골라 써도");
    expect(p).toContain("끌어오지 마세요");
    expect(p).toContain("본문에 실제로 쓴 문구만");
    expect(p).not.toMatch(/검색량이 큰 것부터[^\n]*녹여/);
  });

  it("사실성 규칙에 관계 추측 금지", () => {
    const sys = buildSystemPrompt(DEFAULT_BRAND, "NAVER");
    expect(sys).toContain("관계(협업·투자·인수·공급·경쟁)를 추측해 쓰지 마세요");
    expect(sys).toContain("연관 검색어에 함께 나온다는 이유만으로 관계를 만들지 마세요");
  });

  it("실시간 소재의 수집 기사·요약 블록이 조사 메모 앞에 들어감", () => {
    const story = { summary: "힉스필드가 현대차 신차 광고 영상을 AI 로 제작", articles: [{ title: "현대차, AI 영상 광고 공개", url: "https://news/1", source: "한국경제" }] };
    const p = buildUserPrompt({ ...brief, storyContext: story });
    expect(p).toContain("[이 소재가 뜬 이유 — 실제 수집 기사]");
    expect(p).toContain("다른 사건·회사로 확장하지 마세요");
    expect(p.indexOf("실제 수집 기사")).toBeLessThan(p.indexOf("[최신 조사 메모"));
    expect(storyContextBlock(undefined)).toBe("");
    expect(researchQuestionFor({ ...brief, storyContext: story }, "2026-10-03")).toContain("다음 사건에 대한 사실만");
  });

  it("사용자 자료 블록은 핵심 키워드 바로 다음(최상단), only 모드 안내 포함", () => {
    const u = { notes: "현대차는 9월 힉스필드로 만든 광고를 공개했다.", urls: ["https://example.com/a"], mode: "only" as const };
    const p = buildUserPrompt({ ...brief, userSources: u });
    expect(p).toContain("[사용자 제공 자료 — 최우선 근거]");
    expect(p.indexOf("최우선 근거")).toBeLessThan(p.indexOf("- 가제:"));
    expect(p).toContain("자료를 우선하고 reviewChecklist 에 차이를 남기세요");
    expect(p).toContain("웹 조사 없이");
    expect(userSourcesBlock({ notes: " ", urls: [], mode: "prefer" })).toBe("");
    const q = researchQuestionFor({ ...brief, userSources: { ...u, mode: "prefer" } }, "2026-10-03");
    expect(q).toContain("사실 확인과 최신화");
    expect(q).toContain("https://example.com/a");
  });
});
