/**
 * P0-A 발행 안전 — 공개·승인된 글 보호, 중복 발행 방지, 편집 잠금, 카드뉴스 승인 게이트,
 * 블로거 라이브 글 덮어쓰기 방지, 네이버 중복 글 방지, 원고 HTML 안전화, 자리표시 누수 차단, 낙관적 잠금.
 * DB 는 메모리로 흉내 냅니다(실제 플랫폼·브라우저는 열지 않음).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockManuscript } from "@/lib/content/generate";
import type { Manuscript } from "@/lib/content/types";

type Row = Record<string, unknown>;
const posts = new Map<string, Row>();
const jobs: Row[] = [];
const cards = new Map<string, Row>();
const assets = new Map<string, Row>();
const socialPosts: Row[] = [];
let tick = 0;
const stamp = () => new Date(Date.UTC(2026, 9, 3, 0, 0, tick++));

const matches = (row: Row, where: Row = {}) =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const o = v as { in?: unknown[]; not?: unknown; notIn?: unknown[] };
      if (o.in) return o.in.includes(row[k]);
      if (o.notIn) return !o.notIn.includes(row[k]);
      if ("not" in o) return row[k] !== o.not;
      return true;
    }
    if (v instanceof Date) return row[k] instanceof Date && (row[k] as Date).getTime() === v.getTime();
    return row[k] === v;
  });

vi.mock("@/lib/db", () => ({
  db: {
    setting: { findUnique: async () => null },
    affiliateProduct: { findMany: async () => [] },
    post: {
      findUnique: async ({ where }: { where: { id: string } }) => posts.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const p = posts.get(where.id);
        if (!p) throw new Error("not found");
        return { ...p, account: p.account ?? null };
      },
      findMany: async ({ where }: { where?: Row } = {}) => [...posts.values()].filter((p) => matches(p, where)),
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const p = posts.get(where.id)!;
        Object.assign(p, data, { updatedAt: stamp() });
        return p;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hit = [...posts.values()].filter((p) => matches(p, where));
        for (const p of hit) Object.assign(p, data, { updatedAt: stamp() });
        return { count: hit.length };
      },
    },
    job: {
      findMany: async ({ where }: { where?: Row } = {}) => jobs.filter((j) => matches(j, where)),
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => jobs.find((j) => j.id === where.id)!,
      create: async ({ data }: { data: Row }) => {
        const j = { id: `job${jobs.length + 1}`, status: "QUEUED", createdAt: stamp(), ...data };
        jobs.push(j);
        return j;
      },
    },
    cardNews: { findUniqueOrThrow: async ({ where }: { where: { id: string } }) => cards.get(where.id)! },
    account: {
      findMany: async () => [{ id: "ig", platform: "INSTAGRAM" }],
      findUnique: async ({ where }: { where: { id: string } }) =>
        [...posts.values()].map((p) => p.account as Row | null).find((a) => a?.id === where.id) ?? null,
    },
    socialPost: {
      create: async ({ data }: { data: Row }) => {
        const sp = { id: `sp${socialPosts.length + 1}`, ...data };
        socialPosts.push(sp);
        return sp;
      },
    },
    asset: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => assets.get(where.id)!,
    },
  },
}));

// 블로거 API — 라이브 글 덮어쓰기 여부 확인
const blogger = {
  status: "LIVE",
  get: vi.fn(async () => ({ data: { status: blogger.status } })),
  update: vi.fn(async () => ({ data: { id: "remote1" } })),
  insert: vi.fn(async () => ({ data: { id: "remote-new" } })),
};
vi.mock("googleapis", () => ({
  google: { blogger: () => ({ posts: { get: blogger.get, update: blogger.update, insert: blogger.insert } }) },
}));
vi.mock("@/lib/publishers/google", () => ({ authedClient: async () => ({}) }));

// 네이버 — 브라우저가 열리면 실패
const launch = vi.fn(async () => {
  throw new Error("브라우저가 열리면 안 됨");
});
vi.mock("playwright", () => ({ chromium: { launch } }));

// 발행용 렌더링은 원고만 돌려주는 가짜로 (실제 렌더러는 아래에서 따로 검사)
vi.mock("@/lib/content/service", async (orig) => {
  const real = await orig<typeof import("@/lib/content/service")>();
  return {
    ...real,
    rerenderPost: vi.fn(async (id: string) => ({ html: "<p>x</p>", manuscript: posts.get(id)!.content as Manuscript, score: 80, renderOptions: {} })),
  };
});

const { POST: action } = await import("@/app/api/posts/[id]/action/route");
const { PATCH: patchPost } = await import("@/app/api/posts/[id]/route");
const { POST: retry } = await import("@/app/api/jobs/[id]/retry/route");
const { POST: sectionRoute } = await import("@/app/api/posts/[id]/section/route");
const reviewRoute = await import("@/app/api/posts/[id]/review/route");
const { POST: cardPublish } = await import("@/app/api/cardnews/[id]/publish/route");
const { applyAiReview, applyChange, replaceFirst } = await import("@/lib/content/review");
const { bloggerSaveDraft } = await import("@/lib/publishers/blogger");
const { naverPublishPrivate } = await import("@/lib/publishers/naver");
const { publishPrivate, publishPublic } = await import("@/lib/publishers");
const { saveIfUnchanged } = await import("@/lib/content/service");
const { renderBlogger, renderNaverSegments, isSafeHref } = await import("@/lib/content/render");
const { countPlaceholders } = await import("@/lib/content/seo");
const { stripPlaceholders, PLACEHOLDER_RE } = await import("@/lib/content/types");
const { DEFAULT_BRAND } = await import("@/lib/brand");

const m0 = () => mockManuscript({ platform: "BLOGGER", keyword: "제미나이 사용법", persona: "OFFICE", tool: "Gemini", today: "2026-10-03" });
const req = (body: unknown, method = "POST") => new Request("http://x", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function call(handler: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>, id: string, body: unknown, method = "POST") {
  const res = await handler(req(body, method), ctx(id));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function addPost(id: string, over: Row = {}) {
  posts.set(id, {
    id,
    status: "DRAFT",
    platform: "BLOGGER",
    accountId: "acc",
    account: { id: "acc", externalId: "blog1", settings: { demo: true }, concept: "" },
    remoteId: null,
    remoteUrl: null,
    html: "<p>x</p>",
    content: m0(),
    research: null,
    seoReport: null,
    reviewerNote: "",
    aiReview: null,
    error: null,
    updatedAt: stamp(),
    ...over,
  });
}

beforeEach(() => {
  posts.clear();
  jobs.length = 0;
  cards.clear();
  assets.clear();
  socialPosts.length = 0;
  blogger.status = "LIVE";
  blogger.get.mockClear();
  blogger.update.mockClear();
  blogger.insert.mockClear();
  launch.mockClear();
});

describe("A1 공개·승인된 글은 AI 로 다시 쓰지 않음", () => {
  it.each(["PUBLISHED", "APPROVED", "GENERATING"])("%s → 거부, 상태 그대로", async (status) => {
    addPost("p", { status, remoteId: "r1" });
    const r = await call(action, "p", { action: "regenerate" });
    expect(r.status).toBe(400);
    expect(posts.get("p")!.status).toBe(status);
    expect(jobs).toHaveLength(0);
  });
  it.each(["DRAFT", "PRIVATE", "FAILED", "REJECTED", "WAITING_MANUAL"])("%s → 허용", async (status) => {
    addPost("p", { status });
    expect((await call(action, "p", { action: "regenerate" })).status).toBe(200);
    expect(posts.get("p")!.status).toBe("GENERATING");
  });
});

describe("A4 중복 실행 방지", () => {
  it("같은 원고의 발행을 두 번 눌러도 작업은 하나 (같은 jobId)", async () => {
    addPost("p");
    const a = await call(action, "p", { action: "publishPrivate" });
    const b = await call(action, "p", { action: "publishPrivate" });
    expect(a.body.jobId).toBe(b.body.jobId);
    expect(jobs).toHaveLength(1);
  });
  it("다른 원고는 각각 작업", async () => {
    addPost("p");
    addPost("q");
    await call(action, "p", { action: "publishPrivate" });
    await call(action, "q", { action: "publishPrivate" });
    expect(jobs).toHaveLength(2);
  });
  it("다시 실행은 실패한 작업만", async () => {
    jobs.push({ id: "done1", type: "post.publishPublic", status: "DONE", payload: { postId: "p" } });
    jobs.push({ id: "fail1", type: "post.publishPublic", status: "FAILED", payload: { postId: "p" } });
    expect((await call(retry, "done1", {})).status).toBe(400);
    expect((await call(retry, "fail1", {})).status).toBe(200);
  });
  it("작업 안에서 상태를 다시 확인 — 승인 안 된 글은 공개 발행하지 않음", async () => {
    addPost("p", { status: "PRIVATE" });
    await expect(publishPublic("p")).rejects.toThrow(/승인/);
    addPost("q", { status: "APPROVED" });
    await expect(publishPrivate("q")).rejects.toThrow(/비공개 발행을 하지 않아요/);
  });
});

describe("A5 승인 후 편집 금지·상태 전환 검사", () => {
  it("APPROVED 원고: 원고 저장·섹션 다시 쓰기·검수 적용·이미지 재생성 거부, 검수 메모는 저장 가능", async () => {
    addPost("p", { status: "APPROVED", aiReview: { changes: [], applied: [], concerns: [], summary: "", at: "" } });
    expect((await call(patchPost, "p", { manuscript: m0() }, "PATCH")).status).toBe(400);
    expect((await call(patchPost, "p", { reviewerNote: "메모" }, "PATCH")).status).toBe(200);
    expect((await call(sectionRoute, "p", { index: 0 })).status).toBe(400);
    expect((await call(reviewRoute.PATCH, "p", { indices: [0] }, "PATCH")).status).toBe(400);
    expect((await call(reviewRoute.POST, "p", {})).status).toBe(400);
    expect((await call(action, "p", { action: "images" })).status).toBe(400);
    await expect(applyAiReview("p", [0])).rejects.toThrow(/승인 취소/);
    expect(jobs).toHaveLength(0);
  });
  it("승인 취소는 APPROVED 에서만, 직접 발행 표시는 PRIVATE·APPROVED 에서만", async () => {
    addPost("p", { status: "PUBLISHED" });
    expect((await call(action, "p", { action: "unapprove" })).status).toBe(400);
    expect(posts.get("p")!.status).toBe("PUBLISHED");
    addPost("d", { status: "DRAFT" });
    expect((await call(action, "d", { action: "markPublished", url: "https://x" })).status).toBe(400);
    addPost("a", { status: "APPROVED" });
    expect((await call(action, "a", { action: "markPublished", url: "https://blog/1" })).status).toBe(200);
    expect(posts.get("a")!.status).toBe("PUBLISHED");
  });
});

describe("A6 카드뉴스는 원고 승인 뒤에만 SNS 발행", () => {
  it("미승인 원고의 카드뉴스는 거부, 승인 후엔 허용", async () => {
    cards.set("c", { id: "c", postId: "p", post: { status: "PRIVATE" } });
    expect((await call(cardPublish, "c", { accountIds: ["ig"] })).status).toBe(400);
    cards.set("c", { id: "c", postId: "p", post: { status: "APPROVED" } });
    expect((await call(cardPublish, "c", { accountIds: ["ig"] })).status).toBe(200);
    // 원고 없이 만든 카드뉴스는 그대로 허용
    cards.set("free", { id: "free", postId: null, post: null });
    expect((await call(cardPublish, "free", { accountIds: ["ig"] })).status).toBe(200);
  });
});

describe("A2·A9 블로거", () => {
  it("블로거에서 이미 공개된 글이면 update 를 부르지 않음", async () => {
    addPost("p", { status: "PRIVATE", remoteId: "remote1" });
    blogger.status = "LIVE";
    await expect(bloggerSaveDraft("p", () => undefined)).rejects.toThrow(/이미 공개된 글/);
    expect(blogger.update).not.toHaveBeenCalled();
  });
  it("블로거 초안이면 update, 결과에 편집 주소(remoteUrl)를 돌려주지 않음", async () => {
    addPost("p", { status: "PRIVATE", remoteId: "remote1" });
    blogger.status = "DRAFT";
    const r = await bloggerSaveDraft("p", () => undefined);
    expect(blogger.update).toHaveBeenCalledOnce();
    expect(r.remoteUrl).toBeUndefined();
  });
  it("초안 저장 후 원고의 remoteUrl 은 null (예전 편집 주소도 지움)", async () => {
    addPost("p", { status: "DRAFT", remoteUrl: "https://www.blogger.com/blog/post/edit/blog1/old", account: { id: "acc", externalId: "blog1", settings: {}, concept: "" } });
    await publishPrivate("p");
    expect(posts.get("p")!.status).toBe("PRIVATE");
    expect(posts.get("p")!.remoteUrl).toBeNull();
    expect(posts.get("p")!.remoteId).toBe("remote-new");
  });
});

describe("A3 네이버 중복 글 방지", () => {
  const naverPost = (over: Row = {}) =>
    addPost("n", { platform: "NAVER", account: { id: "nacc", externalId: "myblog", settings: {}, concept: "" }, ...over });

  it("이미 올라간 글(remoteId)이 있으면 브라우저를 열지 않고 실패", async () => {
    naverPost({ status: "PRIVATE", remoteId: "223000000001" });
    await expect(naverPublishPrivate("n", () => undefined)).rejects.toThrow(/네이버 연결 해제/);
    expect(launch).not.toHaveBeenCalled();
  });
  it("발행 화면 액션은 먼저 확인받고(글이 하나 더 생김), 확인하면 기존 연결을 끊고 올림 — 연결 해제 후에도 허용", async () => {
    // 2026-10-08 사용자 결정: 네이버 [수정본 다시 올리기]는 막지 않고 '글이 하나 더 생긴다'를 확인받은 뒤에만
    naverPost({ status: "FAILED", remoteId: "223000000001" });
    const ask = await call(action, "n", { action: "publishPrivate" });
    expect(ask.body).toMatchObject({ needsConfirm: true });
    expect(posts.get("n")).toMatchObject({ remoteId: "223000000001" });
    expect((await call(action, "n", { action: "publishPrivate", force: true })).status).toBe(200);
    expect(posts.get("n")).toMatchObject({ remoteId: null, remoteUrl: null });
    naverPost({ status: "FAILED", remoteId: "223000000001" });
    expect((await call(action, "n", { action: "unlinkRemote" })).status).toBe(200);
    expect(posts.get("n")).toMatchObject({ remoteId: null, remoteUrl: null, status: "DRAFT" });
    expect((await call(action, "n", { action: "publishPrivate" })).status).toBe(200);
  });
  it("발행 확인 불가(unconfirmed) 상태: 다시 올리기 막고 직접 발행 표시는 허용", async () => {
    naverPost({ status: "DRAFT", remoteId: "unconfirmed" });
    const r = await call(action, "n", { action: "publishPrivate" });
    expect(String(r.body.error)).toContain("발행됐을 수 있음");
    expect((await call(action, "n", { action: "markPublished", url: "https://blog.naver.com/myblog/223000000009" })).status).toBe(200);
    expect(posts.get("n")).toMatchObject({ status: "PUBLISHED", remoteId: "223000000009" });
  });
  it("공개된 글은 연결 해제 불가", async () => {
    naverPost({ status: "PUBLISHED", remoteId: "223000000001" });
    expect((await call(action, "n", { action: "unlinkRemote" })).status).toBe(400);
  });
});

describe("A10 승인 시 유사도 다시 계산", () => {
  it("저장값은 0% 여도 지금 거의 같은 글이 있으면 확인 사유로 알려 줌", async () => {
    const m = m0();
    addPost("p", { status: "PRIVATE", content: m, seoReport: { similarity: { max: 0, with: null, warn: false } } });
    addPost("twin", { status: "DRAFT", content: m, title: "쌍둥이 글" });
    const r = await call(action, "p", { action: "approve" });
    expect(r.body.needsConfirm).toBe(true);
    expect((r.body.issues as string[]).some((i) => i.includes("쌍둥이 글") || i.includes("유사"))).toBe(true);
    expect(posts.get("p")!.status).toBe("PRIVATE");
  });
});

describe("A7 원고 HTML 안전화", () => {
  const brand = DEFAULT_BRAND;
  const withBody = (body: string) => {
    const m = m0();
    m.sections[0].body = body;
    return m;
  };
  it.each([
    ["<script>alert(1)</script>", /<script>alert/],
    ['<img src=x onerror="alert(1)">', /<img[^>]*onerror/],
    ["[눌러보세요](javascript:alert(1))", /href="javascript:/i],
    ["![x](javascript:alert(1))", /src="javascript:/i],
    ['<a href="javascript:alert(1)">x</a>', /<a href="javascript:/i],
  ])("%s 는 실행 가능한 형태로 남지 않음 (블로거·네이버)", (body, bad) => {
    const m = withBody(body);
    const b = renderBlogger(m, { brand, images: [] });
    const n = renderNaverSegments(m, { brand, images: [] }).map((s) => (s.type === "html" ? s.html : "")).join("");
    for (const html of [b, n]) expect(html).not.toMatch(bad);
  });
  it("안전한 링크·상대 경로·단순 서식은 그대로", () => {
    const html = renderBlogger(withBody("[공식](https://gemini.google.com) [메일](mailto:a@b.c) [아래](#faq) 줄<br>바꿈 **굵게**"), { brand, images: [] });
    expect(html).toContain('href="https://gemini.google.com"');
    expect(html).toContain('href="mailto:a@b.c"');
    expect(html).toContain('href="#faq"');
    expect(html).toContain("줄<br>바꿈");
    expect(html).toContain("<strong>굵게</strong>");
  });
  it("isSafeHref", () => {
    expect(["https://a.com", "http://a", "mailto:x@y", "#a", "/rel", "rel/path"].every(isSafeHref)).toBe(true);
    expect(["javascript:alert(1)", " JavaScript:x", "data:text/html,x", "vbscript:x", "//evil.com", "java\u0000script:x"].some(isSafeHref)).toBe(false);
  });
});

describe("A8 [경험 추가] 자리표시 누수 차단", () => {
  it("흔한 변형도 자리표시로 인식", () => {
    for (const s of ["[경험 추가: 써 본 느낌]", "[ 경험추가 : 후기]", "[경험 추가]", "[경험추가:x]"]) {
      expect(s.match(PLACEHOLDER_RE)).toHaveLength(1);
    }
    expect(stripPlaceholders("제미나이 사용법 [경험 추가: 후기] 정리")).toBe("제미나이 사용법 정리");
  });
  it("발행본: 본문·FAQ·JSON-LD 어디에도 남지 않음 (미리보기는 강조)", () => {
    const m = m0();
    m.sections[0].body = "[ 경험추가 : 직접 써 본 결과]\n\n본문";
    m.faq[0] = { q: "어떤가요 [경험 추가]", a: "좋아요 [경험 추가: 실제 사용 후기]" };
    m.metaDescription = "설명 [경험 추가: x]";
    const pub = renderBlogger(m, { brand: DEFAULT_BRAND, images: [], placeholders: "strip" });
    expect(pub).not.toMatch(/경험\s*추가/);
    const ld = pub.slice(pub.indexOf("application/ld+json"));
    expect(ld).toContain('"text":"좋아요"');
    const preview = renderBlogger(m, { brand: DEFAULT_BRAND, images: [], placeholders: "highlight" });
    expect(preview).toContain("<mark");
    const naver = renderNaverSegments(m, { brand: DEFAULT_BRAND, images: [], placeholders: "strip" });
    expect(JSON.stringify(naver)).not.toMatch(/경험\s*추가/);
  });
  it("남은 자리표시 수는 제목·요약·소제목·FAQ 질문·표까지 셈 (사람용 확인 목록은 제외)", () => {
    const m = m0();
    const base = countPlaceholders(m);
    m.title += " [경험 추가]";
    m.tldr[0] += " [경험 추가: a]";
    m.faq[0].q += " [ 경험추가 : b]";
    m.reviewChecklist = ["[경험 추가] 자리를 채우세요"];
    expect(countPlaceholders(m)).toBe(base + 3);
  });
});

describe("A11 긴 작업이 사람의 수정을 덮어쓰지 않음", () => {
  it("작업 시작 뒤 원고가 저장됐으면 결과를 저장하지 않음", async () => {
    addPost("p");
    const startedAt = posts.get("p")!.updatedAt as Date;
    await call(patchPost, "p", { reviewerNote: "사람이 저장" }, "PATCH");
    await expect(saveIfUnchanged("p", startedAt, { error: "AI 결과" })).rejects.toThrow(/작업 중 원고가 수정/);
    expect(posts.get("p")!.error).toBeNull();
    await expect(saveIfUnchanged("p", posts.get("p")!.updatedAt as Date, { error: "ok" })).resolves.toBeUndefined();
  });
  it("치환은 $& 같은 특수 패턴을 해석하지 않음", () => {
    expect(replaceFirst("가격은 1만원", "1만원", "$& (월 $1)")).toBe("가격은 $& (월 $1)");
    const m = m0();
    m.intro = "요금은 1만원입니다";
    expect(applyChange(m, { field: "intro", before: "1만원", after: "$&2" })).toBe(true);
    expect(m.intro).toBe("요금은 $&2입니다");
  });
  it("표 JSON 폴백: 셀 여러 개에 걸친 글자 치환은 허용, 키·구조가 바뀌는 치환은 거부", () => {
    const m = m0();
    m.sections[0].table = { headers: ["요금제", "가격"], rows: [["무료", "0원"], ["프로", "2만원"]] };
    expect(applyChange(m, { field: "sections.0.table", before: 'rows":[["무료","0원"]', after: 'rows":[["무료","0원(체험)"]' })).toBe(true);
    expect(m.sections[0].table!.rows[0][1]).toBe("0원(체험)");
    expect(applyChange(m, { field: "sections.0.table", before: '"headers"', after: '"heads"' })).toBe(false);
    expect(applyChange(m, { field: "sections.0.table", before: '"무료","0원(체험)"', after: '"무료"' })).toBe(false);
    expect(m.sections[0].table!.headers).toEqual(["요금제", "가격"]);
  });
});
