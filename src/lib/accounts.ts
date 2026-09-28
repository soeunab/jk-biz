import { similarity } from "./content/similarity";

/**
 * 계정 콘셉트 점검 — 계정마다 다른 주제를 맡는 것이 원칙이므로,
 * 같은 플랫폼 계정끼리 콘셉트가 거의 같으면 경고합니다. 재발행 짝으로 묶인 계정은 의도된 중복이라 예외.
 */
export type ConceptAccount = { id: string; name: string; platform: string; concept: string; partnerIds: string[] };

export const CONCEPT_OVERLAP_WARN = 0.5;

export function conceptOverlaps(accounts: ConceptAccount[]) {
  const out: { a: string; b: string; similarity: number }[] = [];
  const blogs = accounts.filter((x) => ["BLOGGER", "NAVER"].includes(x.platform) && x.concept.trim());
  for (let i = 0; i < blogs.length; i++) {
    for (let j = i + 1; j < blogs.length; j++) {
      const [a, b] = [blogs[i], blogs[j]];
      if (a.platform !== b.platform) continue;
      if (a.partnerIds.includes(b.id) || b.partnerIds.includes(a.id)) continue;
      const s = similarity(a.concept, b.concept);
      if (s >= CONCEPT_OVERLAP_WARN) out.push({ a: a.id, b: b.id, similarity: Math.round(s * 100) / 100 });
    }
  }
  return out;
}
