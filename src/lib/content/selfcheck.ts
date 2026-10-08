import { z } from "zod";
import { extractJson, RESEARCH_SYSTEM, routeFor } from "../llm";
import { runClaudeCode } from "../llm/claudeCode";
import { applyChange } from "./review";
import type { Manuscript } from "./types";

/**
 * 원고 작성 직후 자체 사실 점검 — "AI 사실 검수에서 지적이 거의 없을 만큼 사실 기반 원고"가 목표(2026-10-08 사용자).
 * 2026-10-08 실험: 조사 강화 후에도 검수 지적 4건이 남았는데, 틀린 숫자가 아니라 공식 도움말로 확인되는 내용을
 * "자료마다 달라요·공식 확인 필요"로 유보한 문장이었음 → 원고의 사실 진술을 공식 출처로 한 번 더 대조해 사람에게 넘기기 전에 고칩니다.
 * 사람 검수 전(초안) 단계라 '사람 검수 후 공개' 원칙과 충돌하지 않고, 고친 내역은 조사 기록(research.selfCheck)과 작업 로그에 남깁니다.
 */
export const SelfCheckSchema = z.object({
  changes: z
    .array(
      z.object({
        field: z.string().describe("수정 위치: directAnswer | intro | conclusion | tldr.N | sections.N.body | sections.N.table | sections.N.tip | faq.N.a | metaDescription (N 은 0부터)"),
        before: z.string().describe("원고에서 글자 그대로 발췌한 짧은 구절"),
        after: z.string().describe("고친 구절 — 문체·분량은 그대로"),
        evidence: z.string().describe("근거 공식 출처 URL 과 한 줄 설명"),
      }),
    )
    .describe("고칠 것만. 맞는 문장은 넣지 마세요"),
});
export type SelfCheck = z.infer<typeof SelfCheckSchema>;

export async function selfCheckManuscript(m: Manuscript, ctx: { keyword: string; notes: string; today: string; pages?: string; log?: (s: string) => unknown }) {
  if ((await routeFor("research")) !== "claude-code") return { applied: [] as SelfCheck["changes"], skipped: 0 };
  const out = await runClaudeCode({
    system: RESEARCH_SYSTEM,
    prompt: `오늘은 ${ctx.today}입니다. 아래는 "${ctx.keyword}" 블로그 원고 초안입니다. 사람 검수 전에 사실만 점검하세요.
점검 대상: 숫자·금액·요금·한도·날짜·기간·대상 조건·제도명·요금제명·모델명 같은 사실 진술, 그리고 "자료마다 달라요·공식 확인 필요·확인되지 않았어요" 같은 유보 표현.
- 조사 메모 맨 앞 [핵심 수치 재확인]의 ✔·✎ 값과 다르면 그 값으로 고치세요.
- 유보한 내용이 공식 출처(정부·공공기관·공시·제품 공식 도움말/요금 페이지/공식 발표)로 확인되면 확인된 값으로 단정하게 고치세요.
  공식 페이지가 직접 안 열리면 같은 공식 도메인을 검색(site:)해 확인하세요. 2차 자료만 있으면 유보 표현을 그대로 두세요.
- 지난 연도 기준 값, 근거 없는 단정, 공식 출처와 다른 2차 자료 수치는 고치세요.
- 고유명사·모델명·요금제명이 공식 표기와 다르거나 버전이 빠져 다른 것과 헷갈리면 공식 표기로 고치세요.
- 출처 없는 반응·여론·추세 문장("커뮤니티에서 화제·불만", "많이들 써요")은 출처가 없으면 사실만 남기게 고치세요.
- 표·목록의 값에 공식 출처의 조건(요금제·좌석 종류·결제 주기·기준 연도·단위)이 빠졌으면 붙이세요.
- 공식 출처로 확인할 수 없는 구체적인 세부(메뉴 경로·화면 문구·정확한 수치)는 유보 표현으로 남기지 말고 빼거나 일반적으로 고치세요
  ("설정 → 사용량에서 확인" → "계정 설정의 사용량 화면에서 확인"처럼). 사람이 나중에 확인할 거리를 남기지 않는 것이 목표입니다.
- 최종 사실 검수자처럼 엄격하게 보세요: 사람 검수의 AI 사실 검수가 이 원고에서 고칠 것을 찾지 못하게 만드는 것이 목표입니다.
- 제목·소제목·구조·문체·분량·[경험 추가: …] 자리표시는 바꾸지 마세요. 맞는 문장은 changes 에 넣지 마세요.

[조사 메모]
${ctx.notes.slice(0, 12_000)}
${ctx.pages ?? ""}

[원고 JSON]
${JSON.stringify({ title: m.title, metaDescription: m.metaDescription, directAnswer: m.directAnswer, tldr: m.tldr, intro: m.intro, sections: m.sections.map((s) => ({ heading: s.heading, body: s.body, table: s.table, tip: s.tip })), faq: m.faq, conclusion: m.conclusion })}`,
    jsonSchema: z.toJSONSchema(SelfCheckSchema) as object,
    tools: ["WebSearch", "WebFetch"],
  });
  const parsed = SelfCheckSchema.safeParse(out.structured ?? extractJson(out.text));
  if (!parsed.success) return { applied: [] as SelfCheck["changes"], skipped: 0 };
  const applied: SelfCheck["changes"] = [];
  let skipped = 0;
  for (const c of parsed.data.changes) {
    if (!c.before || c.before === c.after) continue;
    if (applyChange(m, c)) applied.push(c);
    else skipped++; // 원문 인용이 정확하지 않으면 건너뜀(사람 검수의 AI 사실 검수가 다시 봄)
  }
  return { applied, skipped };
}
