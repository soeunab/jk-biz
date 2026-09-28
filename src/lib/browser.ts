import type { Browser, BrowserContext, Page } from "playwright";

let browserPromise: Promise<Browser> | null = null;

/** CHROMIUM_EXECUTABLE_PATH 가 있으면 설치된 크롬/크로미움을 사용 (playwright install 대신) */
export function launchOptions<T extends { headless?: boolean }>(opts: T): T & { executablePath?: string } {
  const exe = process.env.CHROMIUM_EXECUTABLE_PATH?.trim();
  return exe ? { ...opts, executablePath: exe } : opts;
}

/** 워커 프로세스에서 공유하는 헤드리스 크롬 */
export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = import("playwright").then(({ chromium }) => chromium.launch(launchOptions({ headless: true })));
    browserPromise.catch(() => (browserPromise = null));
  }
  return browserPromise;
}

export async function withPage<T>(
  fn: (page: Page, ctx: BrowserContext) => Promise<T>,
  opts: { width?: number; height?: number; scale?: number } = {},
): Promise<T> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 1280, height: opts.height ?? 800 },
    deviceScaleFactor: opts.scale ?? 1,
    locale: "ko-KR",
  });
  const page = await ctx.newPage();
  try {
    return await fn(page, ctx);
  } finally {
    await ctx.close();
  }
}

export const FONT_STACK = `'Pretendard','Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic','WenQuanYi Zen Hei','Noto Sans CJK KR',sans-serif`;
export const FONT_LINK = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap">`;

/** HTML 문자열을 PNG 로 렌더링 (썸네일·카드뉴스) */
export async function renderHtmlToPng(html: string, width: number, height: number): Promise<Buffer> {
  return withPage(
    async (page) => {
      await page.setContent(html, { waitUntil: "load", timeout: 15_000 }).catch(() => undefined);
      // 웹폰트 로딩을 최대 3초 기다리고, 실패하면 시스템 폰트로 진행
      await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))])).catch(() => undefined);
      return page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } });
    },
    { width, height },
  );
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    await b?.close();
  }
}
