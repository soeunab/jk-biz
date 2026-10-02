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

/** 1차 검수에서 "확인 필요"로 남은 항목 하나하나를 실제로 웹 검색해 확인 가능한지 다시 시도한 결과 */
const ConcernResolutionSchema = z.object({
  resolutions: z.array(
    z.object({
      concernIndex: z.number().int().describe("원래 concerns 배열의 인덱스(0부터)"),
      resolved: z.boolean().describe("이번 조사로 사실 여부를 확인했으면 true (원문이 맞았어도 true), 여전히 확인 못했으면 false"),
      field: z.string().optional().describe("고쳐야 하면 경로(sections.N.body 등), 원문이 이미 맞으면 비움"),
      before: z.string().optional(),
      after: z.string().optional(),
      note: z.string().describe("확인됐으면 근거·출처, 확인 못했으면 왜 못했는지(예: 게재 시점 실시간 계산 필요, 원문 자료 비공개 등)"),
      retryable: z
        .boolean()
        .describe(
          "resolved=false 일 때만: 나중에 다시 웹 검색하면 확인될 가능성이 있으면 true(아직 공식 발표 전인 수치 등). " +
            "애초에 웹 검색 대상이 아니거나(링크 직접 클릭, 이미지 교체, 다른 글과 대조 등 사람만 할 수 있는 작업) " +
            "구조적으로 영구히 비공개인 정보면 false — false 로 표시한 건 다음 검수부터 다시 조사하지 않습니다.",
        )
        .default(true),
    }),
  ),
});

/**
 * 1차 검수의 concerns 를 그대로 사람에게 넘기지 않고, 그 각각을 실제로 웹 검색해서 한 번 더 확인을 시도합니다.
 * ("사람이 확인하라"는 게 "AI가 검색하면 알 수 있는 걸 사람 손으로 다시 찾으라"는 뜻이 되지 않게 하기 위함.)
 * 확인되면 changes 로 옮기거나(원문이 틀렸을 때) 목록에서 빼고(원문이 이미 맞았을 때), 정말 확인 불가한 것만 남깁니다.
 * concerns 는 AI 사실 검수 자신이 남긴 것과, 원고 작성 때 글쓴이 AI 가 남긴 reviewChecklist 를 합쳐서 넘길 수 있습니다 —
 * 같은 사실을 "AI 검수는 못 찾음", "사람 검수 체크리스트엔 확인하라고 남아 있음" 두 군데 중복으로 남기지 않기 위함.
 * 반환하는 remaining 은 입력과 같은 길이·순서라 호출한 쪽에서 원래 배열(이었던 구간)별로 다시 나눠 쓸 수 있습니다.
 */
