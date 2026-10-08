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

/** 검색광고 키워드도구 응답 한 줄 → AdKeyword */
function adKeywordOf(k: Record<string, unknown>): AdKeyword {
  return {
    keyword: String(k.relKeyword),
    monthlyPc: toNum(k.monthlyPcQcCnt),
    monthlyMobile: toNum(k.monthlyMobileQcCnt),
    monthlyClicks: toNum(k.monthlyAvePcClkCnt) + toNum(k.monthlyAveMobileClkCnt),
    compIdx: String(k.compIdx ?? ""),
    adDepth: toNum(k.plAvgDepth),
  };
}

/** 검색광고 API 서명 GET (/keywordstool) */
async function searchAdGet(query: string) {
  const cred = env.naverSearchAd;
  if (!cred) throw new Error("네이버 검색광고 API 키가 없어요 (NAVER_AD_API_KEY 등)");
  const path = "/keywordstool";
  const ts = Date.now().toString();
  const signature = createHmac("sha256", cred.secret).update(`${ts}.GET.${path}`).digest("base64");
  return fetchJson<{ keywordList?: Record<string, unknown>[] }>(`https://api.searchad.naver.com${path}?${query}`, {
    headers: { "X-Timestamp": ts, "X-API-KEY": cred.key, "X-Customer": cred.customer, "X-Signature": signature },
  });
}

/**
 * 업종별 키워드 — 시드 없이 검색광고 업종 번호(biztpId)만으로 키워드 최대 1,200개 (황금키워드 발굴용).
 * 2026-10-07 실측: 1~300번대에 값이 있고 500 이상은 빈 결과. 빈 결과는 빈 배열.
 */
export async function naverSearchAdByIndustry(biztpId: number): Promise<AdKeyword[]> {
  const data = await searchAdGet(`biztpId=${biztpId}&showDetail=1`);
  return (data.keywordList ?? []).map(adKeywordOf);
}

/**
 * 최근 N일 안에 발행된 블로그 글 수 — 블로그 검색을 최신순 100개로 받아 날짜로 셈 (대행사가 보는 '월간 발행량').
 * 100개가 모두 기간 안이면 100 이상이라는 뜻이라 100 으로 돌려줌(화면에서 "100+").
 */
export async function naverRecentPostCount(q: string, days = 30): Promise<number | null> {
  const cred = env.naverOpenApi;
  if (!cred) return null;
  const data = await fetchJson<{ items?: { postdate?: string }[] }>(
    `${API_HUB}/search/v1/blog?query=${encodeURIComponent(q)}&display=100&sort=date`,
    { headers: { "X-NCP-APIGW-API-KEY-ID": cred.id, "X-NCP-APIGW-API-KEY": cred.secret } },
  );
  return countSince(data.items ?? [], days);
}

/** postdate(YYYYMMDD) 가 오늘부터 days 일 안인 글 수 */
export function countSince(items: { postdate?: string }[], days: number, now = new Date()): number {
  const cut = ymd(new Date(now.getTime() - days * 86_400_000)).replace(/-/g, "");
  return items.filter((i) => (i.postdate ?? "") >= cut).length;
}

/** 네이버가 블로그 섹션 검색 요청을 막은 것으로 보일 때 (403·429·HTML 응답 등) — 이번 실행의 화면 조회를 멈춤 */
export class SectionBlockedError extends Error {}

/** 블로그 섹션 검색 화면이 알려 주는 문서 수의 상한 — 이 값이면 실제는 그 이상 */
export const SECTION_COUNT_CAP = 1000;

/**
 * 네이버 블로그 섹션 검색(section.blog.naver.com) 화면의 검색 결과 수 — 공식 API 한도(월 24,950회)를 쓰지 않음.
 * 2026-10-07 실측: 공식 API 와 거의 같은 값(퀸스넥 591 vs 599, 기간 지정 34 = 34)이지만 1,000 이 상한.
 * 비공식 화면 데이터라 호출하는 쪽에서 천천히(초당 2회 이하) 부르고, 막히면 SectionBlockedError 로 멈춥니다.
 * days 를 주면 최근 days 일 안에 발행된 글 수.
 */
