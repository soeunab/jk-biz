/**
 * AI 연결 점검 — 작업별 담당 AI·비용과 Claude Code(구독) 로그인·Ollama 응답을 확인합니다.
 * 사용법: npm run check:ai            (짧은 응답까지 실제로 받아 봄 — Claude 구독 한도를 아주 조금 사용)
 *         npm run check:ai -- --quick (설치·연결만 확인)
 */
import "./load-env";
import { fallbackProvider, providerLabel, routingSummary } from "../src/lib/llm";
import { checkClaudeCode, checkOllama } from "../src/lib/llm/health";

async function main() {
  const live = !process.argv.includes("--quick");
  console.log("■ 작업별 담당 AI");
  const routes = await routingSummary();
  for (const r of routes) console.log(`  - ${r.label}: ${r.providerLabel}  [${r.cost}]`);
  const fb = fallbackProvider();
  console.log(`  - 실패 시 전환: ${fb ? providerLabel(fb) : "없음 (LLM_FALLBACK=none)"}`);
  if (routes.some((r) => r.provider === "anthropic" || r.provider === "gemini")) {
    console.log("  ⚠️ API 키 방식이 담당인 작업이 있어 사용량만큼 별도 요금이 나갑니다. 0원 운영을 원하면 LLM_WRITE=claude-code 등으로 지정하세요.");
  } else {
    console.log("  ✅ API 키를 쓰지 않습니다 — 추가 요금 없음");
  }

  console.log(`\n■ 연결 점검${live ? " (응답 테스트 포함)" : ""}`);
  const results = await Promise.all([checkClaudeCode(live), checkOllama(live)]);
  for (const r of results) console.log(`  ${r.ok ? "✅" : "⚠️"} ${r.name}${r.ms !== undefined ? ` (${(r.ms / 1000).toFixed(1)}초)` : ""}\n     ${r.detail}`);

  const used = new Set(routes.map((r) => r.provider));
  const broken = results.filter((r, i) => !r.ok && used.has(i === 0 ? "claude-code" : "ollama"));
  if (broken.length) {
    console.log(`\n담당으로 지정된 AI 중 ${broken.length}개가 준비되지 않았어요. 위 안내대로 고치거나, 그동안은 수동 작업함(/manual)으로 진행됩니다.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