async function resolveConcerns(
  m: Manuscript,
  platformName: string,
  concerns: string[],
  ctx?: JobContext,
): Promise<{ changes: z.infer<typeof ReviewSchema>["changes"]; remaining: (string | null)[] }> {
  if (!concerns.length) return { changes: [], remaining: [] };
  await ctx?.log(`확인 필요 ${concerns.length}건 추가 조사 중…`);
  const followUp = await research(
    `아래는 블로그 원고를 검수하다가 확인이 안 된 항목들입니다. 각 항목이 사실인지 공식 자료·언론 보도로 하나씩 확인해 주세요. ` +
      `확인되면 정확한 수치·문구와 출처를, 확인이 안 되면 왜 안 되는지 알려주세요.\n` +
      concerns.map((c, i) => `${i + 1}. ${c}`).join("\n"),
  ).catch(() => ({ notes: "", sources: [] }));
  if (!followUp.notes) return { changes: [], remaining: concerns };

  const result = await generateJson({
    name: "factReviewFollowup",
    task: "write",
    title: `AI 사실 검수 후속 확인: ${m.title}`,
    system: `당신은 ${platformName} 원고의 사실 검수자입니다. 아래 "확인 필요" 목록 각각에 대해 방금 조사한 자료로 사실 여부를 판단하세요.
- 조사 결과 원문이 틀렸으면 field(sections.N.body 등)·before(원문 그대로)·after 를 채우고 resolved=true.
- 조사 결과 원문이 이미 맞았으면 field 는 비우고 resolved=true, note 에 확인 근거만 적으세요.
- 이번 조사로도 확인 못했으면 resolved=false, note 에 왜 못했는지 적으세요(예: 게재 시점 실시간 수치라 지금은 계산 불가).
- resolved=false 면 retryable 도 반드시 정하세요: "링크를 직접 클릭해 보세요", "이미지를 교체하세요", "기존 글과 대조하세요" 처럼
  애초에 사람이 손으로 해야 하는 일이면 retryable=false(다음부터 재조사 안 함). 아직 공식 발표 전이라 지금은 못 찾았지만
  나중에 찾아질 수 있는 사실이면 retryable=true.
concerns 배열의 모든 항목에 대해 하나씩 답하세요.`,
    prompt: `[확인 필요 목록]\n${concerns.map((c, i) => `${i}: ${c}`).join("\n")}\n\n[방금 조사한 내용]\n${followUp.notes}\n[출처]\n${followUp.sources.map((s) => `- ${s.title}: ${s.url}`).join("\n") || "(없음)"}\n\n[원고 JSON]\n${JSON.stringify(m)}`,
    schema: ConcernResolutionSchema,
    effort: "medium",
    maxTokens: 8000,
    mock: () => ({
      resolutions: concerns.map((_, i) => ({
        concernIndex: i,
        resolved: false,
        field: undefined as string | undefined,
        before: undefined as string | undefined,
        after: undefined as string | undefined,
        note: "데모 모드 — 추가 조사 없음",
        retryable: true,
      })),
    }),
  });

  const ANNOTATION_RE = / \((?:추가 조사|사람이 직접 처리):.*$/s;
  const changes: z.infer<typeof ReviewSchema>["changes"] = [];
  // 입력과 같은 길이·순서 유지 — null 이면 해결(수정했거나 이미 맞았음 확인), 문자열이면 아직 확인 필요
  const remaining: (string | null)[] = concerns.map((c) => c); // 모델이 빠뜨린 항목은 원래 문구 그대로(안전 기본값)
  for (const r of result.resolutions) {
    if (r.concernIndex < 0 || r.concernIndex >= concerns.length) continue;
    if (r.resolved && r.field && r.before && r.after) {
      changes.push({ field: r.field, before: r.before, after: r.after, reason: "사실오류", evidence: r.note });
      remaining[r.concernIndex] = null;
    } else if (r.resolved) {
      remaining[r.concernIndex] = null; // 원문이 이미 맞았던 것 확인 — 목록에서 제거
    } else {
      // 이전 회차에서 이미 "(추가 조사: …)"/"(사람이 직접 처리: …)"가 붙어 있었다면 그걸 떼고 이번 회차 결과로만 다시 붙임
      // — 안 그러면 다시 돌릴 때마다 계속 늘어나기만 함
      const base = concerns[r.concernIndex].replace(ANNOTATION_RE, "");
      // retryable=false(사람만 할 수 있는 일)는 다른 문구로 표시 — runAiReview 가 다음 회차부터 이 표시가 있으면
      // 아예 재조사 목록에 넣지 않아서, 영원히 못 풀 항목에 매번 웹검색을 또 쓰지 않게 함
      remaining[r.concernIndex] = r.retryable ? `${base} (추가 조사: ${r.note})` : `${base} (사람이 직접 처리: ${r.note})`;
    }
  }
  return { changes, remaining };
}

/** resolveConcerns 가 "사람만 할 수 있는 일"로 표시해 둔 항목 — 다음 검수부터 재조사 대상에서 뺌 */
const NON_RETRYABLE_MARK = "(사람이 직접 처리:";

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
    name: "factReview",
    task: "write",
    title: `AI 사실 검수: ${m.title}`,
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

  await ctx?.progress(80, `1차 검수 완료 — 제안 ${result.changes.length}건 · 확인 필요 ${result.concerns.length}건`);

  // "사람이 확인하세요"로 넘기기 전에, 그 항목들도 실제로 한 번 더 검색해서 확인 가능한 만큼은 AI 가 직접 해결합니다.
  // 원고 작성 때 글쓴이 AI 가 남긴 reviewChecklist(사람 검수 체크리스트)도 같이 넘겨서, 같은 사실을
  // "AI 검수 확인 필요"와 "사람 검수 체크리스트" 두 곳에 중복으로 남기지 않게 합니다.
  // 이전 회차에서 이미 "사람만 할 수 있는 일"로 판정된 항목은 또 웹검색을 시키지 않고 그대로 둠(토큰 낭비 방지).
  const retryableChecklist = m.reviewChecklist.filter((c) => !c.includes(NON_RETRYABLE_MARK));
  const skippedChecklist = m.reviewChecklist.filter((c) => c.includes(NON_RETRYABLE_MARK));
  const pool = [...result.concerns, ...retryableChecklist];
  const resolved = await resolveConcerns(m, platformName, pool, ctx);
  const reviewChecklist = [...resolved.remaining.slice(result.concerns.length).filter((c): c is string => c != null), ...skippedChecklist];
  if (skippedChecklist.length) await ctx?.log(`체크리스트 ${skippedChecklist.length}건은 사람만 할 수 있는 일로 이미 확인돼 재조사 안 함`);

  // 검수 모델이 "원문 그대로"를 지키라는 지시를 따르지 않고 요약·의역한 before 를 줄 때가 있어 —
  // 사람이 체크해서 "적용"을 눌러도 원문에서 못 찾아 실패하는 제안을 미리 걸러내고, 확인 필요로 돌림
  // (정보 자체는 버리지 않고 concerns 로 옮김).
  const allChanges = [...result.changes, ...resolved.changes];
  const verifiedChanges: typeof allChanges = [];
  const unverifiable: string[] = [];
  for (const c of allChanges) {
    if (currentTextAt(m, c.field)?.includes(c.before)) verifiedChanges.push(c);
    else unverifiable.push(`${c.field}: "${c.before}" → "${c.after}" (검수 모델이 준 원문 인용이 실제 원고와 달라 자동 적용을 걸렀어요 — ${c.evidence})`);
  }
  const concerns = [...resolved.remaining.slice(0, result.concerns.length).filter((c): c is string => c != null), ...unverifiable];
  const finalReview = { ...result, changes: verifiedChanges, concerns };

  const review: AiReview = { ...finalReview, at: new Date().toISOString(), applied: [] };
  await db.post.update({
    where: { id: postId },
    data: {
      aiReview: review as unknown as Prisma.InputJsonValue,
      ...(reviewChecklist.length !== m.reviewChecklist.length ? { content: { ...m, reviewChecklist } as unknown as Prisma.InputJsonValue } : {}),
    },
  });
  await ctx?.progress(100, `제안 ${finalReview.changes.length}건 · 확인 필요 ${finalReview.concerns.length}건`);
  return { changes: finalReview.changes.length };
}

