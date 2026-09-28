/**
 * 네이버 로그인 세션 저장
 * 사용법: npm run naver:login -- <계정ID>
 *   (계정ID 는 대시보드 [계정 관리] 에서 확인)
 * 브라우저 창이 열리면 직접 로그인하세요(2단계 인증 포함). 로그인되면 자동으로 세션을 저장하고 창을 닫습니다.
 */
import "./load-env";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { naverStatePath } from "../src/lib/publishers/naver";
import { db } from "../src/lib/db";
import { launchOptions } from "../src/lib/browser";

async function main() {
  const accountId = process.argv[2];
  if (!accountId) {
    const accounts = await db.account.findMany({ where: { platform: "NAVER" } });
    console.log("사용법: npm run naver:login -- <계정ID>\n\n네이버 계정 목록:");
    for (const a of accounts) console.log(`  ${a.id}  ${a.name} (${a.externalId ?? "blogId 미설정"})`);
    process.exit(1);
  }
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  const browser = await chromium.launch(launchOptions({ headless: false }));
  const context = await browser.newContext({ locale: "ko-KR" });
  const page = await context.newPage();
  await page.goto("https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fblog.naver.com");
  console.log(`"${account.name}" 계정으로 로그인해 주세요… (최대 5분 대기)`);
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const cookies = await context.cookies("https://naver.com");
    if (cookies.some((c) => c.name === "NID_AUT")) break;
    await page.waitForTimeout(1500);
  }
  const file = naverStatePath(accountId);
  await mkdir(path.dirname(file), { recursive: true });
  await context.storageState({ path: file });
  console.log(`✅ 세션 저장 완료: ${file}\n   (세션이 만료되면 이 명령을 다시 실행하세요)`);
  await browser.close();
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
