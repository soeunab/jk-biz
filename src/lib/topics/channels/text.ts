/**
 * 한국어 숫자·시간 파싱과 제목 토큰화 (원본: reference/contents-finder/finder/util.py)
 * 교차검증(crossref)·점수(scoring)가 파이썬 원본과 같은 결과를 내도록 규칙을 그대로 옮겼습니다.
 */

/** 파이썬 round() 와 같은 반올림 (정확히 .5 이면 짝수 쪽) */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

const COUNT_RE = /([\d][\d,]*\.?\d*)\s*(억|만|천|K|k|M|m)?/;
const UNIT: Record<string, number> = { 억: 100_000_000, 만: 10_000, 천: 1_000, K: 1_000, k: 1_000, M: 1_000_000, m: 1_000_000 };

/** '4.7만' → 47000, '6만 명' → 60000, '5천+' → 5000, '1,234' → 1234, '2.3K' → 2300 */
export function parseCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = String(text).match(COUNT_RE);
  if (!m) return null;
  const num = Number(m[1].replace(/,/g, ""));
  if (Number.isNaN(num)) return null;
  return pyRound(num * (UNIT[m[2] ?? ""] ?? 1));
}

/** '1,000%' → 1000 */
export function parsePct(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = String(text).match(/([\d][\d,]*)\s*%/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

const AGO_RE = /(?:(\d+)\s*일)?\s*(?:(\d+)\s*시간)?\s*(?:(\d+)\s*분)?\s*(?:(\d+)\s*초)?\s*전/;

/** '56분 전' → 56, '2시간 전' → 120, '1일 전' → 1440, '방금 전' → 0 ('6시간 동안 지속됨' 은 null) */
export function parseAgoMinutes(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = String(text).trim();
  if (t.includes("방금")) return 0;
  if (t.includes("동안")) return null;
  const m = t.match(AGO_RE);
  if (!m || !m.slice(1).some((g) => g !== undefined)) return null;
  const [d, h, mi] = m.slice(1, 4).map((x) => (x ? Number(x) : 0));
  return d * 1440 + h * 60 + mi;
}

const KST = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00+09:00`);
const since = (t: Date, now: Date) => (Number.isFinite(t.getTime()) ? Math.max(0, Math.floor((now.getTime() - t.getTime()) / 60_000)) : null);

/**
 * 수집기용 나이 파싱 — parseAgoMinutes(원본 규칙, 동등성 테스트 대상)가 못 읽는 형식까지 읽습니다.
 * 원본은 '1주 전'·'어제'·'2026.10.01. 오후 3:12' 를 null(=나이 모름)로 둬서, 신선도 필터가 오래된 자료를 "신선"으로 통과시켰습니다.
 *  - 'N주 전'·'N개월 전'·'N달 전'·'N년 전', '어제'·'그제'
 *  - 'YYYY.MM.DD.'(+ '오전/오후 H:MM'), 'MM.DD.', 'YYYY-MM-DD HH:MM', ISO — 한국 시간 기준
 */
export function parseAgeMinutes(text: string | null | undefined, now = new Date()): number | null {
  const ago = parseAgoMinutes(text);
  if (ago != null) return ago;
  if (!text) return null;
  const t = String(text).trim();
  if (t.includes("동안")) return null;
  const unit = t.match(/(\d+)\s*(주|개월|달|년)\s*전/);
  if (unit) return Number(unit[1]) * { 주: 10_080, 개월: 43_200, 달: 43_200, 년: 525_600 }[unit[2] as "주"];
  if (/^(그제|그저께)/.test(t)) return 2880;
  if (t.startsWith("어제")) return 1440;
  const hm = (s: string) => {
    const m = s.match(/(오전|오후)?\s*(\d{1,2}):(\d{2})/);
    if (!m) return [0, 0];
    let h = Number(m[2]);
    if (m[1] === "오후" && h < 12) h += 12;
    if (m[1] === "오전" && h === 12) h = 0;
    return [h, Number(m[3])];
  };
  const full = t.match(/(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (full) {
    if (/T\d{2}:\d{2}/.test(t)) return since(new Date(t), now);
    const [h, mi] = hm(t.slice(full.index! + full[0].length));
    return since(KST(Number(full[1]), Number(full[2]), Number(full[3]), h, mi), now);
  }
  const short = t.match(/^(\d{1,2})\.\s*(\d{1,2})\./);
  if (short) {
    const [h, mi] = hm(t.slice(short[0].length));
    const y = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(now));
    let d = KST(y, Number(short[1]), Number(short[2]), h, mi);
    if (d.getTime() > now.getTime() + 86_400_000) d = KST(y - 1, Number(short[1]), Number(short[2]), h, mi); // 연초에 본 '12.31.'
    return since(d, now);
  }
  return null;
}

/** 네이버 뉴스 클러스터 주소의 생성 시각 ('/cluster/c_202610021430_00001216/…' → 한국 시간 2026-10-02 14:30) */
export function clusterAgeMinutes(href: string | null | undefined, now = new Date()): number | null {
  const m = (href ?? "").match(/c_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})_/);
  return m ? since(KST(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])), now) : null;
}

export function fmtAgo(minutes: number | null | undefined): string {
  if (minutes == null) return "-";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 1440)}일 전`;
}

/** 파이썬 "{:,}".format(n) */
export function comma(n: number): string {
  return n.toLocaleString("en-US");
}

/** 47000 → '4.7만', 1234 → '1,234' */
export function fmtCount(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 10_000) {
    const tenth = pyRound((n / 10_000) * 10) / 10; // 파이썬 "%.1f" (정확히 .5 이면 짝수 쪽)
    return `${tenth.toFixed(1)}만`.replace(".0만", "만");
  }
  return comma(n);
}

