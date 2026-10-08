import type { Brand } from "../brand";
import { detectRisk, hasInvestDisclaimer, manuscriptRiskText, PREDICTIVE_RE, tradeAdviceFaqs } from "./risk";
import { findTenseConflicts } from "./tense";
import { countPlaceholders } from "./seo";
import { manuscriptText } from "./render";
import type { Manuscript } from "./types";

export type ReadinessIssue = { id: string; message: string };

/** Post.aiReview 에서 제목-본문 일치 판정만 (검수 전이면 null, 예전 검수라 판정이 없으면 parts 빈 배열) */
export function alignmentFrom(aiReview: unknown): { mainKeyword?: string; parts: { part: string; onTopic: boolean; note: string }[] } | null {
  const r = aiReview as { mainKeyword?: string; alignment?: { part: string; onTopic: boolean; note: string }[] } | null;
  return r ? { mainKeyword: r.mainKeyword, parts: r.alignment ?? [] } : null;
}

/**
 * 승인 전 확인 사유 — 통과/차단을 대신 결정하지 않고, 사람이 읽고 판단할 수 있는 문장으로 만듭니다.
 * 사유가 있어도 검수자가 확인 후 "그래도 승인"할 수 있습니다.
 */
export function readinessIssues(
  m: Manuscript,
  ctx: {
    brand: Pick<Brand, "disclosure">;
    similarity?: { warn: boolean; max: number; with: { title: string } | null } | null;
    /** 발행될 HTML (고지 문구 실제 포함 여부 확인) */
    renderedHtml?: string;
    researchNotes?: string | null;
    today?: string;
    /** 재발행 원고: 원본과의 유사도·원본 URL */
    republish?: { sourceTitle: string; sourceUrl: string | null; similarity: number; warn: boolean } | null;
    /** 계정 콘셉트 (undefined 면 검사 안 함) */
    accountConcept?: string | null;
    /** AI 검수의 제목-본문 일치 판정 (undefined 면 검사 안 함, null 이면 아직 검수 전) */
    alignment?: { mainKeyword?: string; parts: { part: string; onTopic: boolean; note: string }[] } | null;
  },
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const ph = countPlaceholders(m);
  if (ph) issues.push({ id: "experience", message: `[경험 추가] 자리표시 ${ph}개가 비어 있어요. 실제 경험으로 채우거나 문장을 지워 주세요. (발행본에서는 자동으로 제거됩니다)` });

  const risk = detectRisk(manuscriptRiskText(m));
  if (risk && m.sources.length === 0) {
    issues.push({ id: "risk-sources", message: `고위험 주제(${risk.labels.join("·")})인데 공식 출처가 없어요. 금액·요건·기한의 근거를 확인해 주세요.` });
  }
  const predictive = manuscriptText(m).match(PREDICTIVE_RE)?.[0];
  if (risk && predictive) issues.push({ id: "risk-predictive", message: `예측·보장 표현 "${predictive}"이(가) 있어요.` });

  if (risk?.categories.includes("INVEST")) {
    if (!hasInvestDisclaimer(ctx.renderedHtml ?? manuscriptText(m))) {
      issues.push({ id: "invest-disclaimer", message: "투자·재테크 주제인데 \"투자 권유가 아니며 최종 판단과 책임은 본인에게 있다\"는 고지 문구가 발행될 글에 없어요." });
    }
    const trade = tradeAdviceFaqs(m.faq);
    if (trade.length) {
      issues.push({ id: "invest-faq", message: `FAQ "${trade[0].q}"에서 매수·매도를 대신 판단하고 있어요. 확인된 사실과 지켜볼 지표만 답하도록 고쳐 주세요.` });
    }
  }

  const tense = findTenseConflicts(m, { today: ctx.today ?? new Date().toISOString().slice(0, 10), researchNotes: ctx.researchNotes });
  if (tense.length) {
    issues.push({
      id: "tense",
      message: `이미 벌어진 일을 미래형으로 쓴 것 같은 문장 ${tense.length}개: “${tense[0].sentence.slice(0, 50)}…” — ${tense[0].reason}`,
    });
  }

  if (ctx.republish) {
    if (ctx.republish.warn) {
      issues.push({
        id: "republish-similar",
        message: `재발행 원본 “${ctx.republish.sourceTitle}”와 ${Math.round(ctx.republish.similarity * 100)}% 비슷해요. 구글은 블로거·네이버 글을 모두 색인하므로 관점·구성·예시를 더 바꿔 주세요.`,
      });
    }
    if (!ctx.republish.sourceUrl) {
      issues.push({ id: "republish-no-url", message: `원본 “${ctx.republish.sourceTitle}”이(가) 아직 발행 전이라 백링크 주소가 없어요. 원본을 먼저 공개 발행하면 링크가 자동으로 들어갑니다.` });
    }
  }
  if (ctx.accountConcept !== undefined && !ctx.accountConcept?.trim()) {
    issues.push({ id: "concept-empty", message: "이 계정은 콘셉트가 비어 있어 다른 계정과 제목·관점이 비슷한 글이 나올 수 있어요. [계정 관리]에서 콘셉트를 적어 주세요." });
  }

  if (m.affiliate.length && !ctx.brand.disclosure.affiliate.trim()) {
    issues.push({ id: "disclosure", message: "제휴 링크가 있는데 대가성 문구가 비어 있어요. [설정 → 브랜드]에서 입력해 주세요." });
  }
  if (ctx.alignment === null || (ctx.alignment && !ctx.alignment.parts.length)) {
    issues.push({ id: "alignment-unchecked", message: "제목-본문 일치를 아직 확인하지 않았어요. [AI 사실 검수]를 실행하면 섹션·FAQ마다 메인 키워드에 대한 내용인지 함께 확인해요." });
  } else if (ctx.alignment) {
    const off = ctx.alignment.parts.filter((p) => !p.onTopic);
    if (off.length) {
      issues.push({
        id: "alignment",
        message: `${ctx.alignment.parts.length}개 중 ${off.length}개 부분이 메인 키워드${ctx.alignment.mainKeyword ? ` “${ctx.alignment.mainKeyword}”` : ""}와 다른 내용이에요 — ${off
          .slice(0, 3)
          .map((p) => `${p.part}: ${p.note.replace(/[.。\s]+$/, "")}`)
          .join(" / ")}. 해당 섹션을 [다시 쓰기]로 고친 뒤 [다시 검수]해 주세요 (네이버는 제목과 본문 덩어리마다 일치도를 봐요).`,
      });
    }
  }
  if (ctx.similarity?.warn) {
    issues.push({ id: "similarity", message: `같은 플랫폼의 “${ctx.similarity.with?.title ?? "다른 원고"}”와 ${Math.round(ctx.similarity.max * 100)}% 비슷해요. 관점·예시를 바꿔 주세요.` });
  }
  return issues;
}
