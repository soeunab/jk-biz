import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import type { ChannelConfig } from "../config";
import type { ChannelId, ChannelResult } from "../types";

/** 원본과 같은 데스크탑 UA (일부 사이트가 헤드리스 기본 UA 를 다르게 취급) */
export const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type CollectContext = {
  browser: Browser;
  cfg: ChannelConfig;
  /** 디버그 HTML·스크린샷 저장 폴더 (기본 storage/channels/debug/<날짜>) */
  debugDir?: string;
  /** true 면 성공한 화면도 저장 (선택자 점검용) */
  saveAll?: boolean;
  log?: (m: string) => unknown;
  now?: Date;
};

export function defaultDebugDir(now = new Date()) {
  const d = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(now);
  return path.join(process.cwd(), "storage", "channels", "debug", d);
}

/** 채널 하나를 위한 브라우저 컨텍스트 (mobile=true 면 아이폰 화면) */
export async function openPage(ctx: CollectContext, mobile = false): Promise<{ page: Page; context: BrowserContext }> {
  const { devices } = await import("playwright");
  const base = { locale: "ko-KR", timezoneId: "Asia/Seoul" };
  const context = await ctx.browser.newContext(
    mobile ? { ...devices["iPhone 13"], ...base } : { ...base, userAgent: DESKTOP_UA, viewport: { width: 1366, height: 900 } },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { page, context };
}

/** 이동 후 네트워크가 잠잠해질 때까지(최대 8초) + 추가 대기 — 원본 BrowserSession.goto 와 동일 */
export async function goto(page: Page, url: string, settleMs = 2500) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(settleMs);
}

export async function scroll(page: Page, times = 8, step = 1400, waitMs = 700) {
  for (let i = 0; i < times; i++) {
    await page.evaluate((s) => window.scrollBy(0, s), step);
    await page.waitForTimeout(waitMs);
  }
}

/** 원본 JS 는 "() => …" 형태의 함수 문자열 — 명시적으로 호출해 결과를 받습니다 */
export async function run<T>(page: Page, script: string): Promise<T> {
  return (await page.evaluate(`(${script})()`)) as T;
}

/** 실패했거나 saveAll 일 때 HTML·스크린샷 저장 (선택자 점검용) */
export async function dump(ctx: CollectContext, page: Page, name: string, force = false): Promise<string | null> {
  if (!force && !ctx.saveAll) return null;
  try {
    const dir = ctx.debugDir ?? defaultDebugDir(ctx.now);
    await mkdir(dir, { recursive: true });
    const safe = name.replace(/[^0-9A-Za-z가-힣_-]+/g, "_");
    const html = path.join(dir, `${safe}.html`);
    await writeFile(html, await page.content(), "utf8");
    await page.screenshot({ path: path.join(dir, `${safe}.png`) }).catch(() => undefined);
    return html;
  } catch {
    return null;
  }
}

export function emptyResult(channel: ChannelId, label: string): ChannelResult {
  return { channel, label, ok: false, items: [], error: "", seconds: 0, notes: [] };
}

export const firstLine = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0];
