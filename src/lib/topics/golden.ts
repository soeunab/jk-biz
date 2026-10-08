import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { generateJson, routeFor } from "../llm";
import { clamp } from "../util";
import { enqueue, type JobContext } from "../jobs/queue";
import { normalizeKeyword, scoreKeyword } from "./scoring";
import {
  naverAutocomplete,
  naverBlogDocCount,
  naverDailyTrend,
  naverSectionBlogCount,
  naverSearchAdByIndustry,
  naverSearchAdKeywords,
  naverTrendProfile,
  SECTION_COUNT_CAP,
  SectionBlockedError,
  type AdKeyword,
} from "./sources";

/*
 * 황금키워드 발굴 — 키워드마스터처럼 시드 없이 넓게 모아 검색량 구간별로 "검색량 대비 문서가 적은" 키워드를 보여 줍니다.
 *  1) 검색광고 업종 번호(biztpId)별 키워드(업종당 최대 1,200개)를 모두 모음 — 시드 없음
 *  2) 블로그 문서수를 예산 안에서 조회(안 잰 것 → 오래된 것 순, 저장해 재사용 → 실행할수록 범위가 넓어짐)
 *  3) 구간별 비율(문서수÷검색량) 낮은 순 → 표시 후보에 최근 30일 발행 수·수요 성격·AI 블로그 적합 판정
 *  4) 상위 키워드를 자동완성으로 넓혀 상품명 같은 키워드도 잡음
 * 비율은 후보를 찾는 기준일 뿐 상위 노출을 보장하지 않습니다(화면에도 표시).
 */

export const TIERS = [
  { id: "beginner", name: "초보자", emoji: "🌱", min: 100, max: 500, band: "월 100~500회", desc: "블로그 지수가 낮아도 노출을 노려 볼 수 있는 구간" },
  { id: "intermediate", name: "중급자", emoji: "💧", min: 500, max: 2_000, band: "월 500~2천회", desc: "꾸준히 쓰는 블로그가 유입을 키우는 구간" },
  { id: "advanced", name: "고급자", emoji: "🔥", min: 2_000, max: 10_000, band: "월 2천~1만회", desc: "상위 노출되면 하루 유입이 눈에 띄게 느는 구간" },
  { id: "expert", name: "전문가", emoji: "⚡", min: 10_000, max: 50_000, band: "월 1만~5만회", desc: "주제 전문성과 블로그 지수가 필요한 구간" },
  { id: "master", name: "마스터", emoji: "💎", min: 50_000, max: 100_000, band: "월 5만~10만회", desc: "경쟁이 큰 대형 키워드 — 롱테일로 우회 권장" },
  { id: "challenger", name: "챌린저", emoji: "🏆", min: 100_000, max: 500_000, band: "월 10만~50만회", desc: "1페이지 노출이 매우 어려운 구간 — 롱테일 발굴의 출발점" },
  { id: "legend", name: "레전드", emoji: "👑", min: 500_000, max: Infinity, band: "월 50만회 이상", desc: "초대형 키워드 — 직접 노출보다 롱테일 확장용" },
] as const;
export type TierId = (typeof TIERS)[number]["id"];
export const TIER_IDS = TIERS.map((t) => t.id) as TierId[];

/** 월검색량 → 구간 (100 미만은 대상 아님) */
export function tierOf(volume: number): TierId | null {
  return TIERS.find((t) => volume >= t.min && volume < t.max)?.id ?? null;
}

export const GOLDEN_MIN_VOLUME = TIERS[0].min;
/** 구간별로 보여 줄 후보 수 — AI 가 빼는 키워드를 감안해 200개 이상 남도록 */
export const DISPLAY_CANDIDATES = 250;
const DOCS_STALE_DAYS = 14;
/** 업종 키워드 목록은 자주 바뀌지 않아 3일에 한 번만 새로 모음 */
const COLLECT_EVERY_DAYS = 3;
/** 블로그 섹션 검색 화면 조회 간격 (초당 2회) — 비공식 화면이라 천천히 */
const SECTION_INTERVAL_MS = 500;
const RECENT_STALE_DAYS = 7;
const SEASON_STALE_DAYS = 30;
const TREND_STALE_HOURS = 24;
const DAY = 86_400_000;

/**
 * 블로그 문서수 조회 예산을 구간별로 나눔 — 기본은 똑같이 나누고, 조회할 게 적은 구간(레전드 등)이 남긴 몫은
 * 아직 조회할 게 남은 구간에 차례로 넘깁니다.
 */
export function splitBudget(needs: Record<string, number>, budget: number): Record<string, number> {
  const ids = Object.keys(needs);
  const out: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  let left = budget;
  let open = ids.filter((id) => needs[id] > 0);
  while (left > 0 && open.length) {
    const share = Math.max(1, Math.floor(left / open.length));
    for (const id of open) {
      const give = Math.min(share, needs[id] - out[id], left);
      out[id] += give;
      left -= give;
      if (left <= 0) break;
    }
    open = open.filter((id) => out[id] < needs[id]);
  }
  return out;
}

