/**
 * 네이버 에디터 선택자 점검 — 저장된 로그인 세션으로 글쓰기 화면을 열어 SELECTORS 항목이 아직 맞는지 확인합니다.
 * 글은 쓰지 않습니다(발행 설정 창은 열어만 보고 확인 버튼은 누르지 않음).
 * 사용법: npm run naver:check -- <계정ID> [--url <글쓰기 화면 주소>]
 * 깨진 항목이 있으면: 저장된 스크린샷·HTML + Playwright MCP 로 새 선택자를 찾아 src/lib/publishers/naver.ts 의 SELECTORS 를 고치세요 (CLAUDE.md 참고).
 */
import "./load-env";
import { db } from "../src/lib/db";
import { runNaverCheck } from "../src/lib/publishers/naver";

const STAGE_LABEL = { editor: "글쓰기 화면", dialog: "발행 설정 창", popup: "안내창·업로드 후(없어도 정상)" } as const;

async function main() {
  const args = process.argv.slice(2);
  const urlIdx = args.indexOf("--url");
  const url = urlIdx >= 0 ? args[urlIdx + 1] : undefined;
  const accountId = args.find((a, i) => !a.startsWith("--") && i !== urlIdx + 1);
  if (!accountId) {
    const naver = await db.account.findMany({ where: { platform: "NAVER" }, select: { id: true, name: true, externalId: true } });
    console.log("사용법: npm run naver:check -- <계정ID>\n네이버 계정:");
    for (const a of naver) console.log(`  ${a.id}  ${a.name} (${a.externalId ?? "blogId 없음"})`);
    process.exit(1);
  }
  const r = await runNaverCheck(accountId, { url });
  console.log(`열린 화면: ${r.url}\n`);
  for (const stage of ["editor", "dialog", "popup"] as const) {
    console.log(`■ ${STAGE_LABEL[stage]}${stage === "dialog" && !r.dialogOpened ? " — 발행 버튼을 못 찾아 열지 못함" : ""}`);
    for (const x of r.results.filter((y) => y.stage === stage)) {
      const mark = x.visible ? "✅ 발견" : x.found ? "👻 있으나 안 보임" : stage === "popup" ? "·  없음" : "❌ 미발견";
      console.log(`  ${mark.padEnd(10)} ${x.key.padEnd(17)} ${x.found ? `${x.found} (${x.count}개)` : ""}`);
    }
  }
  console.log(`\n스크린샷: ${r.screenshot}\nHTML: ${r.htmlFile}`);
  if (r.missing.length) {
    console.log(`\n❌ 고쳐야 할 항목: ${r.missing.join(", ")} → src/lib/publishers/naver.ts 의 SELECTORS`);
    process.exitCode = 1;
  } else {
    console.log("\n✅ 모든 필수 선택자가 화면에 있어요.");
  }
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(`점검 실패: ${(e as Error).message}`);
  await db.$disconnect();
  process.exit(1);
});
