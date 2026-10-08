import { normalizeKeyword } from "../topics/scoring";

export type LinkCandidate = { title: string; url: string; focusKeyword: string; mainKeyword?: string | null; tags: string[]; publishedAt?: Date | null };
export type RankedLink = { title: string; url: string; pillar: boolean };

/**
 * 내부링크 후보 순서 — 같은 주제 묶음(클러스터)을 먼저.
 * - 필러: 이 글의 메인 키워드 자체를 다룬 글(focusKeyword == 메인 키워드). 위성 글은 필러로 반드시 링크.
 * - 같은 메인 키워드에서 나온 다른 롱테일 글, 태그가 겹치는 글 순. 나머지는 최근 글로 채움.
 * 실제로 본문에 넣을지는 원고 AI 가 문맥을 보고 정합니다(관련 없으면 넣지 않음).
 */
export function rankInternalLinks(current: { keyword: string; mainKeyword?: string | null; terms?: string[] }, candidates: LinkCandidate[], take = 8): RankedLink[] {
  const main = normalizeKeyword(current.mainKeyword || current.keyword);
  const self = normalizeKeyword(current.keyword);
  const terms = new Set([main, self, ...(current.terms ?? []).map(normalizeKeyword)].filter(Boolean));
  const scored = candidates
    .filter((c) => normalizeKeyword(c.focusKeyword) !== self) // 같은 키워드 글은 중복 경쟁이라 링크 대상 아님
    .map((c, i) => {
      const pillar = !!main && normalizeKeyword(c.focusKeyword) === main;
      let score = 0;
      if (pillar) score += 5;
      if (main && c.mainKeyword && normalizeKeyword(c.mainKeyword) === main) score += 3;
      if (c.tags.some((t) => terms.has(normalizeKeyword(t)))) score += 1;
      return { c, pillar, score, i };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i); // 동점이면 입력 순서(최근 글 먼저)
  return scored.slice(0, take).map(({ c, pillar }) => ({ title: c.title, url: c.url, pillar }));
}