/** 동시 실행 개수를 제한한 순차 처리 (네이버 API 초당 제한 보호) */
async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const x = items[i++];
        await fn(x).catch(() => undefined);
      }
    }),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** AI 가 블로그 부적합으로 판정하지 않은 것 (미판정 null 포함 — SQL 에서 NOT(false) 는 null 을 빼 버려서 명시) */
const NOT_UNFIT: Prisma.GoldenKeywordWhereInput = { OR: [{ blogFit: null }, { blogFit: true }] };

type PoolRow = { keyword: string; normalized: string; pc: number; mobile: number; compIdx: string; clicks: number; biztpIds: number[] };

/** 키워드 풀 저장 — 같은 정규화 키워드면 검색량·광고 지표만 새로 (문서수·판정 등 저장된 값은 유지) */
async function upsertPool(rows: PoolRow[], source: "industry" | "autocomplete") {
  const now = Date.now();
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const values = chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
    const params = chunk.flatMap((r) => {
      const volume = r.pc + r.mobile;
      return [randomUUID(), r.keyword, r.normalized, r.pc, r.mobile, volume, tierOf(volume), r.compIdx || null, r.clicks, source, JSON.stringify(r.biztpIds), now, now, now];
    });
    await db.$executeRawUnsafe(
      `INSERT INTO "GoldenKeyword" ("id","keyword","normalized","pc","mobile","volume","tier","compIdx","monthlyClicks","source","biztpIds","collectedAt","updatedAt","seenAt")
       VALUES ${values}
       ON CONFLICT("normalized") DO UPDATE SET "pc"=excluded."pc","mobile"=excluded."mobile","volume"=excluded."volume","tier"=excluded."tier",
         "compIdx"=excluded."compIdx","monthlyClicks"=excluded."monthlyClicks","updatedAt"=excluded."updatedAt","seenAt"=excluded."seenAt"`,
      ...params,
    );
  }
}

/** 주제·원고로 쓴 키워드 — 정리할 때 지우지 않음 */
async function usedNormalized(): Promise<Set<string>> {
  const [posts, topics] = await Promise.all([
    db.post.findMany({ select: { normalizedKeyword: true } }),
    db.topic.findMany({ select: { normalizedKeyword: true } }),
  ]);
  return new Set([...posts, ...topics].map((x) => x.normalizedKeyword).filter(Boolean));
}

/** 검색량이 구간 최소(월 100) 아래로 떨어진 키워드 삭제 — 주제·원고로 쓴 것은 남김 */
async function dropBelowMin(norms: Set<string>, log: (m: string) => unknown) {
  if (!norms.size) return 0;
  const used = await usedNormalized();
  const list = [...norms].filter((n) => !used.has(n));
  let deleted = 0;
  for (let i = 0; i < list.length; i += 500) {
    deleted += (await db.goldenKeyword.deleteMany({ where: { normalized: { in: list.slice(i, i + 500) } } })).count;
  }
  if (deleted) await log(`검색량이 월 ${GOLDEN_MIN_VOLUME}회 아래로 떨어진 키워드 ${deleted}개 정리`);
  return deleted;
}

/** 검색광고 키워드 → 풀 행 (월검색량 100 미만 제외) */
function poolRow(k: AdKeyword, biztpId?: number, display?: string): PoolRow | null {
  const volume = k.monthlyPc + k.monthlyMobile;
  if (volume < GOLDEN_MIN_VOLUME) return null;
  return { keyword: display ?? k.keyword, normalized: normalizeKeyword(k.keyword), pc: k.monthlyPc, mobile: k.monthlyMobile, compIdx: k.compIdx, clicks: k.monthlyClicks, biztpIds: biztpId ? [biztpId] : [] };
}

/** 1) 업종별 키워드 수집 — 빈 결과가 30번 이어지면 끝 */
async function collectIndustries(log: (m: string) => unknown, progress: (p: number, m: string) => unknown) {
  const rows = new Map<string, PoolRow>();
  const below = new Set<string>();
  let empty = 0;
  let calls = 0;
  for (let id = 1; id <= 600 && empty < 30; id++) {
    calls++;
    const list = await naverSearchAdByIndustry(id).catch(async () => {
      await sleep(1500); // 호출 제한이면 잠깐 쉬고 한 번 더
      return naverSearchAdByIndustry(id).catch(() => [] as AdKeyword[]);
    });
    empty = list.length ? 0 : empty + 1;
    for (const k of list) {
      const r = poolRow(k, id);
      if (!r) {
        below.add(normalizeKeyword(k.keyword));
        continue;
      }
      const cur = rows.get(r.normalized);
      if (cur) cur.biztpIds.push(id);
      else rows.set(r.normalized, r);
    }
    if (id % 25 === 0) await progress(Math.min(3, Math.round(id / 150)), `업종 ${id}번까지 수집 — 키워드 ${rows.size.toLocaleString("ko-KR")}개`);
    await sleep(350);
  }
  await upsertPool([...rows.values()], "industry");
  // 다른 업종에서는 100 이상으로 나온 키워드는 빼고, 100 미만으로만 나온 것만 정리
  for (const n of rows.keys()) below.delete(n);
  await dropBelowMin(below, log);
  await log(`업종 ${calls}번 조회 → 월 ${GOLDEN_MIN_VOLUME}회 이상 키워드 ${rows.size.toLocaleString("ko-KR")}개 저장`);
  return rows.size;
}

