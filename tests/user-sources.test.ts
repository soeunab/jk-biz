/**
 * 📎 내 자료로 다시 쓰기 (B5) — 액션 검증·저장, only 모드는 웹 조사 안 함, 재생성 후에도 자료 보존, 공개 글 거부.
 * 원고 생성은 실제 runGeneratePost 를 메모리 DB + mock AI 로 돌립니다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const posts = new Map<string, Row>();
const jobs: Row[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    setting: { findUnique: async () => null },
    affiliateProduct: { findMany: async () => [] },
    topic: { update: async () => ({}) },
    post: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const p = posts.get(where.id);
        if (!p) throw new Error("not found");
        return { assets: [], ...p };
      },
      findUnique: async ({ where }: { where: { id: string } }) => posts.get(where.id) ?? null,
      findMany: async () => [],
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const p = posts.get(where.id)!;
        Object.assign(p, data, { updatedAt: new Date() });
        return p;
      },
    },
    job: {
      findMany: async () => jobs.filter((j) => ["QUEUED", "RUNNING", "WAITING"].includes(String(j.status))),
      create: async ({ data }: { data: Row }) => {
        const j = { id: `job${jobs.length + 1}`, status: "QUEUED", ...data };
        jobs.push(j);
        return j;
      },
    },
  },
}));

// AI: research 는 호출 여부·질문만 기록, 원고는 mock 원고 + 받은 프롬프트 기록
const ai = vi.hoisted(() => ({ researchCalls: [] as string[], prompts: [] as string[] }));
vi.mock("@/lib/llm", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm")>()),
  research: async (q: string) => {
    ai.researchCalls.push(q);
    return { notes: "웹 조사 메모", sources: [{ title: "공식", url: "https://official.example.com" }] };
  },
  generateJson: async (req: { prompt: string; mock: () => unknown }) => {
    ai.prompts.push(req.prompt);
    return req.mock();
  },
}));
vi.mock("@/lib/images/pipeline", () => ({ buildPostImages: async () => undefined }));

const { POST: action } = await import("@/app/api/posts/[id]/action/route");
const { runGeneratePost, researchNotesOf, userSourcesOf } = await import("@/lib/content/service");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function call(id: string, body: unknown) {
  const res = await action(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), ctx(id));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function addPost(id: string, over: Row = {}) {
  posts.set(id, {
    id,
    status: "DRAFT",
    platform: "NAVER",
    accountId: null,
    account: null,
    topic: { id: "t1", keyword: "힉스필드 현대차 광고", title: "힉스필드 현대차 광고", angle: "", persona: "OFFICE", tool: null, intent: "INFO", signals: { related: [] } },
    topicId: "t1",
    focusKeyword: "힉스필드 현대차 광고",
    normalizedKeyword: "힉스필드현대차광고",
    sourcePostId: null,
    remoteId: null,
    remoteUrl: null,
    research: { notes: "예전 조사", sources: [], at: "2026-10-01" },
    content: null,
    seoReport: null,
    updatedAt: new Date(),
    ...over,
  });
}

const userSources = { notes: "현대차는 9월 신차 광고를 힉스필드 AI 로 제작해 공개했다.", urls: ["https://news.example.com/hyundai-higgsfield"], mode: "prefer" };

beforeEach(() => {
  posts.clear();
  jobs.length = 0;
  ai.researchCalls.length = 0;
  ai.prompts.length = 0;
  process.env.LLM_PROVIDER = "mock";
});

describe("액션: 자료 검증·저장", () => {
  it("자료를 research.user 에 저장(기존 조사 기록은 유지)하고 재생성 작업을 넣음", async () => {
    addPost("p");
    const r = await call("p", { action: "regenerate", userSources });
    expect(r.status).toBe(200);
    expect(jobs).toHaveLength(1);
    const p = posts.get("p")!;
    expect(p.status).toBe("GENERATING");
    expect(p.research).toMatchObject({ notes: "예전 조사", user: { notes: userSources.notes, urls: userSources.urls, mode: "prefer" } });
  });

  it.each([
    [{ ...userSources, notes: "가".repeat(30_001) }, "30,000자"],
    [{ ...userSources, urls: Array.from({ length: 11 }, (_, i) => `https://a.com/${i}`) }, "10개"],
    [{ ...userSources, urls: ["javascript:alert(1)"] }, ""],
    [{ ...userSources, urls: ["ftp://a.com/x"] }, "http(s)"],
    [{ ...userSources, mode: "all" }, ""],
  ])("형식 오류는 거부하고 아무것도 바꾸지 않음 (%#)", async (bad, hint) => {
    addPost("p");
    const r = await call("p", { action: "regenerate", userSources: bad });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain(hint);
    expect(posts.get("p")!.status).toBe("DRAFT");
    expect(jobs).toHaveLength(0);
  });

  it("공개·승인된 글은 자료가 있어도 거부", async () => {
    addPost("p", { status: "PUBLISHED" });
    expect((await call("p", { action: "regenerate", userSources })).status).toBe(400);
    expect((posts.get("p")!.research as Row).user).toBeUndefined();
  });

  it("빈 자료로 보내면 저장된 자료를 지움", async () => {
    addPost("p", { research: { notes: "x", user: { ...userSources, at: "t" } } });
    await call("p", { action: "regenerate", userSources: { notes: "", urls: [], mode: "prefer" } });
    expect((posts.get("p")!.research as Row).user).toBeUndefined();
  });
});

describe("생성: 자료 반영", () => {
  it("prefer: 조사 질문에 자료 확인 목적·URL, 프롬프트 최상단에 자료, 출처에 URL, 생성 후에도 자료 보존", async () => {
    addPost("p", { research: { notes: "예전", user: { ...userSources, at: "t" } } });
    await runGeneratePost("p");
    expect(ai.researchCalls).toHaveLength(1);
    expect(ai.researchCalls[0]).toContain("사실 확인과 최신화");
    expect(ai.researchCalls[0]).toContain(userSources.urls[0]);
    const prompt = ai.prompts.find((x) => x.includes("핵심 키워드"))!;
    expect(prompt).toContain("[사용자 제공 자료 — 최우선 근거]");
    expect(prompt).toContain(userSources.notes);
    const p = posts.get("p")!;
    expect(p.status).toBe("DRAFT");
    expect((p.research as Row).notes).toBe("웹 조사 메모");
    expect(userSourcesOf(p.research)).toMatchObject({ notes: userSources.notes, mode: "prefer" });
    expect((p.content as { sources: { url: string }[] }).sources.map((s) => s.url)).toContain(userSources.urls[0]);
    // AI 검수·승인 전 확인이 쓰는 조사 메모 앞에 사용자 자료가 붙음
    expect(researchNotesOf(p.research)).toMatch(/^\[사용자 제공 자료\][\s\S]*\[웹 조사 메모\]\n웹 조사 메모$/);
  });

  it("only: 웹 조사를 하지 않음", async () => {
    addPost("p", { research: { notes: "", user: { ...userSources, mode: "only", at: "t" } } });
    await runGeneratePost("p");
    expect(ai.researchCalls).toHaveLength(0);
    expect(ai.prompts.some((x) => x.includes("웹 조사 없이"))).toBe(true);
    expect(userSourcesOf(posts.get("p")!.research)?.mode).toBe("only");
  });

  it("실시간 소재는 수집 기사·요약을 프롬프트와 조사 질문에 전달", async () => {
    addPost("p", {
      research: null,
      topic: {
        id: "t1",
        keyword: "힉스필드 현대차 광고",
        title: "",
        angle: "",
        persona: "OFFICE",
        tool: null,
        intent: "INFO",
        signals: {
          origin: "channels",
          related: [],
          longtail: { story: { summary: "현대차가 힉스필드로 만든 AI 광고 공개" } },
          evidence: [{ title: "현대차 AI 광고 화제", url: "https://n/1", press: "매일경제", source: "네이버 뉴스" }],
          context: [],
        },
      },
    });
    await runGeneratePost("p");
    expect(ai.researchCalls[0]).toContain("현대차가 힉스필드로 만든 AI 광고 공개");
    const prompt = ai.prompts.find((x) => x.includes("핵심 키워드"))!;
    expect(prompt).toContain("현대차 AI 광고 화제 (매일경제): https://n/1");
  });
});
