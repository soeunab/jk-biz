import { createHmac } from "node:crypto";
import { env } from "../env";
import { ymd, daysAgo } from "../util";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url.split("?")[0]}`);
  return (await res.json()) as T;
}

/** 네이버 자동완성 (키 불필요) */
export async function naverAutocomplete(q: string): Promise<string[]> {
  const url = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(q)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100`;
  const data = await fetchJson<{ items?: string[][][] }>(url, { headers: { "User-Agent": UA } });
  return (data.items?.[0] ?? []).map((row) => row[0]).filter(Boolean);
}

/** 구글 자동완성 (키 불필요) */
export async function googleAutocomplete(q: string): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=ko&gl=kr&q=${encodeURIComponent(q)}`;
  const data = await fetchJson<[string, string[]]>(url, { headers: { "User-Agent": UA } });
  return data[1] ?? [];
}

export type AdKeyword = {
  keyword: string;
  monthlyPc: number;
  monthlyMobile: number;
  monthlyClicks: number;
  /** 광고 경쟁도: 높음 | 중간 | 낮음 — 광고주가 많을수록 CPC 가 높아 애드센스/애드포스트 단가가 좋습니다. */
  compIdx: string;
  adDepth: number;
};

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return v.includes("<") ? 5 : Number(v.replace(/,/g, "")) || 0;
  return 0;
}

/** 네이버 검색광고 키워드도구 — 월간 검색량, 광고 경쟁도 */
export async function naverSearchAdKeywords(hints: string[]): Promise<AdKeyword[]> {
  const cred = env.naverSearchAd;
  if (!cred || hints.length === 0) return [];
  const path = "/keywordstool";
  const out: AdKeyword[] = [];
  // API 는 한 번에 힌트 키워드 5개까지, 공백 없이 받습니다.
  for (let i = 0; i < hints.length; i += 5) {
    const batch = hints.slice(i, i + 5).map((h) => h.replace(/\s+/g, ""));
    const ts = Date.now().toString();
    const signature = createHmac("sha256", cred.secret).update(`${ts}.GET.${path}`).digest("base64");
    const url = `https://api.searchad.naver.com${path}?hintKeywords=${encodeURIComponent(batch.join(","))}&showDetail=1`;
    const data = await fetchJson<{ keywordList?: Record<string, unknown>[] }>(url, {
      headers: { "X-Timestamp": ts, "X-API-KEY": cred.key, "X-Customer": cred.customer, "X-Signature": signature },
    });
    for (const k of data.keywordList ?? []) {
      out.push({
        keyword: String(k.relKeyword),
        monthlyPc: toNum(k.monthlyPcQcCnt),
        monthlyMobile: toNum(k.monthlyMobileQcCnt),
        monthlyClicks: toNum(k.monthlyAvePcClkCnt) + toNum(k.monthlyAveMobileClkCnt),
        compIdx: String(k.compIdx ?? ""),
        adDepth: toNum(k.plAvgDepth),
      });
    }
  }
  return out;
}

/** 네이버 블로그 검색 결과 총 문서 수 (경쟁 강도 지표) */
export async function naverBlogDocCount(q: string): Promise<number | null> {
  const cred = env.naverOpenApi;
  if (!cred) return null;
  const data = await fetchJson<{ total?: number }>(
    `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(q)}&display=1`,
    { headers: { "X-Naver-Client-Id": cred.id, "X-Naver-Client-Secret": cred.secret } },
  );
  return data.total ?? null;
}

/** 네이버 데이터랩 검색어 트렌드 — 최근 4주 vs 이전 8주 비율 (1.0 = 보합) */
export async function naverTrendMomentum(keywords: string[]): Promise<Record<string, number>> {
  const cred = env.naverOpenApi;
  const result: Record<string, number> = {};
  if (!cred) return result;
  for (let i = 0; i < keywords.length; i += 5) {
    const batch = keywords.slice(i, i + 5);
    const body = {
      startDate: ymd(daysAgo(7 * 12)),
      endDate: ymd(daysAgo(1)),
      timeUnit: "week",
      keywordGroups: batch.map((k) => ({ groupName: k, keywords: [k] })),
    };
    const data = await fetchJson<{ results?: { title: string; data: { ratio: number }[] }[] }>(
      "https://openapi.naver.com/v1/datalab/search",
      {
        method: "POST",
        headers: { "X-Naver-Client-Id": cred.id, "X-Naver-Client-Secret": cred.secret, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    for (const r of data.results ?? []) {
      const ratios = r.data.map((d) => d.ratio);
      const recent = avg(ratios.slice(-4));
      const before = avg(ratios.slice(0, -4));
      result[r.title] = before > 0 ? recent / before : recent > 0 ? 2 : 1;
    }
  }
  return result;
}

/** 구글 트렌드 한국 실시간 인기 검색어 (RSS) */
export async function googleTrendingKR(): Promise<string[]> {
  const res = await fetch("https://trends.google.com/trending/rss?geo=KR", {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const xml = await res.text();
  return [...xml.matchAll(/<item>[\s\S]*?<title>([^<]+)<\/title>/g)].map((m) => m[1].trim());
}

function avg(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