/**
 * 블로그 문서수 측정기 — 블로그 섹션 검색 화면 값(공식 API 한도 안 씀, 초당 2회)을 쓰고,
 * 화면 상한(1000)에 걸렸는데 검색량이 커서(1만 이상) 비율 판단이 필요한 키워드만 공식 API 로 확인(실행당 예산 안에서).
 * 화면 조회가 막히면 blocked 를 켜고 이번 실행의 화면 조회를 멈춤.
 */
export class DocMeter {
  sectionUsed = 0;
  apiUsed = 0;
  blocked = false;
  private fails = 0;
  constructor(
    readonly sectionBudget: number,
    readonly apiBudget: number,
    private readonly log: (m: string) => unknown,
    /** 측정 중 진행률 갱신 — 화면 조회 20번마다 (사용한 횟수를 넘김) */
    private readonly onTick?: (used: number) => unknown,
  ) {}
  get left() {
    return this.blocked ? 0 : Math.max(0, this.sectionBudget - this.sectionUsed);
  }
  /** 화면 조회 1번 (막히면 null) — 연속 3번 실패하면 막힌 것으로 봄 */
  async section(q: string, days?: number): Promise<number | null> {
    if (!this.left) return null;
    this.sectionUsed++;
    if (this.onTick && this.sectionUsed % 20 === 0) await this.onTick(this.sectionUsed);
    await sleep(SECTION_INTERVAL_MS);
    try {
      const n = await naverSectionBlogCount(q, days);
      this.fails = 0;
      return n;
    } catch (e) {
      this.fails++;
      if (e instanceof SectionBlockedError || this.fails >= 3) {
        this.blocked = true;
        await this.log(`⚠️ 네이버 블로그 섹션 검색 조회가 막힌 것 같아 이번 실행의 화면 조회를 멈춥니다 (${(e as Error).message}). 내일 다시 시도해요.`);
      }
      return null;
    }
  }
  /** 상한(1000)에 걸린 큰 키워드만 공식 API 로 정확한 문서수 */
  async exact(q: string): Promise<number | null> {
    if (this.apiUsed >= this.apiBudget) return null;
    this.apiUsed++;
    return naverBlogDocCount(q).catch(() => null);
  }
}

/** 2) 블로그 문서수 — 구간별로 나눈 예산 안에서 안 잰 것 → 14일 넘은 것 순 */
async function measureDocs(meter: DocMeter, budget: number, log: (m: string) => unknown) {
  const stale = new Date(Date.now() - DOCS_STALE_DAYS * DAY);
  const needWhere = (t: string): Prisma.GoldenKeywordWhereInput => ({ tier: t, OR: [{ docsAt: null }, { docsAt: { lt: stale } }] });
  const needs: Record<string, number> = {};
  for (const t of TIER_IDS) needs[t] = await db.goldenKeyword.count({ where: needWhere(t) });
  const plan = splitBudget(needs, Math.min(budget, meter.left));
  let measured = 0;
  for (const t of TIER_IDS) {
    if (!plan[t] || meter.blocked) continue;
    const targets = await db.goldenKeyword.findMany({
      where: needWhere(t),
      orderBy: [{ docsAt: { sort: "asc", nulls: "first" } }, { updatedAt: "desc" }],
      take: plan[t],
      select: { id: true, keyword: true, volume: true },
    });
    for (const k of targets) {
      let docs = await meter.section(k.keyword);
      if (docs == null) {
        if (meter.blocked) break;
        continue;
      }
      let capped = docs >= SECTION_COUNT_CAP;
      // 상한에 걸려도 검색량이 작으면 비율이 이미 커서(≥ 1000/1만 = 0.1 이상) 순위에 영향 없음 — 큰 키워드만 정확히
      if (capped && k.volume >= 10_000) {
        const exact = await meter.exact(k.keyword);
        if (exact != null) {
          docs = exact;
          capped = false;
        }
      }
      measured++;
      await db.goldenKeyword.update({ where: { id: k.id }, data: { documentCount: docs, docsCapped: capped, ratio: docs / Math.max(1, k.volume), docsAt: new Date() } });
    }
  }
  await log(`블로그 문서수 ${measured.toLocaleString("ko-KR")}개 측정 (화면 조회 누적 ${meter.sectionUsed.toLocaleString("ko-KR")}회 · 공식 API ${meter.apiUsed}회) · 남은 미측정 ${TIER_IDS.map((t) => `${t} ${Math.max(0, needs[t] - plan[t])}`).join(", ")}`);
  return { measured, remaining: TIER_IDS.reduce((a, t) => a + Math.max(0, needs[t] - plan[t]), 0) };
}


