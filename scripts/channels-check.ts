/**
 * 실시간 채널 수집 점검 — 6개 채널 수집기를 실제로 돌려 채널별 성공 여부·건수·샘플을 보여 줍니다 (DB 저장 없음).
 * 네이버·다음·네이트 화면은 자주 바뀌어 선택자가 깨지기 쉬우니, 0건이 나오면 여기서 먼저 확인하세요.
 *
 * 사용법: npm run channels:check                      (6개 채널 전부)
 *         npm run channels:check -- nate daum         (일부 채널만)
 *         npm run channels:check -- --save            (성공한 화면도 HTML·스크린샷 저장)
 * 저장 위치: storage/channels/check-<시각>/ (실패한 화면은 --save 없이도 저장)
 */
import "./load-env";
import path from "node:path";
import { closeBrowser, getBrowser } from "../src/lib/browser";
import { COLLECTORS } from "../src/lib/topics/channels/collectors";
import { DEFAULT_CHANNEL_CONFIG } from "../src/lib/topics/channels/config";
import { analyzeItems } from "../src/lib/topics/channels/discover";
import { NO_RESTRICTION } from "../src/lib/topics/channels/filters";
import { CHANNEL_IDS, type ChannelId, type ChannelResult } from "../src/lib/topics/channels/types";

const FILE_OF: Record<ChannelId, string> = {
  naver_home: "naverHome.ts",
  naver_ranking: "naverRanking.ts",
  nate: "nate.ts",
  google_trends: "googleTrends.ts",
  daum: "daum.ts",
  google_news: "googleNews.ts",
};

async function main() {
  const args = process.argv.slice(2);
  const save = args.includes("--save");
  const picked = args.filter((a) => !a.startsWith("--")) as ChannelId[];
  const unknown = picked.filter((c) => !CHANNEL_IDS.includes(c));
  if (unknown.length) {
    console.log(`알 수 없는 채널: ${unknown.join(", ")}\n채널: ${CHANNEL_IDS.join(", ")}`);
    process.exit(1);
  }
  const channels = picked.length ? picked : CHANNEL_IDS;
  const debugDir = path.join(process.cwd(), "storage", "channels", `check-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const results: ChannelResult[] = [];
  for (const c of channels) {
    const col = COLLECTORS[c];
    process.stdout.write(`… ${col.label} 수집 중\n`);
    try {
      const browser = col.browser ? await getBrowser() : (null as never);
      results.push(await col.collect({ browser, cfg: DEFAULT_CHANNEL_CONFIG, debugDir, saveAll: save }));
    } catch (e) {
      results.push({ channel: c, label: col.label, ok: false, items: [], error: (e as Error).message.split("\n")[0], seconds: 0, notes: [] });
    }
  }
  await closeBrowser();

  console.log("\n■ 채널별 결과");
  for (const r of results) {
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.label.padEnd(12)} ${String(r.items.length).padStart(4)}건  ${r.seconds.toFixed(0)}초${r.error ? `  — ${r.error}` : ""}`);
    for (const n of r.notes.slice(0, 4)) console.log(`       · ${n}`);
    for (const it of r.items.slice(0, 3)) console.log(`       예) [${it.source}] ${it.title}${it.rank ? ` (${it.rank}위)` : ""}`);
  }

  const items = results.flatMap((r) => r.items);
  if (items.length) {
    const a = analyzeItems(items, [NO_RESTRICTION]);
    console.log(`\n■ 교차검증: 소재 그룹 ${a.groups.length}개 (제외 ${a.excluded.length}) — 상위 5개`);
    for (const g of a.ranked.slice(0, 5)) console.log(`  ${String(g.score).padStart(3)}점 · ${g.category} · ${g.metrics?.channels.length}개 채널 · ${g.label}`);
  }

  console.log(`\n디버그 저장 위치: ${debugDir}${save ? "" : " (실패한 화면만 저장됨, 전체는 --save)"}`);
  const broken = results.filter((r) => !r.ok);
  const network = broken.filter((r) => isNetworkFailure(r));
  const selector = broken.filter((r) => !isNetworkFailure(r));
  if (network.length) {
    console.log(`\n🌐 접속 자체가 안 됨: ${network.map((r) => r.label).join(", ")}`);
    console.log("   → 선택자 문제가 아니라 네트워크(방화벽·프록시·오프라인) 문제입니다. 인터넷이 되는 맥에서 다시 실행하세요.");
  }
  if (selector.length) {
    console.log(`\n❌ 화면은 열렸지만 항목을 못 찾음: ${selector.map((r) => r.label).join(", ")}`);
    console.log("   → 저장된 HTML·스크린샷을 보고 src/lib/topics/channels/collectors/scripts.ts 의 선택자와");
    for (const r of selector) console.log(`     src/lib/topics/channels/collectors/${FILE_OF[r.channel]} 를 점검하세요 (CLAUDE.md '실시간 채널 수집이 깨졌을 때').`);
  }
  if (broken.length) process.exitCode = 1;
}

/** 페이지를 아예 못 연 경우 (선택자와 무관) */
function isNetworkFailure(r: ChannelResult) {
  const text = [r.error, ...r.notes].join(" ");
  const net = /ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ERR_PROXY|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|HTTP 40[37]/;
  return net.test(text) && !r.items.length;
}

main().catch(async (e) => {
  console.error(`점검 실패: ${(e as Error).message}`);
  await closeBrowser();
  process.exit(1);
});
