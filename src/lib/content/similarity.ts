/**
 * 유사문서 방지: 글자 3-gram Jaccard 유사도.
 * 네이버는 계정 간 유사 문서를 저품질로 판단할 수 있어, 같은 주제를 여러 계정에 쓸 때 경고합니다.
 */
export function shingles(text: string, n = 3): Set<string> {
  const t = text.replace(/[\s\p{P}]/gu, "").toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function similarity(a: string, b: string): number {
  return jaccard(shingles(a), shingles(b));
}

/** 이 값 이상이면 "유사 문서 위험" 으로 표시 */
export const SIMILARITY_WARN = 0.35;
