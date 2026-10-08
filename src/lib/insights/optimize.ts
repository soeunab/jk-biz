import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { generateJson } from "../llm";
import { postPerformance } from "../analytics/queries";
import { readManuscript } from "../content/service";
import { manuscriptText } from "../content/render";
import { similarity } from "../content/similarity";
import { rankInternalLinks } from "../content/internalLinks";
import { TITLE_NUMBER_RULE } from "../topics/expand";
import { asObject } from "../util";
import { fetchPublishedBody, htmlText } from "../publishers/remote";
import type { JobContext } from "../jobs/queue";

/**
 * 기존 글 성과 개선 제안 — 사람이 [AI 제안 만들기]를 누를 때만 실행되고, 결과는 제안으로만 보여 줍니다.
 * 공개된 글을 자동으로 고치지 않습니다(사용자 결정: 공개 글 수정은 제안만). 사람이 보고 복사해 직접 반영합니다.
 */
export const RetitleSchema = z.object({
  titles: z.array(z.string()).min(2).max(4).describe("새 제목 후보 — 핵심 키워드를 맨 앞에, 실제 검색어의 표현으로"),
  metaDescriptions: z.array(z.string()).min(1).max(3).describe("메타 설명 후보 120~150자, 첫 문장만으로 답이 되게"),
  reason: z.string().describe("왜 클릭률이 낮았는지와 무엇을 바꿨는지 2문장"),
});

export const RefreshSchema = z.object({
  uncoveredQueries: z.array(z.string()).describe("노출은 되는데 본문이 제대로 답하지 않는 검색어"),
  newSections: z.array(z.object({ heading: z.string(), body: z.string().describe("마크다운, 첫 문장에서 바로 답") })).max(3),
  newFaq: z.array(z.object({ q: z.string(), a: z.string() })).max(4),
  internalLinks: z.array(z.object({ title: z.string(), url: z.string(), where: z.string().describe("어느 섹션의 어떤 문장 근처에 넣을지") })).max(3),
  checklist: z.array(z.string()).describe("사람이 확인·보강할 것 (최신 기준일, 직접 찍은 사진, 실측 숫자 등)"),
});

export const PruneSchema = z.object({
  decision: z.enum(["improve", "merge", "delete"]).describe("개선 / 다른 글로 합치기 / 삭제"),
  reason: z.string(),
  mergeInto: z.object({ title: z.string(), url: z.string() }).nullable().describe("merge 일 때 합칠 대상 글"),
  steps: z.array(z.string()).describe("실행 순서 (합칠 때는 301 대신 블로거·네이버에서 할 수 있는 방법으로)"),
});

export const OPTIMIZABLE = ["RETITLE", "REFRESH", "PRUNE"] as const;

/**
 * 제안에 쓸 글 정보 — 앱에서 만든 원고는 구조화된 원고에서, [기존 글 등록]으로 가져온 글(원고 없이 HTML 만 있음)은
 * HTML 에서 제목·소제목·본문을 뽑습니다. 유입이 있는 글이 가져온 글인 경우가 많아 둘 다 지원.
 */
export function postDoc(post: { title: string; focusKeyword: string; metaDescription: string; html: string; content: unknown }) {
  const m = readManuscript(post.content);
  if (m) {
    return { title: m.title, keyword: m.focusKeyword, meta: m.metaDescription, headings: m.sections.map((s) => s.heading), faq: m.faq.map((f) => f.q), text: manuscriptText(m) };
  }
  const headings = [...post.html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)].map((x) => htmlText(x[1])).filter(Boolean);
  return { title: post.title, keyword: post.focusKeyword || post.title, meta: post.metaDescription, headings, faq: [] as string[], text: htmlText(post.html) };
}