export async function naverSectionBlogCount(q: string, days?: number): Promise<number> {
  const range = days ? `startDate=${ymd(daysAgo(days))}&endDate=${ymd(new Date())}` : "startDate=&endDate=";
  const url = `https://section.blog.naver.com/ajax/SearchList.naver?countPerPage=7&currentPage=1&${range}&keyword=${encodeURIComponent(q)}&orderBy=sim&type=post`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://section.blog.naver.com/" }, signal: AbortSignal.timeout(10_000) });
  if (res.status === 403 || res.status === 429) throw new SectionBlockedError(`블로그 섹션 검색 ${res.status}`);
  const text = await res.text();
  const json = text.replace(/^\)\]\}',?\s*/, "");
  let data: { result?: { totalCount?: number } };
  try {
    data = JSON.parse(json);
  } catch {
    throw new SectionBlockedError("블로그 섹션 검색이 데이터 대신 다른 화면을 돌려줌");
  }
  const n = data.result?.totalCount;
  if (typeof n !== "number") throw new SectionBlockedError("블로그 섹션 검색 응답에 결과 수가 없음");
  return n;
}

/** 데이터랩 최근 30일 일간 추이(상대값 0~100) — 황금키워드 상세 패널용, 키워드 1개 */
export async function naverDailyTrend(keyword: string, days = 30): Promise<{ date: string; ratio: number }[]> {
  const cred = env.naverOpenApi;
  if (!cred) return [];
  const data = await fetchJson<{ results?: { data: { period: string; ratio: number }[] }[] }>(`${API_HUB}/search-trend/v1/search`, {
    method: "POST",
    headers: { "X-NCP-APIGW-API-KEY-ID": cred.id, "X-NCP-APIGW-API-KEY": cred.secret, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: ymd(daysAgo(days)), endDate: ymd(daysAgo(1)), timeUnit: "date", keywordGroups: [{ groupName: keyword, keywords: [keyword] }] }),
  });
  // 데이터랩은 값이 0인 날을 빼고 주므로 날짜를 채움
  const got = new Map((data.results?.[0]?.data ?? []).map((d) => [d.period, d.ratio]));
  const out: { date: string; ratio: number }[] = [];
  for (let i = days; i >= 1; i--) {
    const d = ymd(daysAgo(i));
    out.push({ date: d, ratio: got.get(d) ?? 0 });
  }
  return out;
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
  const profile = await naverTrendProfile(keywords);
  return Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, v.momentum]));
}

/** 상시형(꾸준한 수요) / 변동형(계절·시기에 따라 오르내림) / 이슈형(한때 튄 뒤 식음) */
export type Seasonality = "evergreen" | "seasonal" | "spike";

/**
 * 1년치 주간 검색 추이로 수요 성격을 나눕니다 (플레이북의 '이슈성' 필터 — 상시형과 이슈형을 섞어 포트폴리오 구성).
 * - 이슈형: 가장 높은 4주가 1년 합계의 40% 이상 (한때 몰렸다가 식은 수요)
 * - 변동형: 변동계수(표준편차÷평균) 0.5 이상
 * - 상시형: 그 외
 * 데이터가 거의 없으면(평균 0) null.
 */
export function classifySeasonality(weekly: number[]): Seasonality | null {
  if (weekly.length < 12) return null;
  const sum = weekly.reduce((a, b) => a + b, 0);
  const mean = sum / weekly.length;
  if (!mean) return null;
  const top4 = [...weekly].sort((a, b) => b - a).slice(0, 4).reduce((a, b) => a + b, 0);
  if (top4 / sum >= 0.4) return "spike";
  const sd = Math.sqrt(weekly.reduce((a, b) => a + (b - mean) ** 2, 0) / weekly.length);
  return sd / mean >= 0.5 ? "seasonal" : "evergreen";
}

/** 데이터랩 1년치 주간 추이 → 모멘텀(최근 4주 ÷ 그 전 8주) + 수요 성격 — 같은 API 호출 1번으로 둘 다 */
export async function naverTrendProfile(keywords: string[]): Promise<Record<string, { momentum: number; seasonality: Seasonality | null }>> {
  const cred = env.naverOpenApi;
  const result: Record<string, { momentum: number; seasonality: Seasonality | null }> = {};
  if (!cred) return result;
  for (let i = 0; i < keywords.length; i += 5) {
    const batch = keywords.slice(i, i + 5);
    const body = {
      startDate: ymd(daysAgo(7 * 52)),
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
      const before = avg(ratios.slice(-12, -4));
      result[r.title] = { momentum: before > 0 ? recent / before : recent > 0 ? 2 : 1, seasonality: classifySeasonality(ratios) };
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
