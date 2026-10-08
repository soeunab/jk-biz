import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Frame, Page } from "playwright";
import { db } from "../db";
import { env } from "../env";
import { launchOptions } from "../browser";
import { accountSettings, rerenderPost } from "../content/service";
import { renderNaverSegments, type NaverSegment } from "../content/render";
import { stripPlaceholders } from "../content/types";
import { NAVER_UNCONFIRMED, NAVER_UNCONFIRMED_MSG } from "../content/postStatus";
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
  /** 사진 선택 시 나오는 네이버 자체 "사진 설명을 입력하세요" 칸 — 본문과 별개로 사진에 붙는 캡션 */
  imageCaption: [".se-caption"],
  /** 문단 서식(본문/소제목/인용구) 드롭다운 버튼 — 소제목으로 바꿀 문단을 선택한 뒤 클릭 */
  formatDropdown: ["button.se-text-format-toolbar-button"],
  formatSectionTitle: ["button.se-toolbar-option-text-format-sectionTitle-button", "button[class*='format-sectionTitle']"],
  formatBody: ["button.se-toolbar-option-text-format-text-button", "button[class*='format-text-button']"],
  /** 구분선 기본 삽입 버튼(구분선 1 = 220px 짧은 선) — 긴 선 선택이 안 될 때만 쓰는 예비. 누르면 커서가 구분선 다음 새 본문 문단으로 넘어감.
   *  인용구 버튼은 스타일 선택 창이 뜨고 커서가 인용구 밖으로 안정적으로 빠져나오지 않아 자동화에 쓰지 않음 (2026-10-07 실제 에디터 확인) */
  divider: ["button.se-insert-horizontal-line-default-toolbar-button", "button[data-name='horizontal-line']"],
  /** 구분선 모양 선택 화살표 → "구분선 2"(line1) = 본문 폭 전체(693px)로 가장 긴 선 (구분선 1~8 실측, 2026-10-07) */
  dividerStyle: ["button.se-document-toolbar-select-option-button[data-name='horizontal-line']"],
  dividerLong: ["button.se-toolbar-option-insert-horizontal-line-line1-button", "button[class*='horizontal-line-line1']"],
  /** 글자 크기 드롭다운 — 프리셋(11/13/15/16/19/24/28/34/38)만 있고 임의 숫자는 못 씀 */
  fontSizeDropdown: ["button.se-font-size-code-toolbar-button"],
  fontSize24: ["button.se-toolbar-option-font-size-code-fs24-button", "button[class*='font-size-code-fs24']"],
  /** 사진 선택 시 나오는 "AI 활용 설정" 토글 (AI로 만든 이미지임을 표시) */
  aiMarkToggle: ["button.se-set-ai-mark-button-toggle"],
  sidebarClose: [".se-sidebar-close-button"],
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

/**
 * 스마트에디터에 HTML 을 붙여넣습니다. 예전에는 합성 ClipboardEvent 를 직접 dispatch 했는데,
 * 에디터가 실제 브라우저 클립보드에서 온 진짜(trusted) paste 이벤트만 처리하도록 바뀌어 조용히 무시되는
 * 문제가 있었습니다(작업 로그는 성공으로 남지만 실제로는 본문이 비어 사진만 들어감).
 * 그래서 실제 클립보드에 써넣고 Ctrl/Cmd+V 로 진짜 붙여넣기를 일으킵니다.
 */
async function pasteHtml(page: Page, html: string) {
  await page.evaluate(async (h) => {
    const item = new ClipboardItem({
      "text/html": new Blob([h], { type: "text/html" }),
      "text/plain": new Blob([h.replace(/<[^>]+>/g, "")], { type: "text/plain" }),
    });
    await navigator.clipboard.write([item]);
  }, html);
  await page.keyboard.press("ControlOrMeta+KeyV");
  await page.waitForTimeout(700);
}

