import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Frame, Page } from "playwright";
import { db } from "../db";
import { env } from "../env";
import { launchOptions } from "../browser";
import { accountSettings, rerenderPost } from "../content/service";
import { renderNaverSegments } from "../content/render";
import type { PublishResult } from "./types";

/**
 * 네이버 블로그는 글쓰기 공개 API 가 없어(2020년 종료) 브라우저 자동화(Playwright)로 스마트에디터 ONE 을 조작합니다.
 * - 로그인: `npm run naver:login -- <계정ID>` 로 한 번 직접 로그인 → 세션(쿠키)을 storage/naver/<계정ID>.json 에 저장
 * - 아이디/비밀번호 자동 입력은 하지 않습니다(캡차·보안 정책 위반 위험).
 * - 네이버 에디터 화면이 바뀌면 아래 SELECTORS 만 수정하면 됩니다.
 */
export const SELECTORS = {
  helpClose: [".se-help-panel-close-button", "button.se-help-close"],
  draftPopupCancel: [".se-popup-button-cancel"],
  title: [".se-documentTitle .se-text-paragraph", ".se-title-text .se-text-paragraph"],
  body: [".se-component.se-text .se-text-paragraph", ".se-section-text .se-text-paragraph"],
  imageButton: ["button.se-image-toolbar-button", "button[data-name='image']"],
  uploadedImage: [".se-component.se-image"],
  publishOpen: ["button[class*='publish_btn']", "button:has-text('발행')"],
  tagInput: ["input[class*='tag_input']", "#tag-input"],
  privateRadio: ["label[for='open_private']", "input#open_private"],
  publicRadio: ["label[for='open_public']", "input#open_public"],
  publishConfirm: ["button[class*='confirm_btn']", "button[data-testid='seOnePublishBtn']"],
  saveDraft: ["button[class*='save_btn']", "button:has-text('저장')"],
};

const STORAGE_DIR = path.join(process.cwd(), "storage", "naver");
export const naverStatePath = (accountId: string) => path.join(STORAGE_DIR, `${accountId}.json`);
export const hasNaverSession = (accountId: string) => existsSync(naverStatePath(accountId));

async function first(frame: Frame | Page, selectors: string[], timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const loc = frame.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) return loc;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`네이버 에디터 요소를 찾지 못했습니다: ${selectors.join(" | ")}`);
}

async function tryClick(frame: Frame | Page, selectors: string[], timeout = 1500) {
  try {
    await (await first(frame, selectors, timeout)).click();
    return true;
  } catch {
    return false;
  }
}