function mockTypoChanges(m: Manuscript) {
  const hit = [m.intro, m.conclusion].find((t) => /  +/.test(t));
  return hit ? [{ field: hit === m.intro ? "intro" : "conclusion", before: "  ", after: " ", reason: "오탈자" as const, evidence: "공백 중복" }] : [];
}

/** 객체·배열 안의 문자열 값들을 재귀적으로 뒤져 before → after 치환 (표의 headers/rows 처럼 field 가 문자열이 아닌 중첩 구조를 가리킬 때 사용) */
function replaceNested(node: unknown, before: string, after: string): boolean {
  if (Array.isArray(node)) {
    let changed = false;
    for (let i = 0; i < node.length; i++) {
      if (typeof node[i] === "string" && node[i].includes(before)) {
        node[i] = node[i].replace(before, after);
        changed = true;
      } else if (node[i] != null && typeof node[i] === "object") {
        changed = replaceNested(node[i], before, after) || changed;
      }
    }
    return changed;
  }
  if (node != null && typeof node === "object") {
    let changed = false;
    for (const key of Object.keys(node as Record<string, unknown>)) {
      const v = (node as Record<string, unknown>)[key];
      if (typeof v === "string" && v.includes(before)) {
        (node as Record<string, unknown>)[key] = v.replace(before, after);
        changed = true;
      } else if (v != null && typeof v === "object") {
        changed = replaceNested(v, before, after) || changed;
      }
    }
    return changed;
  }
  return false;
}