export function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------- 토큰화
const JOSA = [
  "에서는", "으로는", "에게서", "이라는", "이라고", "으로", "에서", "에게", "까지", "부터", "처럼", "보다",
  "마저", "조차", "이나", "이란", "라는", "라고", "에는", "에도", "으로", "은", "는", "이", "가", "을", "를",
  "의", "에", "도", "만", "로", "과", "와", "께",
].sort((a, b) => b.length - a.length); // 파이썬 sorted(key=len, reverse=True) 와 같이 안정 정렬

export const STOPWORDS = new Set(
  `관련 기자 오늘 어제 내일 이번 지난 올해 내년 대해 위해 통해 이후 가운데 사이 최근 현재 결국 또한 하지만 그리고
공개 발표 이유 논란 단독 속보 종합 영상 동영상 사진 포토 인터뷰 연합뉴스 뉴스1 뉴시스 한국경제 매일경제
서울경제 조선일보 중앙일보 동아일보 한겨레 경향신문 머니투데이 이데일리 아시아경제 헤럴드경제 파이낸셜뉴스
스포츠 오늘의 대한 무엇 어떻게 어떤 정말 진짜 완전 대박 충격 반전 현실 이유는 있다 없다 한다 했다 된다 됐다`.split(/\s+/),
);

export function stripJosa(tok: string): string {
  for (const j of JOSA) {
    if (tok.endsWith(j) && tok.length - j.length >= 2) return tok.slice(0, -j.length);
  }
  return tok;
}

const PRESS_SUFFIX = /\s+[-–|]\s+[^-–|]{2,14}$/;

/** 구글 뉴스 제목 끝의 ' - 조선비즈' 같은 매체명 꼬리 제거 (매체명 때문에 다른 기사가 묶이는 것을 방지) */
export function stripPressSuffix(text: string): string {
  return (text ?? "").replace(PRESS_SUFFIX, "");
}

const TAG_RE = /\[[^\]]{1,14}\]|【[^】]{1,14}】/g; // [단독] [속보] 같은 말머리
const ENDING_RE = /(는데|은데|지만|면서|라며|라고|했다|한다|됐다|였다|이다|입니다)$/;
const HANGUL = /[가-힣]/;

/** 제목에서 비교용 토큰 집합 (조사·불용어·숫자만인 토큰·서술어·숫자+단위 제외) */
export function tokens(text: string): Set<string> {
  const raw = stripPressSuffix(text).replace(TAG_RE, " ").match(/[가-힣A-Za-z0-9]{2,}/g) ?? [];
  const out = new Set<string>();
  for (const r of raw) {
    const t = HANGUL.test(r) ? stripJosa(r.toLowerCase()) : r.toLowerCase();
    if (t.length < 2 || STOPWORDS.has(t) || /^\d+$/.test(t)) continue;
    if (ENDING_RE.test(t) && HANGUL.test(t)) continue; // '알았는데', '했지만' 같은 서술어
    if (/^\d+[가-힣]{1,3}$/.test(t)) continue; // '2027년', '10시간', '34세' 같은 숫자+단위
    out.add(t);
  }
  return out;
}

/** 공백·기호 제거 후 소문자 (부분 문자열 비교용) */
export function norm(text: string): string {
  return stripPressSuffix(text).toLowerCase().replace(/[^가-힣a-z0-9]/g, "");
}
