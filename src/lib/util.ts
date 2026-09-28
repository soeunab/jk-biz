export function slugify(input: string): string {
  // 블로거 permalink 용: 영문/숫자만 남기고, 한글만 있는 경우 날짜 기반으로 대체
  const ascii = input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return ascii.length >= 3 ? ascii.slice(0, 60) : `post-${Date.now().toString(36)}`;
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function stripHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** 공백 제외 글자 수 (네이버 블로그에서 흔히 쓰는 기준) */
export function charCount(text: string): number {
  return text.replace(/\s/g, "").length;
}

export function startOfDay(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function daysAgo(n: number): Date {
  const d = startOfDay();
  d.setDate(d.getDate() - n);
  return d;
}

export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function asObject<T extends object>(v: unknown, fallback: T): T {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : fallback;
}

export function formatKRW(n: number) {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(n);
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(n));
}

/** 한국어 조사 선택: josa("직장인", "을/를") → "직장인을" */
export function josa(word: string, pair: "을/를" | "이/가" | "은/는" | "와/과" | "으로/로" | "이라면/라면"): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  const [withBatchim, without] = pair.split("/");
  if (code < 0xac00 || code > 0xd7a3) return word + without; // 영문·숫자 등은 받침 없음으로 처리
  const jong = (code - 0xac00) % 28;
  if (pair === "으로/로" && jong === 8) return word + without; // ㄹ 받침은 "로"
  return word + (jong ? withBatchim : without);
}

/** 단어 경계에서 자르기 */
export function truncateWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const i = cut.lastIndexOf(" ");
  return (i > max * 0.5 ? cut.slice(0, i) : cut).replace(/[\s—\-·,]+$/, "");
}
