import { createHmac } from "node:crypto";
import { env } from "../env";
import { ymd, daysAgo } from "../util";
import { withPage } from "../browser";

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

/**
 * 네이버 통합검색 결과 페이지의 "함께 많이 찾는" 위젯 (키 불필요, 화면 구조 스크래핑).
 * 공식 API 가 아니라 화면이 바뀌면 깨질 수 있음 — 실패하면 빈 배열.
 */
export async function naverRelatedSearch(q: string): Promise<string[]> {
  return withPage(
    async (page) => {
      await page.goto(`https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(1500);
      return page.evaluate(() => {
        const heading = [...document.querySelectorAll("*")].find(
          (el) => el.children.length === 0 && el.textContent?.trim() === "함께 많이 찾는",
        );
        let container: Element | null = heading?.parentElement ?? null;
        for (let i = 0; i < 6 && container; i++) {
          if (container.querySelectorAll("a").length >= 5) break;
          container = container.parentElement;
        }
        if (!container) return [];
        const out: string[] = [];
        for (const a of container.querySelectorAll("a")) {
          try {
            const query = new URL((a as HTMLAnchorElement).href).searchParams.get("query");
            if (query) out.push(query);
          } catch {
            /* 무시 */
          }
        }
        return out;
      });
    },
    { width: 1280, height: 1400 },
  ).catch(() => []);
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

/**
 * 네이버 검색광고 키워드도구 — 월간 검색량, 광고 경쟁도.
 * 힌트 5개씩 나눠 호출하고, 한 묶음이 실패해도(특수문자 힌트·일시적 제한) 나머지는 계속합니다. 전부 실패하면 첫 오류를 던집니다.
 */
export async function naverSearchAdKeywords(hints: string[]): Promise<AdKeyword[]> {
  const cred = env.naverSearchAd;
  // API 는 힌트를 공백·특수문자 없이 받습니다.
  const clean = [...new Set(hints.map((h) => h.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean))];
  if (!cred || clean.length === 0) return [];
  const path = "/keywordstool";
  const out: AdKeyword[] = [];
  const errors: Error[] = [];
  const call = async (batch: string[]) => {
    const ts = Date.now().toString();
    const signature = createHmac("sha256", cred.secret).update(`${ts}.GET.${path}`).digest("base64");
    const url = `https://api.searchad.naver.com${path}?hintKeywords=${encodeURIComponent(batch.join(","))}&showDetail=1`;
    return fetchJson<{ keywordList?: Record<string, unknown>[] }>(url, {
      headers: { "X-Timestamp": ts, "X-API-KEY": cred.key, "X-Customer": cred.customer, "X-Signature": signature },
    });
  };
  for (let i = 0; i < clean.length; i += 5) {
    const batch = clean.slice(i, i + 5);
    let data: { keywordList?: Record<string, unknown>[] };
    try {
      data = await call(batch);
    } catch {
      // 호출 제한(429) 등 일시적 오류는 잠깐 쉬고 한 번만 다시 시도
      await new Promise((r) => setTimeout(r, 800));
      try {
        data = await call(batch);
      } catch (e) {
        errors.push(e as Error);
        continue;
      }
    }
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
  if (!out.length && errors.length) throw errors[0];
  return out;
}

// 네이버 개발자센터 검색·데이터랩 API 는 NAVER API HUB(NCP)로 이전됨 (2026-06-25, 개발자센터 신규 발급은 2026-07-31 종료).
// 엔드포인트 https://openapi.naver.com/... → https://naverapihub.apigw.ntruss.com/..., 인증 헤더도 X-Naver-Client-Id/Secret → X-NCP-APIGW-API-KEY-ID/KEY 로 변경.
const API_HUB = "https://naverapihub.apigw.ntruss.com";

/** 네이버 블로그 검색 결과 총 문서 수 (경쟁 강도 지표) */
export async function naverBlogDocCount(q: string): Promise<number | null> {
  const cred = env.naverOpenApi;
  if (!cred) return null;
  const data = await fetchJson<{ total?: number }>(
    `${API_HUB}/search/v1/blog?query=${encodeURIComponent(q)}&display=1`,
    { headers: { "X-NCP-APIGW-API-KEY-ID": cred.id, "X-NCP-APIGW-API-KEY": cred.secret } },
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
    // 한 묶음이 실패해도 나머지 키워드의 트렌드는 계속 조회
    const data = await fetchJson<{ results?: { title: string; data: { ratio: number }[] }[] }>(
      `${API_HUB}/search-trend/v1/search`,
      {
        method: "POST",
        headers: { "X-NCP-APIGW-API-KEY-ID": cred.id, "X-NCP-APIGW-API-KEY": cred.secret, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ).catch(() => ({ results: [] }));
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
