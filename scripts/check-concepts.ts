/**
 * 계정 콘셉트 차별화 확인 — 같은 키워드를 두 콘셉트로 각각 원고 생성해 제목·관점·예시·유사도를 비교합니다.
 * 사용법: npm run check:concepts -- "제미나이 보고서" "직장인 업무 자동화 후기형" "1인 가구 생활비 절약형" [NAVER|BLOGGER]
 * AI 키(ANTHROPIC_API_KEY 또는 GEMINI_API_KEY)가 있어야 의미 있는 결과가 나옵니다. (조사 단계는 비용 절약을 위해 생략)
 */
import "./load-env";
import { generateManuscript } from "../src/lib/content/generate";
import { manuscriptText } from "../src/lib/content/render";
import { similarity, SIMILARITY_WARN } from "../src/lib/content/similarity";
import { activeProvider, providerLabel } from "../src/lib/llm";
import { db } from "../src/lib/db";

async function main() {
  const [keyword = "제미나이 보고서 작성", conceptA = "직장인 업무 자동화 후기형 — 보고서·회의록 실전 템플릿", conceptB = "1인 가구 생활 AI — 장보기·가계부·행정 처리", platformArg = "NAVER"] = process.argv.slice(2);
  const platform = platformArg === "BLOGGER" ? "BLOGGER" : "NAVER";
  console.log(`글쓰기 AI: ${providerLabel()} · 키워드 "${keyword}" · ${platform}\n`);
  if (activeProvider() === "mock") console.log("⚠️ 데모(mock) 모드라 콘셉트와 무관한 샘플 원고가 나옵니다. .env 에 AI 키를 넣고 다시 실행하세요.\n");

  const results = [];
  for (const concept of [conceptA, conceptB]) {
    const { manuscript } = await generateManuscript(
      { platform, keyword, persona: "GENERAL", accountConcept: concept },
      { skipResearch: true, log: (m) => console.log(`  … ${m}`) },
    );
    results.push({ concept, m: manuscript });
  }
  for (const { concept, m } of results) {
    console.log(`\n■ 콘셉트: ${concept}`);
    console.log(`  제목: ${m.title}`);
    console.log(`  직답: ${m.directAnswer}`);
    console.log(`  소제목: ${m.sections.map((s) => s.heading).join(" / ")}`);
    const example = m.sections.map((s) => s.body.split("\n").find((l) => l.startsWith(">"))).find(Boolean);
    console.log(`  예시: ${example ?? "(프롬프트 예시 없음)"}`);
  }
  const sim = similarity(manuscriptText(results[0].m), manuscriptText(results[1].m));
  console.log(`\n본문 유사도: ${Math.round(sim * 100)}% ${sim >= SIMILARITY_WARN ? "⚠️ 너무 비슷함 — 콘셉트를 더 구체적으로 적어 보세요" : "✅ 충분히 다름"}`);
  console.log(`제목 동일 여부: ${results[0].m.title === results[1].m.title ? "⚠️ 같음" : "✅ 다름"}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