/** 3) 구간별 표시 후보 — 비율 낮은 순, AI 가 블로그 부적합으로 본 것은 제외 */
async function candidates(tier: TierId, take = DISPLAY_CANDIDATES) {
  return db.goldenKeyword.findMany({
    where: { tier, ratio: { not: null }, ...NOT_UNFIT },
    orderBy: { ratio: "asc" },
    take,
  });
}

/** 4) 최근 30일 발행 수 — 화면 조회(기간 지정), 7일간 재사용 */
async function measureRecent(meter: DocMeter, log: (m: string) => unknown) {
  const stale = new Date(Date.now() - RECENT_STALE_DAYS * DAY);
  let n = 0;
  for (const t of TIER_IDS) {
    if (!meter.left) break;
    const list = (await candidates(t)).filter((k) => !k.recentAt || k.recentAt < stale);
    for (const k of list) {
      const c = await meter.section(k.keyword, 30);
      if (c == null) {
        if (!meter.left) break;
        continue;
      }
      n++;
      await db.goldenKeyword.update({ where: { id: k.id }, data: { recent30: c, recentAt: new Date() } });
    }
  }
  await log(`최근 30일 발행 수 ${n}개 측정`);
  return n;
}


/** 5) 수요 성격(이슈형 경고) — 구간별 상위 50개, 30일간 재사용 */
async function measureSeasonality(log: (m: string) => unknown) {
  const stale = new Date(Date.now() - SEASON_STALE_DAYS * DAY);
  const targets = (await Promise.all(TIER_IDS.map((t) => candidates(t, 50)))).flat().filter((k) => !k.seasonAt || k.seasonAt < stale);
  if (!targets.length) return;
  const profile = await naverTrendProfile(targets.map((k) => k.keyword)).catch(() => ({}) as Awaited<ReturnType<typeof naverTrendProfile>>);
  let n = 0;
  for (const k of targets) {
    const p = profile[k.keyword];
    if (!p) continue;
    n++;
    await db.goldenKeyword.update({ where: { id: k.id }, data: { seasonality: p.seasonality, seasonAt: new Date() } });
  }
  await log(`수요 성격(상시형·변동형·이슈형) ${n}개 확인`);
}

export const FitSchema = z.object({
  items: z.array(
    z.object({
      keyword: z.string(),
      fit: z.boolean().describe("블로그 글 한 편으로 검색한 사람에게 답할 수 있으면 true"),
      note: z.string().describe("fit=false 면 이유 한 마디(업체 영업·지역 업체 찾기·공식몰 접속 등), true 면 빈 문자열"),
      accounts: z.array(z.string()).describe("이 키워드로 글을 쓰기에 어울리는 블로그 이름(아래 목록에서만, 없으면 빈 배열)"),
    }),
  ),
});

/** 6) AI 블로그 적합 판정 + 어울리는 계정 — 판정 안 된 표시 후보만 200개씩, 결과는 저장해 다시 묻지 않음 */
async function judgeFit(log: (m: string) => unknown): Promise<number> {
  if ((await routeFor("light")) === "manual") {
    await log("수동 모드라 AI 블로그 적합 판정은 건너뜀 (미확인으로 표시)");
    return 0;
  }
  const accounts = await db.account.findMany({ where: { active: true, platform: { in: ["BLOGGER", "NAVER"] } }, select: { id: true, name: true, concept: true, platform: true } });
  const pending = (await Promise.all(TIER_IDS.map((t) => candidates(t)))).flat().filter((k) => !k.fitAt);
  let calls = 0;
  for (let i = 0; i < pending.length; i += 200) {
    const batch = pending.slice(i, i + 200);
    calls++;
    const res = await generateJson({
      name: "goldenFit",
      task: "light",
      title: `황금키워드 블로그 적합 판정 (${batch.length}개)`,
      system: "당신은 블로그 편집자입니다. 검색어마다 블로그 글로 답할 수 있는지, 어느 블로그에 어울리는지만 판단합니다.",
      prompt: `아래 검색어는 네이버 검색광고 업종 키워드와 자동완성에서 모은 것입니다. 각각에 대해:
- fit: 정보·후기·비교·방법·조건·가격 정리처럼 블로그 글 한 편으로 검색한 사람을 만족시킬 수 있으면 true.
  false 로: 특정 업체를 찾아 연락하려는 검색(지역+업체·시공·대행·출장·견적 문의), 공식 사이트·로그인·고객센터 접속, 성인·불법·도박, 의미 없는 문자열.
- accounts: 아래 블로그 중 이 검색어로 글을 쓰기에 주제가 맞는 블로그 이름만 (없으면 빈 배열)
${accounts.map((a) => `  · ${a.name} (${a.platform === "NAVER" ? "네이버" : "구글 블로거"}): ${a.concept || "콘셉트 미설정"}`).join("\n")}

검색어: ${batch.map((k) => k.keyword).join(" | ")}`,
      schema: FitSchema,
      effort: "low",
      maxTokens: 16000,
      mock: () => ({ items: batch.map((k) => ({ keyword: k.keyword, fit: true, note: "", accounts: [] })) }),
    }).catch(async (e) => {
      await log(`⚠️ AI 판정 실패(이번 묶음은 미확인으로 둠): ${(e as Error).message.split("\n")[0]}`);
      return null;
    });
    if (!res) continue;
    const byNorm = new Map(res.items.map((it) => [normalizeKeyword(it.keyword), it]));
    const now = new Date();
    for (const k of batch) {
      const it = byNorm.get(k.normalized);
      if (!it) continue; // 모델이 빠뜨린 키워드는 다음 실행에서 다시
      const ids = accounts.filter((a) => it.accounts.some((n) => n.trim() === a.name)).map((a) => a.id);
      await db.goldenKeyword.update({ where: { id: k.id }, data: { blogFit: it.fit, fitNote: it.note || null, fitAccounts: ids as unknown as Prisma.InputJsonValue, fitAt: now } });
    }
  }
  await log(`AI 블로그 적합 판정 ${pending.length}개 (Claude 가벼운 호출 ${calls}번)`);
  return calls;
}

