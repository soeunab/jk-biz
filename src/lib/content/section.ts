import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { getBrand } from "../brand";
import { generateJson } from "../llm";
import type { JobContext } from "../jobs/queue";
import { buildSystemPrompt } from "./prompts";
import { readManuscript, rerenderPost } from "./service";
import { SectionSchema, type Platform } from "./types";

/**
 * 섹션 하나만 AI 로 다시 쓰기 — 원고 전체를 재생성하면 사람이 고친 내용과 구조가 흔들리므로,
 * 검수자가 지정한 섹션만 같은 규칙으로 다시 씁니다. 소제목(검색 데이터 기반)은 유지합니다.
 */
export async function rewriteSection(postId: string, index: number, instruction: string, ctx?: JobContext) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId } });
  const m = readManuscript(post.content);
  if (!m || !m.sections[index]) throw new Error("섹션을 찾을 수 없습니다.");
  const brand = await getBrand();
  const target = m.sections[index];
  const outline = m.sections.map((s, i) => `${i === index ? "▶ " : ""}${i + 1}. ${s.heading}`).join("\n");

  const section = await generateJson({
    system: buildSystemPrompt(brand, post.platform as Platform),
    prompt: `아래 원고의 ${index + 1}번 섹션만 다시 써 주세요.
- 소제목(heading)은 그대로 유지하세요: "${target.heading}"
- 앞뒤 섹션과 내용이 겹치지 않게, 이 섹션의 역할에 집중하세요.
- 경험이 필요한 곳은 "[경험 추가: …]" 자리표시로 남기세요.
${instruction ? `- 검수자 요청: ${instruction}` : ""}

[원고 제목] ${m.title}
[핵심 키워드] ${m.focusKeyword}
[전체 목차]
${outline}

[현재 섹션 본문]
${target.body}`,
    schema: SectionSchema,
    effort: "medium",
    maxTokens: 8000,
    mock: () => ({
      ...target,
      body: `${target.body}\n\n${instruction ? `(요청 반영: ${instruction}) ` : ""}[경험 추가: 이 단계를 직접 해보며 느낀 점]`,
    }),
  });

  m.sections[index] = { ...section, heading: target.heading, image: target.image };
  await db.post.update({ where: { id: postId }, data: { content: m as unknown as Prisma.InputJsonValue } });
  await rerenderPost(postId);
  await ctx?.log(`${index + 1}번 섹션 다시 쓰기 완료`);
  return { index };
}
