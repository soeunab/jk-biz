/**
 * 실시간 발굴 결과 평가 — 같은 수집 데이터로 "어떤 키워드가 나오는지"를 점수표로 봅니다 (DB 저장 없음).
 * 키워드 고르는 로직을 바꿀 때 눈으로 몇 개 보는 대신, 이 점수표의 합격 기준으로 판단하세요.
 *
 * 사용법: npm run channels:eval                         (가장 최근 발굴 실행의 수집 원본: storage/channels/runs/)
 *         npm run channels:eval -- <파일.json>          (특정 수집 원본 — 항목 배열 또는 {items} 형식)
 *         npm run channels:eval -- --collect            (지금 6채널을 새로 수집해 원본으로 저장 후 평가)
 *         옵션: --category 비즈니스·경제  --limit 10  --ai (AI 관련 소재만)  --verbose (소재별 후보 측정값)
 * 소재 해석·분류 재분류는 평소 라우팅(가벼운 작업)을 그대로 씁니다. 네이버 검색량·문서수는 실제 API 를 조회합니다.
 */
import "./load-env";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeBrowser } from "../src/lib/browser";
import { analyzeItems, collectChannels, freshItems, planTopics, reclassifyAmbiguous, rescore, RUNS_DIR } from "../src/lib/topics/channels/discover";
import { AI_FOCUS_TERMS, NO_RESTRICTION } from "../src/lib/topics/channels/filters";
import { isHeadKeyword } from "../src/lib/topics/longtail";
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
  const focus = process.argv.includes("--ai") ? AI_FOCUS_TERMS : [];
  const { file, items: collected } = await loadItems();
  const items = freshItems(collected);
  console.log(`\n■ 원본 ${path.basename(file)} — 수집 ${collected.length} → 6시간 이내 ${items.length} · 카테고리 ${category}${focus.length ? " + AI 관련" : ""} · ${limit}개`);

  let a = analyzeItems(items, [category], undefined, focus);
  if (category !== NO_RESTRICTION && (await reclassifyAmbiguous(a.groups, (m) => console.log(`  ${m}`)))) a = rescore(a.groups, [category], undefined, focus);
  const t0 = Date.now();
  const { planned, noStory, sameEvent, dupKeyword } = await planTopics(a.ranked, items, { limit, existingKeywords: new Set(), network: true, log: (m) => console.log(`  ${m}`) });
  console.log(`  해석·측정 ${((Date.now() - t0) / 1000).toFixed(0)}초 · 근거 부족으로 뺀 소재 ${noStory.length}개${noStory.length ? ` (${noStory.map((g) => g.label.slice(0, 12)).join(", ")})` : ""}${sameEvent.length ? ` · 같은 사건 ${sameEvent.length}개 (${sameEvent.map((g) => g.label.slice(0, 12)).join(", ")})` : ""}${dupKeyword ? ` · 키워드 중복 ${dupKeyword}` : ""}`);

  console.log(`\n■ 점수표`);
  console.log(`  ${pad("점수", 4)} ${pad("소재", 26)} ${pad("키워드", 22)} ${pad("월검색량", 9)} ${pad("문서수", 11)} 경쟁  근거`);
  for (const p of planned) {
    const k = p.pick;
    console.log(
      `  ${pad(String(p.g.score), 4)} ${pad(p.g.label, 26)} ${pad(k.keyword, 22)} ${pad(num(k.volume), 9)} ${pad(num(k.documentCount), 11)} ${pad(k.competitionScore != null ? String(Math.round(k.competitionScore)) : "-", 5)} ${p.reason === "longtail" ? "롱테일" : "제안어(검색량 없음)"}${isHeadKeyword(k.keyword) ? " ⚠️헤드" : ""}`,
    );
    console.log(`       └ ${p.story.by === "ai" ? "AI" : "대표어"}: ${p.story.summary.slice(0, 50)} | 제안: ${p.story.phrases.join(", ")} | 후보 ${p.candidates.length}개`);
    if (process.argv.includes("--verbose"))
      for (const c of p.candidates.slice(0, 10))
        console.log(`          · ${pad(c.keyword, 22)} 월 ${pad(num(c.volume), 9)} 문서 ${pad(num(c.documentCount), 11)} 경쟁 ${c.competitionScore != null ? Math.round(c.competitionScore) : "-"} 점수 ${c.score}`);
  }

  // 합격 기준
  const n = planned.length || 1;
  const head = planned.filter((p) => isHeadKeyword(p.pick.keyword)).length;
  const headAvoidable = planned.filter((p) => isHeadKeyword(p.pick.keyword) && p.candidates.some((c) => !isHeadKeyword(c.keyword) && (c.volume ?? 0) >= 10)).length;
  const measured = planned.filter((p) => p.pick.documentCount != null).length;
  const longtail = planned.filter((p) => p.reason === "longtail").length;
  const vague = planned.filter((p) => /실시간 이슈|관련 정보|주요 지표/.test(p.story.summary) || !p.story.phrases.length).length;
  const check = (ok: boolean, text: string) => console.log(`  ${ok ? "✅" : "❌"} ${text}`);
  console.log(`\n■ 합격 기준 (저장 예정 ${planned.length}개)`);
  check(headAvoidable === 0, `측정된 롱테일이 있는데 헤드 키워드를 고른 소재 0개 — ${headAvoidable}개 (헤드 키워드 전체 ${head}개)`);
  check(measured === planned.length, `고른 키워드의 문서수 측정 100% — ${Math.round((measured / n) * 100)}%`);
  check(longtail / n >= 0.8, `검색량(월 10회 이상) 확인된 롱테일 사용 80% 이상 — ${Math.round((longtail / n) * 100)}%`);
  check(vague === 0, `무슨 일인지 모르는 막연한 소재 0개 — ${vague}개`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
