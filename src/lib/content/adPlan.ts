import type { Manuscript } from "./types";

/**
 * 블로거 본문 인아티클 광고 위치 — 광고가 많아 독자가 떠나지 않게(체류시간) 정한 규칙.
 * - 첫 화면(직답·요약·목차)에는 광고를 두지 않고, 답을 준 뒤(1번 섹션 다음)부터.
 * - 본문 3,000자 미만은 1개, 이상은 최대 2개. 제휴 상품이 있는 글은 상품 클릭이 우선이라 1개만.
 * - 상품 박스가 있는 섹션과 그 앞뒤 섹션에는 광고를 두지 않음 (광고와 상품이 붙어 보이지 않게).
 * - 마지막 섹션 뒤(바로 FAQ·마무리)에는 두지 않음.
 * 돌려주는 값: 광고를 넣을 섹션 인덱스(0부터) — 그 섹션이 끝난 뒤에 광고가 들어갑니다.
 */
export const LONG_BODY_CHARS = 3000;

export function adPlan(m: Pick<Manuscript, "intro" | "sections">, productAfterSections: number[] = []): number[] {
  const n = m.sections.length;
  if (n < 2) return [];
  const length = m.intro.length + m.sections.reduce((a, s) => a + s.body.length, 0);
  const hasProducts = productAfterSections.length > 0;
  const max = hasProducts ? 1 : length >= LONG_BODY_CHARS ? 2 : 1;

  // afterSection 은 1부터 — 상품은 섹션 (p-1) 뒤에 붙으므로 그 섹션과 앞뒤 하나씩을 막음
  const blocked = new Set<number>();
  for (const p of productAfterSections) for (const i of [p - 2, p - 1, p]) blocked.add(i);
  const allowed = (i: number, chosen: number[]) => i >= 0 && i <= n - 2 && !blocked.has(i) && chosen.every((c) => Math.abs(c - i) >= 2);

  const chosen: number[] = [];
  for (const target of [0, Math.floor(((n - 1) * 2) / 3)]) {
    if (chosen.length >= max) break;
    // 목표 위치에서 가장 가까운 허용 위치 (뒤쪽 먼저 — 광고를 앞으로 당기지 않게)
    for (let d = 0; d < n; d++) {
      const hit = [target + d, target - d].find((i) => allowed(i, chosen));
      if (hit != null) {
        chosen.push(hit);
        break;
      }
    }
  }
  return chosen.sort((a, b) => a - b);
}