/** 현재 커서가 있는(또는 선택한) 문단의 서식을 "본문/소제목/인용구" 드롭다운에서 바꿉니다 */
async function setParagraphFormat(frame: Frame, page: Page, optionSelectors: string[]) {
  await (await first(frame, SELECTORS.formatDropdown)).click();
  await page.waitForTimeout(300);
  await (await first(frame, optionSelectors)).click();
  await page.waitForTimeout(300);
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

/** 본문 세그먼트(문단·소제목·구분선·사진)를 스마트에디터에 순서대로 입력 — 발행·임시저장 전 단계 (점검 스크립트도 이 함수를 그대로 씀) */
export async function writeSegments(page: Page, frame: Frame, segments: NaverSegment[], log: (m: string) => unknown) {
  for (const [i, seg] of segments.entries()) {
    if (seg.type === "heading") {
      // HTML <h2> 붙여넣기는 에디터가 굵은 글씨로만 남기고 실제 "소제목" 컴포넌트로 인식 못 함 —
      // (먼저 글자를 넣고 나중에 "소제목"으로 바꾸면 안의 글자가 통째로 사라지는 버그가 있어서)
      // 지금 있는 빈 문단을 먼저 "소제목" 서식으로 바꾼 뒤 그 안에 글자를 입력합니다.
      await setParagraphFormat(frame, page, SELECTORS.formatSectionTitle);
      await page.keyboard.type(seg.text, { delay: 10 });
      // 글자 크기가 프리셋 기본값이라 본문과 통일된 24 로 다시 지정 (방금 입력한 글자를 선택)
      await page.keyboard.press("Shift+Home");
      await (await first(frame, SELECTORS.fontSizeDropdown)).click();
      await page.waitForTimeout(300);
      await (await first(frame, SELECTORS.fontSize24)).click();
      // 글자 크기 적용 직후 바로 Enter 를 누르면 에디터 내부 상태 동기화(디바운스)가 끝나기 전이라
      // 방금 입력한 글자가 통째로 사라지는 경쟁 상태 버그가 있어서(실측: 200ms 는 실패, 1200ms 는 성공)
      // 넉넉히 기다린 뒤에 문단을 넘깁니다.
      await page.waitForTimeout(1200);
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      // 다음 문단이 소제목 서식을 이어받지 않도록 본문으로 되돌림
      await setParagraphFormat(frame, page, SELECTORS.formatBody);
    } else if (seg.type === "html") {
      await pasteHtml(page, seg.html);
    } else if (seg.type === "divider") {
      // 붙여넣은 문단 끝에서 새 줄을 만든 뒤 삽입 — 문장 중간에 끼어들지 않게
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      // 가장 긴 구분선(구분선 2) — 모양 선택이 안 되면 기본 구분선이라도 넣음
      let long = false;
      if (await tryClick(frame, SELECTORS.dividerStyle)) {
        await page.waitForTimeout(300);
        long = await tryClick(frame, SELECTORS.dividerLong);
        if (!long) await page.keyboard.press("Escape"); // 모양 목록을 닫고 기본 구분선으로
      }
      if (!long) {
        await log("⚠️ 긴 구분선(구분선 2)을 찾지 못해 기본 구분선을 넣었어요 — npm run naver:check 로 선택자를 점검하세요");
        await (await first(frame, SELECTORS.divider)).click();
      }
      await page.waitForTimeout(800);
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
      // 문서에 이미지가 여러 장이면 AI 활용 설정·사진 설명 칸도 장마다 하나씩 존재합니다.
      // 페이지 전체에서 첫 번째 것만 찾으면 항상 첫 사진 것을 건드리게 되므로, 방금 올린(마지막) 이미지 범위 안에서만 찾습니다.
      const lastImage = frame.locator(SELECTORS.uploadedImage[0]).last();
      // 사진을 선택해야(속성 툴바가 뜬 상태에서만) AI 활용 설정 버튼과 사진 설명 칸이 나타남
      await lastImage.locator(".se-image-resource").click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(300);
      if (seg.credit === "AI 생성 이미지") {
        await tryClick(frame, SELECTORS.sidebarClose); // 라이브러리 패널이 열려 있으면 버튼을 가려서 먼저 닫음
        await lastImage.locator(SELECTORS.aiMarkToggle[0]).click({ timeout: 2000 }).catch(() => undefined);
        await page.waitForTimeout(200);
      }
      // 사진 설명(대체 텍스트) — 본문에 따로 문단을 만들지 않고 네이버 자체의 "사진 설명" 칸에 직접 입력
      if (seg.caption?.trim()) {
        await lastImage.locator(SELECTORS.imageCaption[0]).click({ timeout: 3000 }).catch(() => undefined);
        await page.keyboard.type(seg.caption.trim(), { delay: 10 });
      }
      // 이미지(+설명 칸) 아래 새 문단으로 커서 이동 — "사진 설명" 칸은 이미지 컴포넌트 안에 격리된 별도
      // 편집영역이라 ArrowDown 으로는 못 빠져나오고(다음 내용이 캡션 안에 그대로 이어 붙는 버그가 있었음),
      // 네이버가 이미지 삽입 시 자동으로 만들어 두는 바로 다음 본문 문단을 직접 클릭해서 포커스를 옮깁니다.
      const nextPara = lastImage.locator("xpath=following-sibling::*[contains(@class,'se-text')][1]");
      if (await nextPara.count()) {
        await nextPara.click({ timeout: 2000 }).catch(() => undefined);
      } else {
        await page.keyboard.press("ArrowDown").catch(() => undefined);
      }
    }
    if (i % 3 === 0) await log(`본문 입력 중… (${i + 1}/${segments.length})`);
  }
}

/** 원고를 네이버 블로그에 비공개 발행(또는 임시저장) */
export async function naverPublishPrivate(postId: string, log: (m: string) => unknown): Promise<PublishResult> {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { account: true } });
  const account = post.account;
  if (!account?.externalId) throw new Error("네이버 계정(blogId)이 지정되지 않았습니다.");
  // 네이버는 글쓰기 화면이 항상 새 글을 만듦 — 이미 올라간 글이 있으면 브라우저를 열기 전에 멈춤(중복 글 방지)
  if (post.remoteId) {
    throw new Error(
      post.remoteId === NAVER_UNCONFIRMED
        ? NAVER_UNCONFIRMED_MSG
        : `이미 네이버에 올라간 글이 있어요(logNo=${post.remoteId}). 네이버에서 직접 수정하거나, 네이버에서 그 글을 삭제한 뒤 [네이버 연결 해제]를 누르고 다시 올리세요.`,
    );
  }
  const mode = accountSettings(account.settings).publishMode ?? "private";
  const rendered = await rerenderPost(postId, { forPublish: true });
  const segments = renderNaverSegments(rendered.manuscript, rendered.renderOptions);

  const { browser, context, page, frame } = await openEditor(account.id, `https://blog.naver.com/PostWriteForm.naver?blogId=${account.externalId}`);
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://blog.naver.com" });
    await (await first(frame, SELECTORS.title, 15_000)).click();
    await page.keyboard.type(stripPlaceholders(rendered.manuscript.title), { delay: 15 });
    await log("제목 입력 완료");

    await (await first(frame, SELECTORS.body)).click();
    await writeSegments(page, frame, segments, log);
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
    // 발행 버튼을 누른 뒤부터는 글이 이미 올라갔을 수 있음 — 주소 대기가 끝나지 않아도 실패(=재시도 유도)로 끝내지 않음
    const confirmed = await page
      .waitForURL(/blog\.naver\.com\/[^/]+\/\d+|logNo=\d+/, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (!confirmed) await page.waitForTimeout(5000);
    const url = page.url();
    const logNo = url.match(/(?:\/|logNo=)(\d{6,})/)?.[1];
    if (!logNo) {
      const shot = await debugShot(page, "publish-unconfirmed");
      await log(`⚠️ 발행 버튼은 눌렀지만 글 주소를 확인하지 못했어요 (화면: ${shot}). 자동으로 다시 올리지 않습니다.`);
      return { remoteId: NAVER_UNCONFIRMED, note: NAVER_UNCONFIRMED };
    }
    await log(`비공개 발행 완료: ${url}`);
    return { remoteId: logNo, remoteUrl: `https://blog.naver.com/${account.externalId}/${logNo}` };
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

/**
 * 블로그에 실제로 올라가 있는 글 본문 읽기 — 로그인 세션으로 열어 비공개 글도 읽음(글은 바꾸지 않음).
 * 비공개 발행 뒤 네이버 편집기에서 고친 내용·추가한 사진을 스튜디오에 반영하는 데 씀.
 */
export async function naverFetchPost(accountId: string, blogId: string, logNo: string): Promise<{ title: string; html: string; text: string; images: number }> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(launchOptions({ headless: true }));
  try {
    const context = await browser.newContext(hasNaverSession(accountId) ? { storageState: naverStatePath(accountId), locale: "ko-KR" } : { locale: "ko-KR" });
    const page = await context.newPage();
    await page.goto(`https://blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(`(() => {
      const main = document.querySelector(".se-main-container");
      const title = (document.querySelector(".se-title-text") || {}).innerText || "";
      return main ? { title: title.trim(), html: main.innerHTML, text: main.innerText, images: main.querySelectorAll("img.se-image-resource").length } : null;
    })()`);
    if (!r) throw new Error("네이버 글 본문을 찾지 못했어요 (삭제됐거나 로그인 세션이 만료됐을 수 있어요)");
    return r as { title: string; html: string; text: string; images: number };
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
  imageCaption: "popup",
  formatDropdown: "editor",
  formatSectionTitle: "popup",
  formatBody: "popup",
  divider: "editor",
  dividerStyle: "editor",
  dividerLong: "popup",
  fontSizeDropdown: "editor",
  fontSize24: "popup",
  aiMarkToggle: "popup",
  sidebarClose: "popup",
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
