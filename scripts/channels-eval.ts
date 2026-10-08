/**
 * 실시간 발굴 결과 평가 — 같은 수집 데이터로 "어떤 키워드가 나오는지"를 점수표로 봅니다 (DB 저장 없음).
 * 키워드 고르는 로직을 바꿀 때 눈으로 몇 개 보는 대신, 이 점수표의 합격 기준으로 판단하세요.
 *
 * 사용법: npm run channels:eval                         (가장 최근 발굴 실행의 수집 원본: storage/channels/runs/)
 *         npm run channels:eval -- <파일.json>          (특정 수집 원본 — 항목 배열 또는 {items} 형식)
 *         npm run channels:eval -- --collect            (지금 6채널을 새로 수집해 원본으로 저장 후 평가)
 *         옵션: --category 비즈니스·경제  --limit 10
 * 소재 해석·분류 재분류는 평소 라우팅(가벼운 작업)을 그대로 씁니다. 네이버 검색량·문서수는 실제 API 를 조회합니다.
 */
import "./load-env";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeBrowser } from "../src/lib/browser";
import { analyzeItems, collectChannels, freshItems, planTopics, reclassifyAmbiguous, rescore, RUNS_DIR } from "../src/lib/topics/channels/discover";
import { NO_RESTRICTION } from "../src/lib/topics/channels/filters";
import { isHeadKeyword } from "../src/lib/topics/longtail";
import { docRatio, fmtRatio } from "../src/lib/topics/expand";
import { CHANNEL_IDS, type ChannelItem } from "../src/lib/topics/channels/types";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

async function loadItems(): Promise<{ file: string; items: ChannelItem[] }> {
  if (process.argv.includes("--collect")) {
    const results = await collectChannels(CHANNEL_IDS, (m) => console.log(m));
    await closeBrowser();
    const items = results.flatMap((r) => r.items);
    await mkdir(RUNS_DIR, { recursive: true });
    const file = path.join(RUNS_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-eval.json`);
    await writeFile(file, JSON.stringify({ at: new Date().toISOString(), items }));
    return { file, items };
  }
  const given = process.argv.slice(2).find((a) => a.endsWith(".json"));
  const file = given ?? path.join(RUNS_DIR, ((await readdir(RUNS_DIR).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort().at(-1)) ?? "");
  if (!file.endsWith(".json")) throw new Error("수집 원본이 없어요. 실시간 발굴을 한 번 실행하거나 --collect 로 새로 수집하세요.");
  const raw = JSON.parse(await readFile(file, "utf8")) as ChannelItem[] | { items: ChannelItem[] };
  const items = (Array.isArray(raw) ? raw : raw.items).map((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [camel(k), v])) as ChannelItem);
  return { file, items };
}

const pad = (s: string, w: number) => (s.length > w ? `${s.slice(0, w - 1)}…` : s + " ".repeat(w - s.length));
const num = (v: number | null | undefined) => (v == null ? "미확인" : v.toLocaleString("ko-KR"));

async function main() {
  const category = arg("--category") ?? "비즈니스·경제";
  const limit = Number(arg("--limit") ?? 10);
  const { file, items: collected } = await loadItems();
  const items = freshItems(collected);
  console.log(`\n■ 원본 ${path.basename(file)} — 수집 ${collected.length} → 6시간 이내 ${items.length} · 카테고리 ${category} · ${limit}개`);

  let a = analyzeItems(items, [category]);
  if (category !== NO_RESTRICTION && (await reclassifyAmbiguous(a.groups, (m) => console.log(`  ${m}`)))) a = rescore(a.groups, [category]);
  const t0 = Date.now();
  const { planned, noStory, sameEvent, dupKeyword } = await planTopics(a.ranked, items, { limit, existingKeywords: new Set(), network: true, log: (m) => console.log(`  ${m}`) });
  console.log(`  해석·측정 ${((Date.now() - t0) / 1000).toFixed(0)}초 · 근거 부족으로 뺀 소재 ${noStory.length}개${noStory.length ? ` (${noStory.map((g) => g.label.slice(0, 12)).join(", ")})` : ""}${sameEvent.length ? ` · 같은 사건 ${sameEvent.length}개 (${sameEvent.map((g) => g.label.slice(0, 12)).join(", ")})` : ""}${dupKeyword ? ` · 키워드 중복 ${dupKeyword}` : ""}`);

  console.log(`\n■ 점수표 (실시간 발굴 = 메인 키워드만, 골라서 바로 원고 생성)`);
  console.log(`  ${pad("점수", 4)} ${pad("소재", 26)} ${pad("메인 키워드", 20)} ${pad("월검색량", 9)} ${pad("문서수", 11)} 비율`);
  for (const p of planned) {
    const k = p.main;
    console.log(
      `  ${pad(String(p.g.score), 4)} ${pad(p.g.label, 26)} ${pad(k.keyword, 20)} ${pad(num(k.volume), 9)} ${pad(num(k.documentCount), 11)} ${fmtRatio(docRatio(k.documentCount, k.volume))}${p.measured ? "" : " ※검색량 미확인"}${isHeadKeyword(k.keyword) ? " ⚠️대상 이름뿐" : ""}`,
    );
    console.log(`       └ ${p.story.by === "ai" ? "AI" : "대표어"}: ${p.story.summary.slice(0, 50)} | 대안: ${p.alternates.map((c) => `${c.keyword}(${num(c.volume)})`).join(", ") || "-"}`);
  }

  // 합격 기준
  const n = planned.length || 1;
  const head = planned.filter((p) => isHeadKeyword(p.main.keyword)).length;
  const measured = planned.filter((p) => p.measured).length;
  const docs = planned.filter((p) => p.main.documentCount != null).length;
  const vague = planned.filter((p) => /실시간 이슈|관련 정보|주요 지표|다양한/.test(p.story.summary)).length;
  const check = (ok: boolean, text: string) => console.log(`  ${ok ? "✅" : "❌"} ${text}`);
  console.log(`\n■ 합격 기준 (저장 예정 ${planned.length}개)`);
  check(head === 0, `대상 이름 하나뿐인 메인 키워드('신한은행' 같은 헤드) 0개 — ${head}개`);
  check(docs === planned.length, `메인 키워드 문서수 측정 100% — ${Math.round((docs / n) * 100)}%`);
  check(measured / n >= 0.7, `메인 키워드 네이버 검색량(월 10회 이상) 확인 70% 이상 — ${Math.round((measured / n) * 100)}% (막 터진 이슈는 아직 데이터가 없을 수 있음)`);
  check(vague === 0, `무슨 일인지 모르는 막연한 소재 0개 — ${vague}개`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