/** 스마트에디터에 HTML 을 붙여넣기 이벤트로 주입 (에디터가 자체 컴포넌트로 변환) */
async function pasteHtml(frame: Frame, html: string) {
  await frame.evaluate((h) => {
    const target = (document.activeElement as HTMLElement) ?? document.body;
    const dt = new DataTransfer();
    dt.setData("text/html", h);
    dt.setData("text/plain", h.replace(/<[^>]+>/g, ""));
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, html);
  await frame.page().waitForTimeout(700);
}

export async function openEditor(accountId: string, url: string) {
  if (!hasNaverSession(accountId)) {
    throw new Error(`네이버 로그인 세션이 없습니다. 터미널에서 'npm run naver:login -- ${accountId}' 를 실행해 로그인해 주세요.`);
  }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(launchOptions({ headless: !env.naverHeadful }));
  const context = await browser.newContext({ storageState: naverStatePath(accountId), locale: "ko-KR", viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (page.url().includes("nid.naver.com")) {
    await browser.close();
    throw new Error("네이버 로그인 세션이 만료되었습니다. 'npm run naver:login' 으로 다시 로그인해 주세요.");
  }
  await page.waitForTimeout(3000);
  const frame = page.frame({ name: "mainFrame" }) ?? page.mainFrame();
  await tryClick(frame, SELECTORS.draftPopupCancel);
  await tryClick(frame, SELECTORS.helpClose);
  return { browser, context, page, frame };
}

const checkHint = (accountId: string) => `\n→ 네이버 화면이 바뀌었을 수 있어요. 'npm run naver:check -- ${accountId}' 로 선택자를 점검하세요 (CLAUDE.md 의 '네이버 자동화가 깨졌을 때' 참고).`;

async function debugShot(page: Page, label: string) {
  await mkdir(STORAGE_DIR, { recursive: true });
  const file = path.join(STORAGE_DIR, `debug-${label}-${Date.now()}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
  return file;
}

/** 원고를 네이버 블로그에 비공개 발행(또는 임시저장) */
export async function naverPublishPrivate(postId: string, log: (m: string) => unknown): Promise<PublishResult> {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { account: true } });
  const account = post.account;
  if (!account?.externalId) throw new Error("네이버 계정(blogId)이 지정되지 않았습니다.");
  const mode = accountSettings(account.settings).publishMode ?? "private";
  const rendered = await rerenderPost(postId, { forPublish: true });
  const segments = renderNaverSegments(rendered.manuscript, rendered.renderOptions);

  const { browser, page, frame } = await openEditor(account.id, `https://blog.naver.com/PostWriteForm.naver?blogId=${account.externalId}`);
  try {
    await (await first(frame, SELECTORS.title, 15_000)).click();
    await page.keyboard.type(rendered.manuscript.title, { delay: 15 });
    await log("제목 입력 완료");

    await (await first(frame, SELECTORS.body)).click();
    for (const [i, seg] of segments.entries()) {
      if (seg.type === "html") {
        await pasteHtml(frame, seg.html);
      } else {
        const before = await frame.locator(SELECTORS.uploadedImage[0]).count();
        const chooser = page.waitForEvent("filechooser", { timeout: 10_000 });
        await (await first(frame, SELECTORS.imageButton)).click();
        await (await chooser).setFiles(seg.localPath);
        await frame.waitForFunction(
          ([sel, n]) => document.querySelectorAll(sel as string).length > (n as number),
          [SELECTORS.uploadedImage[0], before] as const,
          { timeout: 30_000 },
        );
        await page.waitForTimeout(800);
        // 이미지 아래 새 문단으로 커서 이동
        await page.keyboard.press("ArrowDown").catch(() => undefined);
      }
      if (i % 3 === 0) await log(`본문 입력 중… (${i + 1}/${segments.length})`);
    }
    await log("본문 입력 완료");

    if (mode === "draft") {
      await (await first(frame, SELECTORS.saveDraft)).click();
      await page.waitForTimeout(2500);
      await log("임시저장 완료 — 네이버 블로그 '임시저장 글'에서 검수 후 발행하세요.");
      return { note: "임시저장" };
    }

    await (await first(frame, SELECTORS.publishOpen)).click();
    await page.waitForTimeout(1200);
    const tagInput = await first(frame, SELECTORS.tagInput).catch(() => null);
    if (tagInput) {
      for (const tag of rendered.manuscript.tags.slice(0, 10)) {
        await tagInput.click();
        await page.keyboard.type(tag, { delay: 10 });
        await page.keyboard.press("Enter");
      }
      await log(`태그 ${Math.min(10, rendered.manuscript.tags.length)}개 입력`);
    }
    await (await first(frame, SELECTORS.privateRadio)).click();
    await (await first(frame, SELECTORS.publishConfirm)).click();
    await page.waitForURL(/blog\.naver\.com\/[^/]+\/\d+|logNo=\d+/, { timeout: 30_000 });
    const url = page.url();
    const logNo = url.match(/(?:\/|logNo=)(\d{6,})/)?.[1];
    await log(`비공개 발행 완료: ${url}`);
    return { remoteId: logNo, remoteUrl: logNo ? `https://blog.naver.com/${account.externalId}/${logNo}` : url };
  } catch (e) {
    const shot = await debugShot(page, "publish");
    throw new Error(`${(e as Error).message}\n(오류 화면: ${shot})${checkHint(account.id)}`);
  } finally {
    await browser.close();
  }
}

/** 검수 완료 후 비공개 → 전체공개 전환 */
export async function naverMakePublic(postId: string, log: (m: string) => unknown): Promise<PublishResult> {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { account: true } });
  const account = post.account;
  if (!account?.externalId || !post.remoteId) throw new Error("비공개 발행된 글 정보(logNo)가 없습니다. 네이버에서 직접 공개로 바꾼 뒤 '발행 완료로 표시'를 눌러 주세요.");
  const { browser, page, frame } = await openEditor(
    account.id,
    `https://blog.naver.com/PostUpdateForm.naver?blogId=${account.externalId}&logNo=${post.remoteId}`,
  );
  try {
    await (await first(frame, SELECTORS.publishOpen, 15_000)).click();
    await page.waitForTimeout(1000);
    await (await first(frame, SELECTORS.publicRadio)).click();
    await (await first(frame, SELECTORS.publishConfirm)).click();
    await page.waitForTimeout(3000);
    await log("전체공개로 전환 완료");
    return { remoteId: post.remoteId, remoteUrl: `https://blog.naver.com/${account.externalId}/${post.remoteId}` };
  } catch (e) {
    const shot = await debugShot(page, "public");
    throw new Error(`${(e as Error).message}\n(오류 화면: ${shot})${checkHint(account.id)}`);
  } finally {
    await browser.close();
  }
}

/** 네이버 블로그 RSS 로 공개된 글 목록 확인 (발행 확인·URL 매칭용) */
export async function naverRss(blogId: string): Promise<{ title: string; link: string; pubDate: string }[]> {
  const res = await fetch(`https://rss.blog.naver.com/${blogId}.xml`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({
    title: (m[1].match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/)?.slice(1).find(Boolean) ?? "").trim(),
    link: (m[1].match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim(),
    pubDate: (m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "").trim(),
  }));
}

/** 선택자 점검 결과 한 줄 */
export type SelectorCheck = {
  key: keyof typeof SELECTORS;
  /** editor = 글쓰기 화면 / dialog = 발행 설정 창 / popup = 뜰 때만 있는 안내창(없어도 정상) */
  stage: "editor" | "dialog" | "popup";
  found: string | null;
  count: number;
  visible: boolean;
};

const STAGE: Record<keyof typeof SELECTORS, SelectorCheck["stage"]> = {
  helpClose: "popup",
  draftPopupCancel: "popup",
  title: "editor",
  body: "editor",
  imageButton: "editor",
  uploadedImage: "popup",
  publishOpen: "editor",
  saveDraft: "editor",
  tagInput: "dialog",
  privateRadio: "dialog",
  publicRadio: "dialog",
  publishConfirm: "dialog",
};

/** 화면(프레임)에서 SELECTORS 각 항목을 찾아 봅니다 — 클릭·입력은 하지 않음 */
export async function checkSelectors(frame: Frame | Page, stages: SelectorCheck["stage"][]): Promise<SelectorCheck[]> {
  const out: SelectorCheck[] = [];
  for (const key of Object.keys(SELECTORS) as (keyof typeof SELECTORS)[]) {
    if (!stages.includes(STAGE[key])) continue;
    let hit: SelectorCheck = { key, stage: STAGE[key], found: null, count: 0, visible: false };
    for (const sel of SELECTORS[key]) {
      const loc = frame.locator(sel);
      const count = await loc.count().catch(() => 0);
      if (!count) continue;
      const visible = await loc.first().isVisible().catch(() => false);
      hit = { key, stage: STAGE[key], found: sel, count, visible };
      if (visible) break;
    }
    out.push(hit);
  }
  return out;
}

/**
 * 네이버 글쓰기 화면을 저장된 로그인 세션으로 열어 선택자가 아직 맞는지 점검합니다.
 * 글은 쓰지 않습니다. 발행 설정 창은 열어 보기만 하고(확인 버튼은 누르지 않음) 닫습니다.
 * 결과 스크린샷·HTML 은 storage/naver/check-<시각>.* 에 저장 → Playwright MCP 로 새 선택자를 찾을 때 출발점.
 */
export async function runNaverCheck(accountId: string, opts: { url?: string } = {}) {
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!opts.url && !account?.externalId) throw new Error(`계정 ${accountId} 의 네이버 blogId(externalId)가 없습니다.`);
  const url = opts.url ?? `https://blog.naver.com/PostWriteForm.naver?blogId=${account!.externalId}`;
  // openEditor 가 안내창을 먼저 닫으므로, 안내창 선택자는 닫기 전에 따로 확인할 수 없어 "뜰 때만 있음"으로 표시합니다.
  const { browser, page, frame } = await openEditor(accountId, url);
  try {
    await first(frame, SELECTORS.title, 15_000).catch(() => null);
    const results = await checkSelectors(frame, ["editor", "popup"]);
    const publishOpen = results.find((r) => r.key === "publishOpen");
    let dialogOpened = false;
    if (publishOpen?.visible) {
      await frame.locator(publishOpen.found!).first().click();
      await page.waitForTimeout(1200);
      dialogOpened = true;
    }
    results.push(...(await checkSelectors(frame, ["dialog"])));
    await mkdir(STORAGE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshot = path.join(STORAGE_DIR, `check-${stamp}.png`);
    const htmlFile = path.join(STORAGE_DIR, `check-${stamp}.html`);
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(htmlFile, await frame.content().catch(() => ""), "utf8");
    const missing = results.filter((r) => r.stage !== "popup" && !r.visible).map((r) => r.key);
    return { url: page.url(), dialogOpened, results, missing, screenshot, htmlFile };
  } finally {
    await browser.close();
  }
}
