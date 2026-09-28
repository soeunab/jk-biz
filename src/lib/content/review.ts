import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { generateJson, research } from "../llm";
import type { JobContext } from "../jobs/queue";
import { readManuscript, rerenderPost, researchNotesOf } from "./service";
import { ManuscriptSchema, type Manuscript } from "./types";

/**
 * AI 사실 검수 (사람 검수 전 2단계 핸드오프)
 * - 웹 검색으로 최신 사실을 확인하고 "사실 오류"와 "오탈자"만 고칠 것을 제안합니다.
 * - 제목·소제목·구조·핵심 키워드처럼 데이터 근거로 만든 요소는 보존합니다. 예외로 고쳤다면 반드시 보고합니다.
 * - 자동 반영하지 않습니다. 사람이 제안을 골라 적용합니다.
 */
export const ReviewSchema = z.object({
  platform: z.enum(["NAVER", "BLOGGER"]).describe("가장 먼저 확인한, 이 원고가 올라갈 플랫폼"),
  changes: z.array(
    z.object({
      field: z.string().describe("수정 위치: title | metaDescription | directAnswer | intro | conclusion | tldr.N | sections.N.heading | sections.N.body | sections.N.tip | faq.N.q | faq.N.a (N 은 0부터)"),
      before: z.string().describe("원문에서 글자 그대로 발췌한 짧은 구절"),
      after: z.string().describe("고친 구절"),
      reason: z.enum(["사실오류", "오탈자"]),
      evidence: z.string().describe("근거 — 사실오류는 출처 URL 포함"),
    }),
  ),
  concerns: z.array(z.string()).describe("고치지 않았지만 사람이 확인해야 할 의심 사항 (확인 불가한 수치·요금 등)"),
  summary: z.string().describe("검수 요약 2~3문장, 예외적으로 제목·구조를 건드렸다면 여기에 명시"),
});
export type AiReview = z.infer<typeof ReviewSchema> & { at: string; applied: number[] };

export async function runAiReview(postId: string, ctx?: JobContext) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId } });
  const m = readManuscript(post.content);
  if (!m) throw new Error("원고가 없습니다.");
  const platformName = post.platform === "NAVER" ? "네이버 블로그" : "구글 블로거";

  await ctx?.log("최신 사실 조사 중…");
  const facts = await research(
    `다음 블로그 원고의 사실관계(요금제, 기능명, 모델명, 출시일, 수치, 제도)를 공식 자료로 확인해 주세요.\n제목: ${m.title}\n직답: ${m.directAnswer}\n${m.sections.map((s) => `${s.heading}: ${s.body.slice(0, 400)}`).join("\n")}`,
  ).catch(() => ({ notes: "", sources: [] }));
  await ctx?.progress(50, "원고 대조 중…");

  const result = await generateJson({
    system: `당신은 ${platformName} 원고의 최종 사실 검수자입니다.
[먼저] 이 원고의 플랫폼이 ${platformName}임을 확인하고 platform 필드에 기록하세요.
[바꿔도 되는 것] 사실 오류, 오탈자 — 이 두 가지뿐입니다.
[바꾸면 안 되는 것] 제목, 소제목, 섹션 구조, 핵심 키워드, 문체, 분량. 이 요소들은 검색 데이터를 근거로 만든 것이므로
"더 자연스럽게" 같은 이유로 고치지 마세요. 사실 오류나 오탈자 때문에 예외로 고쳤다면 summary 에 반드시 밝히세요.
[경험 자리표시] "[경험 추가: …]" 는 사람이 채울 자리이므로 건드리지 마세요.
[시제] 이미 출시·시행·발표된 것을 "예정입니다/출시 전" 같은 미래형으로 쓴 문장은 사실오류로 고치세요.
확인할 수 없는 내용은 고치지 말고 concerns 에 적으세요. before 는 원문 글자 그대로여야 합니다.`,
    prompt: `[원고 작성 당시 조사 메모]\n${researchNotesOf(post.research) ?? "(없음)"}\n\n[지금 다시 조사한 메모]\n${facts.notes || "(조사 불가)"}\n[출처]\n${facts.sources.map((s) => `- ${s.title}: ${s.url}`).join("\n") || "(없음)"}\n\n[원고 JSON]\n${JSON.stringify(m)}`,
    schema: ReviewSchema,
    effort: "high",
    maxTokens: 16000,
    mock: () => ({
      platform: post.platform as "NAVER" | "BLOGGER",
      changes: mockTypoChanges(m),
      concerns: m.reviewChecklist.slice(0, 3),
      summary: "데모 모드 검수입니다. 실제 사실 확인은 AI API 키를 설정하면 웹 검색 기반으로 수행돼요. 제목·구조는 변경하지 않았어요.",
    }),
  });

  const review: AiReview = { ...result, at: new Date().toISOString(), applied: [] };
  await db.post.update({ where: { id: postId }, data: { aiReview: review as unknown as Prisma.InputJsonValue } });
  await ctx?.progress(100, `제안 ${result.changes.length}건 · 확인 필요 ${result.concerns.length}건`);
  return { changes: result.changes.length };
}

function mockTypoChanges(m: Manuscript) {
  const hit = [m.intro, m.conclusion].find((t) => /  +/.test(t));
  return hit ? [{ field: hit === m.intro ? "intro" : "conclusion", before: "  ", after: " ", reason: "오탈자" as const, evidence: "공백 중복" }] : [];
}

/** 경로("sections.2.body")의 문자열 값에서 before → after 치환 */
export function applyChange(m: Manuscript, change: { field: string; before: string; after: string }): boolean {
  const parts = change.field.split(".");
  let target: unknown = m;
  for (const key of parts.slice(0, -1)) {
    if (target == null || typeof target !== "object") return false;
    target = (target as Record<string, unknown>)[key];
  }
  const last = parts[parts.length - 1];
  if (target == null || typeof target !== "object") return false;
  const obj = target as Record<string, unknown>;
  const value = obj[last];
  if (typeof value !== "string" || !change.before || !value.includes(change.before)) return false;
  obj[last] = value.replace(change.before, change.after);
  return true;
}

/** 사람이 고른 제안만 적용 */
export async function applyAiReview(postId: string, indices: number[]) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId } });
  const m = readManuscript(post.content);
  const review = post.aiReview as AiReview | null;
  if (!m || !review) throw new Error("검수 결과가 없습니다.");
  const applied: number[] = [];
  const failed: number[] = [];
  for (const i of indices) {
    const c = review.changes[i];
    if (!c || review.applied.includes(i)) continue;
    (applyChange(m, c) ? applied : failed).push(i);
  }
  const next = ManuscriptSchema.parse(m);
  await db.post.update({
    where: { id: postId },
    data: {
      content: next as unknown as Prisma.InputJsonValue,
      title: next.title,
      metaDescription: next.metaDescription,
      aiReview: { ...review, applied: [...review.applied, ...applied] } as unknown as Prisma.InputJsonValue,
    },
  });
  await rerenderPost(postId);
  return { applied: applied.length, failed: failed.length };
}