/** 7) 자동완성 확장 — 구간별 상위 20개를 넓혀 상품명 같은 키워드까지 (새로 찾은 문구만 검색량 확인) */
async function expandAutocomplete(log: (m: string) => unknown) {
  const tops = (await Promise.all(TIER_IDS.map((t) => db.goldenKeyword.findMany({ where: { tier: t, ratio: { not: null }, ...NOT_UNFIT }, orderBy: { ratio: "asc" }, take: 20 })))).flat();
  const phrases = new Map<string, string>(); // 정규화 → 화면 표기
  for (const k of tops) {
    const ac = await naverAutocomplete(k.keyword).catch(() => [] as string[]);
    for (const p of ac) phrases.set(normalizeKeyword(p), p);
    await sleep(150);
  }
  const known = new Set((await db.goldenKeyword.findMany({ where: { normalized: { in: [...phrases.keys()] } }, select: { normalized: true } })).map((r) => r.normalized));
  // 이미 있는 키워드는 띄어쓰기 있는 표기로 이름만 바꿈 (예: 비판텐퀸스넥 → 비판텐 퀸스넥)
  for (const [norm, display] of phrases) {
    if (known.has(norm) && /\s/.test(display)) await db.goldenKeyword.updateMany({ where: { normalized: norm, NOT: { keyword: { contains: " " } } }, data: { keyword: display } });
  }
  const fresh = [...phrases].filter(([norm]) => !known.has(norm));
  const rows: PoolRow[] = [];
  const staleBelow = new Set<string>();
  for (let i = 0; i < fresh.length; i += 5) {
    const batch = fresh.slice(i, i + 5);
    const ad = await naverSearchAdKeywords(batch.map(([, d]) => d)).catch(() => [] as AdKeyword[]);
    const adByNorm = new Map(ad.map((k) => [normalizeKeyword(k.keyword), k]));
    for (const [norm, display] of batch) {
      const k = adByNorm.get(norm);
      const r = k && poolRow(k, undefined, display);
      if (r) rows.push(r);
    }
    // 이미 있던 키워드 중 이번에 100 미만으로 나온 것
    for (const k of ad) {
      const v = k.monthlyPc + k.monthlyMobile;
      if (v < GOLDEN_MIN_VOLUME && known.has(normalizeKeyword(k.keyword))) staleBelow.add(normalizeKeyword(k.keyword));
    }
    await sleep(300);
  }
  await upsertPool(rows, "autocomplete");
  await dropBelowMin(staleBelow, log);
  await log(`자동완성 확장: 상위 ${tops.length}개에서 새 표현 ${fresh.length}개 → 월 ${GOLDEN_MIN_VOLUME}회 이상 ${rows.length}개 추가`);
  return rows.length;
}

export type GoldenPayload = { step?: "collect" | "measure" | "finish"; spent?: number; apiSpent?: number; claudeCalls?: number; startedAt?: number; slice?: number };

/**
 * 황금키워드 발굴 — 작업 하나가 오래 붙잡지 않도록 조각(slice, 약 10분)으로 나눠 이어서 실행합니다.
 * 작업 큐는 한 번에 하나씩 처리하므로, 조각이 끝날 때마다 다음 조각을 새 작업으로 넣어 그 사이에 원고 생성 같은 다른 작업이 먼저 돌 수 있게 합니다.
 *  collect(업종 수집, 3일에 한 번) → measure(문서수·최근 발행·AI 판정, 조각 반복) → finish(자동완성 확장)
 * 문서수는 블로그 섹션 검색 화면 값(공식 API 한도 안 씀) — 실행 전체 예산 GOLDEN_SECTION_BUDGET(기본 1만 회, 초당 2회).
 */