export async function runOptimize(insightId: string, ctx?: JobContext) {
  const insight = await db.insight.findUniqueOrThrow({ where: { id: insightId } });
  if (!insight.postId || !(OPTIMIZABLE as readonly string[]).includes(insight.type)) throw new Error("AI 제안을 만들 수 없는 항목이에요.");
  const post = await db.post.findUniqueOrThrow({ where: { id: insight.postId }, include: { topic: { select: { signals: true } } } });
  let doc = postDoc(post);
  // [기존 글 등록]으로 URL 만 등록된 글 — 공개된 페이지를 읽어 본문을 가져옴 (읽기만 함)
  if (!doc.text.trim() && post.remoteUrl) {
    await ctx?.log("등록된 원고가 없어 공개된 글 페이지에서 본문을 읽어요");
    const html = await fetchPublishedBody(post.remoteUrl).catch(() => "");
    doc = postDoc({ ...post, html });
  }
  if (!doc.text.trim()) throw new Error("본문을 찾지 못해 제안을 만들 수 없어요.");
  const perf = (await postPerformance(28)).find((p) => p.id === post.id);
  const queries = (perf?.topQueries ?? []).slice(0, 15);
  const queryLines = queries.map((q) => `- ${q.query}: 노출 ${q.impressions}, 클릭 ${q.clicks}, 순위 ${q.position?.toFixed?.(1) ?? q.position}`).join("\n") || "(검색어 데이터 없음)";
  const outline = `제목: ${doc.title}\n메타 설명: ${doc.meta || "(없음)"}\n소제목: ${doc.headings.join(" / ") || "(없음)"}${doc.faq.length ? `\nFAQ: ${doc.faq.join(" / ")}` : ""}`;
  const base = { task: "write" as const, effort: "medium" as const, maxTokens: 6000 };
  await ctx?.progress(20, "글과 검색어 데이터 정리 중…");

  let proposal: unknown;
  if (insight.type === "RETITLE") {
    proposal = await generateJson({
      ...base,
      name: "optimizeRetitle",
      title: `제목·설명 개선 제안: ${doc.title}`,
      system: "당신은 검색 결과 클릭률(CTR)을 개선하는 블로그 편집자입니다. 본문이 실제로 답하는 내용만 약속하고, 과장·낚시 제목은 쓰지 않습니다.",
      prompt: `노출은 많은데 클릭이 적은 글입니다 (노출 ${perf?.impressions ?? "?"}회, 클릭률 ${perf ? (perf.ctr * 100).toFixed(1) : "?"}%).\n핵심 키워드: ${doc.keyword}\n\n[현재 글]\n${outline}\n\n[이 글이 노출된 실제 검색어]\n${queryLines}\n\n규칙: 핵심 키워드를 제목 맨 앞에 그대로 두고, 노출이 많은 검색어의 표현·대상 독자·상황을 반영하세요. ${TITLE_NUMBER_RULE}`,
      schema: RetitleSchema,
      mock: () => ({ titles: [`${doc.keyword} 정리`, `${doc.keyword} 한눈에 보기`], metaDescriptions: [doc.meta], reason: "데모 모드" }),
    });
  } else if (insight.type === "REFRESH") {
    const published = post.accountId
      ? await db.post.findMany({
          where: { accountId: post.accountId, status: "PUBLISHED", remoteUrl: { not: null }, id: { not: post.id } },
          select: { title: true, remoteUrl: true, focusKeyword: true, tags: true, topic: { select: { signals: true } } },
          orderBy: { publishedAt: "desc" },
          take: 60,
        })
      : [];
    const links = rankInternalLinks(
      { keyword: doc.keyword, mainKeyword: asObject<{ mainKeyword?: string }>(post.topic?.signals, {}).mainKeyword, terms: queries.map((q) => q.query) },
      published.map((p) => ({ title: p.title, url: p.remoteUrl!, focusKeyword: p.focusKeyword, mainKeyword: asObject<{ mainKeyword?: string }>(p.topic?.signals, {}).mainKeyword, tags: Array.isArray(p.tags) ? (p.tags as string[]) : [] })),
      6,
    );
    proposal = await generateJson({
      ...base,
      name: "optimizeRefresh",
      title: `글 보강 제안: ${doc.title}`,
      system: "당신은 검색 2페이지(8~20위) 글을 1페이지로 올리기 위해 보강하는 편집자입니다. 조사되지 않은 수치·요금·경험을 지어내지 말고, 모르는 것은 checklist 에 확인할 일로 남깁니다.",
      prompt: `평균 순위 ${perf?.position?.toFixed(1) ?? "?"}위인 글입니다.\n\n[현재 글]\n${outline}\n\n[본문 일부]\n${doc.text.slice(0, 3000)}\n\n[이 글이 노출된 실제 검색어]\n${queryLines}\n\n[내부링크 후보 — 같은 주제 묶음 순]\n${links.map((l) => `- ${l.pillar ? "[필러] " : ""}${l.title}: ${l.url}`).join("\n") || "(없음)"}\n\n노출되는데 본문이 답하지 않는 검색어를 찾아, 그 질문에 답하는 섹션(최대 3개)과 FAQ(최대 4개)를 결론 먼저 쓰세요. 내부링크는 관련 있는 것만.`,
      schema: RefreshSchema,
      mock: () => ({ uncoveredQueries: [], newSections: [], newFaq: [], internalLinks: [], checklist: ["데모 모드"] }),
    });
  } else {
    const siblings = post.accountId
      ? await db.post.findMany({ where: { accountId: post.accountId, status: "PUBLISHED", id: { not: post.id } }, select: { title: true, remoteUrl: true, content: true, html: true }, take: 200 })
      : [];
    const text = doc.text;
    const similar = siblings
      .map((s) => {
        const sm = readManuscript(s.content);
        return { title: s.title, url: s.remoteUrl ?? "", score: similarity(text, sm ? manuscriptText(sm) : htmlText(s.html)) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    proposal = await generateJson({
      ...base,
      name: "optimizePrune",
      title: `저성과 글 정리 제안: ${doc.title}`,
      system: "당신은 블로그 품질 관리자입니다. 검색엔진은 사이트 전체 품질을 보므로, 유입이 없는 글은 개선하거나 비슷한 글로 합치거나 삭제합니다. 성급한 삭제보다 개선·병합을 먼저 검토합니다.",
      prompt: `발행 ${post.publishedAt ? Math.floor((Date.now() - post.publishedAt.getTime()) / 86_400_000) : "?"}일이 지났지만 최근 28일 조회 ${perf?.pageviews ?? 0}회, 검색 클릭 ${perf?.clicks ?? 0}회인 글입니다.\n\n[현재 글]\n${outline}\n\n[노출 검색어]\n${queryLines}\n\n[같은 블로그의 비슷한 글 — 유사도 0~1]\n${similar.map((s) => `- ${s.title} (${s.score.toFixed(2)}) ${s.url}`).join("\n") || "(없음)"}`,
      schema: PruneSchema,
      mock: () => ({ decision: "improve" as const, reason: "데모 모드", mergeInto: null, steps: [] }),
    });
  }

  await db.insight.update({
    where: { id: insight.id },
    data: { data: { ...asObject<Record<string, unknown>>(insight.data, {}), proposal, proposalAt: new Date().toISOString() } as Prisma.InputJsonValue },
  });
  await ctx?.progress(100, "AI 제안 완료 — 발전 제안 화면에서 확인하세요");
  return { insightId: insight.id };
}
