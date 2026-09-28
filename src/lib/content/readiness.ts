import type { Brand } from "../brand";
import { detectRisk, manuscriptRiskText, PREDICTIVE_RE } from "./risk";
import { countPlaceholders } from "./seo";
import { manuscriptText } from "./render";
import type { Manuscript } from "./types";

export type ReadinessIssue = { id: string; message: string };

/**
 * 승인 전 확인 사유 — 통과/차단을 대신 결정하지 않고, 사람이 읽고 판단할 수 있는 문장으로 만듭니다.
 * 사유가 있어도 검수자가 확인 후 "그래도 승인"할 수 있습니다.
 */
export function readinessIssues(
  m: Manuscript,
  ctx: { brand: Pick<Brand, "disclosure">; similarity?: { warn: boolean; max: number; with: { title: string } | null } | null },
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

  if (m.affiliate.length && !ctx.brand.disclosure.affiliate.trim()) {
    issues.push({ id: "disclosure", message: "제휴 링크가 있는데 대가성 문구가 비어 있어요. [설정 → 브랜드]에서 입력해 주세요." });
  }
  if (ctx.similarity?.warn) {
    issues.push({ id: "similarity", message: `같은 플랫폼의 “${ctx.similarity.with?.title ?? "다른 원고"}”와 ${Math.round(ctx.similarity.max * 100)}% 비슷해요. 관점·예시를 바꿔 주세요.` });
  }
  return issues;
}