export async function runGoldenDiscovery(payload: GoldenPayload = {}, ctx?: JobContext) {
  const log = (m: string) => ctx?.log(m);
  const progress = (p: number, m: string) => ctx?.progress(p, m);
  const total = Number(process.env.GOLDEN_SECTION_BUDGET) || 10_000;
  const apiTotal = Number(process.env.GOLDEN_API_BUDGET) || 100;
  const sliceSize = Number(process.env.GOLDEN_SLICE) || 1_200;
  const p: Required<GoldenPayload> = { step: payload.step ?? "collect", spent: payload.spent ?? 0, apiSpent: payload.apiSpent ?? 0, claudeCalls: payload.claudeCalls ?? 0, startedAt: payload.startedAt ?? Date.now(), slice: payload.slice ?? 0 };
  const next = (o: Partial<GoldenPayload>) => enqueue("topic.golden", { ...p, ...o });
  // 진행률은 실행 전체 기준: 수집 0~3% · 측정 3~97%(누적 화면 조회 수 ÷ 예산) · 확장 97~100%
  const overall = (spent: number) => Math.min(97, 3 + Math.round((spent / total) * 94));

  if (p.step === "collect") {
    await progress(0, "황금키워드 발굴 시작");
    const last = await db.goldenKeyword.findFirst({ where: { source: "industry" }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
    if (!last || Date.now() - last.updatedAt.getTime() > COLLECT_EVERY_DAYS * DAY) {
      await progress(1, "업종별 키워드 수집 중…");
      await collectIndustries(log, progress);
    } else {
      await log(`업종 키워드는 ${last.updatedAt.toLocaleDateString("ko-KR")}에 모아 둔 것을 씀 (${COLLECT_EVERY_DAYS}일마다 새로 수집)`);
    }
    await next({ step: "measure" });
    return { step: "collect", next: "measure" };
  }

  if (p.step === "measure") {
    const meter = new DocMeter(Math.min(sliceSize, total - p.spent), apiTotal - p.apiSpent, log, (used) => ctx?.progress(overall(p.spent + used)));
    await progress(overall(p.spent), `문서수 측정 (조각 ${p.slice + 1}) — 누적 ${p.spent.toLocaleString("ko-KR")}/${total.toLocaleString("ko-KR")}회`);
    const docs = await measureDocs(meter, meter.left, log);
    if (meter.left) {
      await progress(overall(p.spent + meter.sectionUsed), "최근 30일 발행 수 측정 중…");
      await measureRecent(meter, log);
    }
    if (p.slice === 0) {
      await progress(overall(p.spent + meter.sectionUsed), "수요 성격 확인 중…");
      await measureSeasonality(log);
    }
    await progress(overall(p.spent + meter.sectionUsed), "AI 블로그 적합 판정 중…");
    const calls = await judgeFit(log);
    const spent = p.spent + meter.sectionUsed;
    const apiSpent = p.apiSpent + meter.apiUsed;
    const more = !meter.blocked && spent < total && docs.remaining > 0;
    await next({ step: more ? "measure" : "finish", spent, apiSpent, claudeCalls: p.claudeCalls + calls, slice: p.slice + 1 });
    await progress(overall(spent), more ? `조각 ${p.slice + 1} 완료 — 다음 조각을 이어서 실행해요` : "측정 완료 — 자동완성 확장으로 이어서 실행해요");
    return { step: "measure", slice: p.slice + 1, spent, apiSpent, blocked: meter.blocked, remaining: docs.remaining };
  }

  // finish — 자동완성 확장 후 새 키워드만 측정·판정
  await progress(97, "자동완성으로 확장 중…");
  const added = await expandAutocomplete(log);
  const meter = new DocMeter(Math.max(0, Math.min(800, total - p.spent)), apiTotal - p.apiSpent, log);
  let calls = p.claudeCalls;
  if (added && meter.left) {
    await measureDocs(meter, meter.left, log);
    if (meter.left) await measureRecent(meter, log);
    calls += await judgeFit(log);
  }
  const counts = await tierCounts();
  const result = {
    added,
    sectionCalls: p.spent + meter.sectionUsed,
    officialApiCalls: p.apiSpent + meter.apiUsed,
    claudeCalls: calls,
    counts,
    minutes: Math.round((Date.now() - p.startedAt) / 60000),
  };
  await log(`화면 조회 ${result.sectionCalls.toLocaleString("ko-KR")}회 · 공식 API ${result.officialApiCalls}회 · Claude 가벼운 호출 ${calls}번 · 약 ${result.minutes}분`);
  await progress(100, `황금키워드 발굴 완료 — ${TIERS.map((t) => `${t.name} ${counts[t.id] ?? 0}`).join(" · ")}`);
  return result;
}

// ---------------------------------------------------------------- 조회 (화면)

export async function tierCounts(): Promise<Record<string, number>> {
  const rows = await db.goldenKeyword.groupBy({ by: ["tier"], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.tier, r._count._all]));
}

export const PERIODS = [4, 7, 14, 30] as const;

export type GoldenRow = {
  id: string;
  keyword: string;
  volume: number;
  pc: number;
  mobile: number;
  documentCount: number | null;
  /** 문서수가 화면 상한(1000) 이상 — 비율은 하한값 */
  docsCapped: boolean;
  ratio: number | null;
  recent30: number | null;
  compIdx: string | null;
  seasonality: string | null;
  blogFit: boolean | null;
  fitNote: string | null;
  accounts: string[];
  used: boolean;
};

/** 구간 상세 목록 — 기간(갱신일)·계정·부적합 표시 거르기. 비율 낮은 순 measuredTake 개 + 미측정 일부 */
export async function goldenList(opts: { tier: TierId; period?: number; account?: string; showUnfit?: boolean; measuredTake?: number; unmeasuredTake?: number }) {
  const since = new Date(Date.now() - (opts.period ?? 30) * DAY);
  const base: Prisma.GoldenKeywordWhereInput = {
    tier: opts.tier,
    updatedAt: { gte: since },
    ...(opts.showUnfit ? {} : NOT_UNFIT),
  };
  const total = await db.goldenKeyword.count({ where: { tier: opts.tier, updatedAt: { gte: since } } });
  const [measured, unmeasured] = await Promise.all([
    db.goldenKeyword.findMany({ where: { ...base, ratio: { not: null } }, orderBy: { ratio: "asc" }, take: opts.account ? 2000 : (opts.measuredTake ?? 300) }),
    db.goldenKeyword.findMany({ where: { ...base, ratio: null }, orderBy: { volume: "desc" }, take: opts.unmeasuredTake ?? 100 }),
  ]);
  let rows = [...measured, ...unmeasured];
  if (opts.account) rows = rows.filter((r) => Array.isArray(r.fitAccounts) && (r.fitAccounts as string[]).includes(opts.account!)).slice(0, opts.measuredTake ?? 300);
  const norms = rows.map((r) => r.normalized);
  const [posts, topics] = await Promise.all([
    db.post.findMany({ where: { normalizedKeyword: { in: norms } }, select: { normalizedKeyword: true } }),
    db.topic.findMany({ where: { normalizedKeyword: { in: norms } }, select: { normalizedKeyword: true } }),
  ]);
  const used = new Set([...posts.map((p) => p.normalizedKeyword), ...topics.map((t) => t.normalizedKeyword)]);
  const last = await db.job.findFirst({ where: { type: "topic.golden", status: "DONE" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } });
  return {
    total,
    lastRunAt: last?.finishedAt ?? null,
    rows: rows.map(
      (r): GoldenRow => ({
        id: r.id,
        keyword: r.keyword,
        volume: r.volume,
        pc: r.pc,
        mobile: r.mobile,
        documentCount: r.documentCount,
        docsCapped: !!r.docsCapped,
        ratio: r.ratio,
        recent30: r.recent30,
        compIdx: r.compIdx,
        seasonality: r.seasonality,
        blogFit: r.blogFit,
        fitNote: r.fitNote,
        accounts: Array.isArray(r.fitAccounts) ? (r.fitAccounts as string[]) : [],
        used: used.has(r.normalized),
      }),
    ),
  };
}

// ---------------------------------------------------------------- 골든 점수·진단 (규칙 — Claude 토큰 안 씀)

export type GoldenInsight = { score: number; label: string; advice: string; flags: { icon: string; title: string; body: string }[]; tags: string[] };

/** 최근 7일 평균 ÷ 그 전 평균 (데이터랩 일간 상대값) — 1 보다 크면 상승 */
export function trendMomentum(trend: { ratio: number }[] | null | undefined): number | null {
  if (!trend || trend.length < 14) return null;
  const avg = (xs: { ratio: number }[]) => xs.reduce((a, x) => a + x.ratio, 0) / Math.max(1, xs.length);
  const recent = avg(trend.slice(-7));
  const before = avg(trend.slice(0, -7));
  if (!before && !recent) return null;
  return before ? recent / before : 2;
}

export function goldenInsight(k: { volume: number; mobile: number; ratio: number | null; recent30: number | null; seasonality: string | null }, trend?: { ratio: number }[] | null): GoldenInsight {
  // 비율: 0.01 이하 100점 … 1 → 약 30점 … 10 이상 → 0점
  const ratioScore = k.ratio == null ? 40 : clamp(100 - Math.log10(k.ratio / 0.01 + 1) * 35, 0, 100);
  // 최근 30일 발행: 적을수록 좋음 (100개 이상이면 20점)
  const recentScore = k.recent30 == null ? 60 : clamp(100 - k.recent30 * 0.8, 20, 100);
  const m = trendMomentum(trend);
  const trendScore = m == null ? 60 : clamp(50 + (m - 1) * 60, 10, 100);
  let score = ratioScore * 0.55 + recentScore * 0.25 + trendScore * 0.2;
  if (k.seasonality === "spike") score -= 15;
  score = Math.round(clamp(score, 0, 100));

  const flags: GoldenInsight["flags"] = [];
  const tags: string[] = [];
  if (m != null && m <= 0.6) flags.push({ icon: "📉", title: "유행 종료", body: "최근 7일 관심도가 그 전보다 크게 줄었어요. 지금 쓰면 유입이 빨리 식을 수 있어요." });
  if (m != null && m >= 1.3) {
    flags.push({ icon: "📈", title: "관심 상승", body: "최근 7일 검색이 늘고 있어요. 빨리 쓸수록 유리해요." });
    tags.push("성장형");
  }
  if (k.volume && k.mobile / k.volume >= 0.8) flags.push({ icon: "📱", title: "모바일 타겟", body: "검색의 80% 이상이 모바일이에요. 결론부터 보여 주고, 이미지를 많이·줄글은 짧게 쓰세요." });
  if (k.recent30 != null && k.recent30 >= 50) {
    flags.push({ icon: "⚠️", title: "경쟁 증가", body: `최근 30일에 블로그 글이 ${k.recent30 >= 100 ? "100개 이상" : `${k.recent30}개`} 올라왔어요. 누적 문서가 적어도 최근 경쟁은 커요.` });
    tags.push("경쟁주의");
  }
  if (k.seasonality === "spike") flags.push({ icon: "⚡", title: "이슈형", body: "1년 중 짧은 기간에 검색이 몰린 키워드예요. 문서가 적은 건 이슈가 지나서일 수 있어요." });
  if (k.seasonality === "evergreen") tags.push("꾸준형");
  if (k.ratio != null && k.ratio < 0.5) tags.push("도전가능");

  const [label, advice] =
    score >= 80
      ? ["🏆 황금 기회", "검색 수요에 비해 글이 아주 적어요. 질문에 바로 답하는 구성으로 빠르게 써 보세요."]
      : score >= 65
        ? ["🌱 블로그 성장 영양분", "약간의 경쟁이 있지만, 제목과 본문 구성을 신경 쓰면 충분히 해볼 만해요."]
        : score >= 45
          ? ["🙂 도전해 볼 만함", "경쟁이 있는 편이에요. 롱테일 표현으로 좁혀서 쓰면 노출 가능성이 올라가요."]
          : ["⚠️ 경쟁 주의", "글이 이미 많거나 최근 경쟁이 커요. 이 키워드로 롱테일을 찾아 우회하세요."];
  return { score, label, advice, flags, tags };
}

/** 상세 패널용 30일 일간 추이 — 하루 동안 저장해 재사용 (패널을 열 때만 조회) */
export async function goldenTrend(id: string) {
  const k = await db.goldenKeyword.findUniqueOrThrow({ where: { id } });
  const fresh = k.trendAt && Date.now() - k.trendAt.getTime() < TREND_STALE_HOURS * 3_600_000;
  let trend = (k.trend as { date: string; ratio: number }[] | null) ?? null;
  if (!fresh) {
    trend = await naverDailyTrend(k.keyword).catch(() => trend);
    if (trend?.length) await db.goldenKeyword.update({ where: { id }, data: { trend: trend as unknown as Prisma.InputJsonValue, trendAt: new Date() } });
  }
  return { trend: trend ?? [], insight: goldenInsight(k, trend) };
}

/** [주제로 저장] — 주제 목록(origin golden)에 넣어 기존 제목 6가지·원고 생성 흐름을 그대로 씀 */
export async function saveGoldenAsTopic(id: string) {
  const k = await db.goldenKeyword.findUniqueOrThrow({ where: { id } });
  const exists = await db.topic.findFirst({ where: { normalizedKeyword: k.normalized } });
  if (exists) return { topicId: exists.id, existed: true };
  const metrics = { keyword: k.keyword, monthlySearch: k.volume, documentCount: k.documentCount, compIdx: k.compIdx, monthlyClicks: k.monthlyClicks, sources: ["golden"] };
  const s = scoreKeyword(metrics, []);
  const tier = TIERS.find((t) => t.id === k.tier);
  const topic = await db.topic.create({
    data: {
      keyword: k.keyword,
      title: k.keyword,
      angle: "",
      persona: "GENERAL",
      tool: "",
      origin: "golden",
      targetPlatform: s.targetPlatform,
      intent: s.intent,
      normalizedKeyword: k.normalized,
      searchVolume: k.volume,
      documentCount: k.documentCount,
      trendScore: s.trendScore,
      competitionScore: s.competitionScore,
      monetizationScore: s.monetizationScore,
      totalScore: s.total,
      confidence: s.confidence,
      verification: "VERIFIED",
      rationale: `🏆 황금키워드 ${tier ? `${tier.emoji} ${tier.name}(${tier.band})` : ""} · 월 검색 ${k.volume.toLocaleString("ko-KR")}회 · 블로그 문서 ${k.documentCount?.toLocaleString("ko-KR") ?? "미확인"}건 · 비율 ${k.ratio?.toFixed(4) ?? "미확인"}${k.recent30 != null ? ` · 최근 30일 발행 ${k.recent30 >= 100 ? "100+" : k.recent30}` : ""}`,
      signals: { ...s, mainKeyword: k.keyword, isMain: true, ratio: k.ratio, golden: { tier: k.tier, recent30: k.recent30, seasonality: k.seasonality } } as unknown as Prisma.InputJsonValue,
    },
  });
  return { topicId: topic.id, existed: false };
}