/** 경로("sections.2.body" 또는 "sections.6.table" 처럼 표 등 중첩 구조도 가리킬 수 있음)의 값에서 before → after 치환 */
export function applyChange(m: Manuscript, change: { field: string; before: string; after: string }): boolean {
  if (!change.before) return false;
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
  if (typeof value === "string") {
    if (!value.includes(change.before)) return false;
    obj[last] = value.replace(change.before, change.after);
    return true;
  }
  if (replaceNested(value, change.before, change.after)) return true;
  // 검수 모델이 원고 JSON 을 보고 제안하다 보니, 표(rows)처럼 셀 여러 개에 걸친 조각을
  // before 로 줄 때가 있음(예: 행 두 개를 이어붙인 텍스트) — 낱개 문자열 안에서는 못 찾으므로
  // 그 필드 전체를 JSON 문자열로 펼쳐 놓고 찾아본 뒤 다시 구조로 되돌립니다.
  if (value != null && typeof value === "object") {
    const json = JSON.stringify(value);
    if (json.includes(change.before)) {
      try {
        const patched = JSON.parse(json.split(change.before).join(change.after));
        obj[last] = patched;
        return true;
      } catch {
        return false;
      }
    }
  }
  return false;
}

/** 필드 경로의 현재 문자열 값(중첩 구조는 JSON 문자열로) — 실패 원인 판단용 */
function currentTextAt(m: Manuscript, field: string): string | null {
  const parts = field.split(".");
  let target: unknown = m;
  for (const key of parts) {
    if (target == null || typeof target !== "object") return null;
    target = (target as Record<string, unknown>)[key];
  }
  return typeof target === "string" ? target : target != null ? JSON.stringify(target) : null;
}

/** 사람이 고른 제안만 적용 */
export async function applyAiReview(postId: string, indices: number[]) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId } });
  const m = readManuscript(post.content);
  const review = post.aiReview as AiReview | null;
  if (!m || !review) throw new Error("검수 결과가 없습니다.");
  const applied: number[] = [];
  const failed: { index: number; reason: string }[] = [];
  for (const i of indices) {
    const c = review.changes[i];
    if (!c || review.applied.includes(i)) continue;
    if (applyChange(m, c)) {
      applied.push(i);
      continue;
    }
    // 실패 이유를 구분: 같은 문단을 겹쳐서 고치는 다른 제안이 먼저 적용돼 문구가 이미 바뀐 경우(정상적인
    // 상황)와, 원고 자체가 그 사이에 편집돼 문구를 아예 못 찾는 경우(진짜 실패)를 다르게 안내합니다.
    const cur = currentTextAt(m, c.field);
    const reason =
      cur != null && cur.includes(c.after)
        ? "다른 제안이 먼저 적용되며 이미 반영됨(겹치는 수정)"
        : "원문에서 해당 문구를 찾지 못함 — 원고가 그 사이 바뀌었을 수 있음";
    failed.push({ index: i, reason });
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
  return { applied: applied.length, failed };
}
