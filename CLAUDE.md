# 지원포유 콘텐츠 스튜디오 — Claude Code 작업 안내

블로그(구글 블로거·네이버) 원고 생성 → 비공개 발행 → 사람 검수 → 공개 발행 → 카드뉴스 → 분석·발전 제안 대시보드.
Next.js 16 App Router + Prisma(SQLite) + 워커(`scripts/worker.ts`, DB 작업 큐). UI·문구·주석은 한국어.

## 구조
- `src/lib/llm/` — AI 공급자 라우팅(`index.ts`: write/light/research 작업별), `claudeCode.ts`(구독 로그인 `claude -p`), `ollama.ts`, `manual.ts`(수동 복사·붙여넣기), `schemas.ts`
- `src/lib/content/` — 원고 생성·렌더링·SEO/AEO/GEO 점검(`seo.ts`)·승인 전 확인 사항(`readiness.ts`)·위험 주제(`risk.ts`)·시제 모순(`tense.ts`)·유사도
- `src/lib/publishers/` — `blogger.ts`(API), `naver.ts`(Playwright 로 스마트에디터 조작, `SELECTORS`), `google.ts`(OAuth)
- `src/lib/analytics/` — `google.ts`(GA4·서치콘솔·애드센스 조회), `sync.ts`(DB 동기화), `queries.ts`
- `src/lib/jobs/` — 작업 큐, `context.ts`(수동 모드용 작업 컨텍스트)
- `src/lib/topics/` — 주제 발굴 두 방식: `discover.ts`(검색어 기반: 자동완성 → 검색광고·데이터랩 검증) / `channels/`(실시간 6채널 교차검증, contents-finder 포팅)
  - `golden.ts` 황금키워드(시드 없음): 검색광고 업종 번호(`biztpId`)별 키워드 → 검색량 7구간 → 블로그 문서수(블로그 섹션 검색 화면 값 `naverSectionBlogCount` — **공식 검색 API 는 월 24,950회 한도라 쓰지 않음**, 1000 상한·큰 키워드만 API 예외, 약 10분 조각으로 이어서 실행, `GoldenKeyword` 에 저장·재사용) → 구간별 비율 낮은 순 + 최근 30일 발행·수요 성격·AI 블로그 적합 판정(저장해 재사용) + 자동완성 확장. 골든 점수·진단은 규칙(토큰 안 씀). 오래 걸려서 워커의 별도 줄(`BACKGROUND_JOBS`)에서 돌고, 정리는 매일 `topic.cleanup` 이 함(마지막 수집보다 30일 넘게 안 나온 키워드·30일 지난 작업 기록, 검색량 100 미만은 수집 때 삭제 — 주제·원고로 쓴 키워드는 남김)
  - `channels/collectors/*.ts` 채널별 수집(Playwright, `scripts.ts` 에 page.evaluate JS), `crossref.ts` 소재 묶기, `scoring.ts` 점수·근거 문장, `filters.ts` 32개 카테고리·부정/정치 필터, `discover.ts` 파이프라인·저장
  - 원본 파이썬: `reference/contents-finder/` (포팅 확인용 참고 자료). 동등성은 `tests/channels-parity.test.ts` 가 원본 실행 결과(`tests/fixtures/channels/expected.json`, `gen_expected.py` 로 생성)와 비교
- `scripts/` — worker, naver-login, naver-check, channels-check, check-ai, check-concepts, mcp-server

## 명령
```bash
npm test            # 단위 테스트 (vitest)
npm run typecheck
npm run build
npm run check:ai    # 작업별 담당 AI·Claude Code 로그인·Ollama 응답 확인 (--quick)
npm run naver:check -- <계정ID>   # 네이버 에디터 선택자 점검 (글은 쓰지 않음)
npm run channels:check [-- nate daum] [--save]   # 실시간 6채널 수집 점검 (DB 저장 없음)
npm run channels:eval [-- --collect] [--verbose]  # 실시간 발굴 키워드 점수표·합격 기준 (최근 수집 원본 재평가, DB 저장 없음)
```

## 지켜야 할 것
- **AI 비용**: 사용자는 Claude 구독으로 운영합니다. API 키 경로(anthropic/gemini)를 기본값으로 만들지 마세요. `claudeCode.ts` 의 `subscriptionEnv()`(API 키 환경변수 제거)와 도구 차단(`--tools ""`)을 약화시키지 마세요.
- **사람 검수 없이 공개 발행하는 경로를 만들지 마세요.** 비공개 발행 → 승인 → 공개가 원칙입니다.
- AI 가 경험·수치·요금제를 지어내지 않도록 한 프롬프트 규칙(`[경험 추가]` 자리표시 등)을 유지하세요.
- **원고 사실성 파이프라인**(목표: AI 사실 검수 지적 0): 조사(`RESEARCH_SYSTEM` 공식 출처 우선·최신성·기준일) → 핵심 수치 공식 대조(`verifyKeyFacts`, 공식 페이지 403이면 site: 검색, 공식 > 2차) → 원고(✔/✎만 단정, 공식 명칭·버전, 출처 없는 여론 문장 금지, 표 조건 명시) → 작성 직후 자체 점검(`content/selfcheck.ts`, 원고에 바로 반영·`research.selfCheck` 기록). 공식 페이지는 Claude WebFetch 가 403 인 곳이 많아 **스튜디오 브라우저로 원문을 먼저 읽어(`content/officialPages.ts`, `research.pages`) 대조·점검·검수에 넘김**. 사람 확인 목록은 `content/checklist.ts` 로 실제 할 일만(원고에 없는 내용·유보·자리표시·팁·링크는 빼고, 내부 링크는 프로그램이 확인). 2026-10-08 같은 주제 실험: 검수 수정 4→5→0, 최종 확인 필요 0·체크리스트 0. 약하게 만들지 마세요.
- DB 는 마이그레이션이 아니라 `prisma db push` 를 씁니다. **Prisma MCP 의 migrate-reset / migrate-dev 는 실행하지 마세요**(데이터 삭제 위험). SQLite 는 Json 기본값을 못 가지므로 `Json?` 로 둡니다.
- 비밀값(`.env`, `storage/`)은 커밋하지 않습니다. `storage/naver/*.json` 은 네이버 로그인 세션입니다.
- **수익화 플레이북 반영 규칙** (근거: `compass_artifact_…_text_markdown.md`)
  - 광고 배치는 `content/adPlan.ts` 규칙만 따릅니다(첫 화면 광고 없음, 글 길이별 1~2개, 상품 있으면 1개, 상품 박스 앞뒤 섹션 금지). 광고를 늘리는 변경은 `AD_DENSITY` 인사이트(체류시간 비교) 근거가 있을 때만.
  - 모든 글에 `[경험 추가]` 1~2개, 섹션은 결론 먼저(`seo.ts` `answer-first`). 정책·지원금 질의는 `CONDITION` 레시피, 네이버 홈판형은 `Post.format=HOMEFEED`(실시간 트렌드 주제 기본값).
  - 제휴 고지는 프로그램별 **원문 그대로**(`brand.ts` `PROGRAM_DISCLOSURE` — 쿠팡·네이버 쇼핑 커넥트가 반드시 기재하라고 정한 문구, 테스트로 고정)를 글 맨 위 + 링크 옆에. 상품은 글당 최대 2개.
  - 주제 점수의 AI 내성(`answerType`)은 기존 AI 같은 주제 확인 호출(`filterSameTopic`)에 얹어서만 판정합니다(추가 AI 호출·규칙 추측 금지).
  - 공개된 글 개선(제목 재작성·보강·정리, `post.optimize`)은 **제안만** — 공개 글을 자동으로 고치는 경로를 만들지 마세요.
  - 네이버 에디터: 모든 소제목 바로 위에 가장 긴 구분선("구분선 2" = `SELECTORS.dividerLong`, 본문 폭 전체)을 넣습니다(사용자 지정 양식). 기본 `divider`(구분선 1, 짧은 선)는 예비용. 인용구 버튼은 스타일 선택 창이 뜨고 커서가 빠져나오지 않아 쓰지 않습니다(2026-10-07 실제 에디터 확인).

## MCP 도구 (`.mcp.json`, 이 폴더에서 `claude` 를 실행하면 뜸 — 처음 한 번 승인)
| 서버 | 용도 |
|---|---|
| `jk-biz` (이 저장소 `scripts/mcp-server.ts`, 읽기 전용) | `db_summary` · `list_posts` · `post_detail` · `recent_jobs` · `list_manual_tasks` · `ga4_report` · `gsc_query` · `adsense_report`(API 값과 DB 동기화 값 비교) · `naver_selector_check` |
| `playwright` (Microsoft 공식) | 실제 브라우저로 네이버 에디터 화면 확인. 프로필 `storage/naver/mcp-profile` (처음 한 번 네이버 로그인) |
| `analytics-mcp` (Google 공식 GA4, 읽기 전용) | GA4 보고서 직접 조회 — `ga4_report` 결과 교차 확인용 |
| `prisma` (공식) | 스키마 확인·Prisma Studio. 데이터 질문은 `jk-biz` 도구를 쓰세요 |

## 네이버 자동화가 깨졌을 때
1. `recent_jobs` (status FAILED) 또는 원고 화면의 오류로 어느 단계인지 확인 — 오류에 `storage/naver/debug-*.png` 경로가 있습니다.
2. `npm run naver:check -- <계정ID>` (또는 MCP `naver_selector_check`) → ❌ 미발견 항목과 `storage/naver/check-*.png|html` 확인.
3. Playwright MCP 로 `https://blog.naver.com/PostWriteForm.naver?blogId=<blogId>` 를 열어(프로필에 네이버 로그인 필요) 해당 요소를 찾고, 안정적인 선택자(클래스 일부 `[class*=...]`, `data-*`, 텍스트)를 고릅니다.
4. `src/lib/publishers/naver.ts` 의 `SELECTORS` 배열 **앞쪽에 새 선택자를 추가**(기존 것은 남겨 두기) → `npm run naver:check` 로 ✅ 확인.
5. 대시보드에서 테스트 원고 1편을 **비공개 발행**해 끝까지 되는지 확인. 공개 발행 시험은 하지 마세요.

## 실시간 채널 수집이 깨졌을 때
1. `npm run channels:check -- <채널>` → 🌐(접속 불가 = 네트워크 문제)인지 ❌(화면은 열렸는데 0건 = 선택자 문제)인지 확인. `--save` 면 `storage/channels/check-*/` 에 HTML·스크린샷.
2. Playwright MCP 로 해당 URL(`channels/config.ts`)을 열어 목록 요소를 찾고, `channels/collectors/scripts.ts` 의 추출 JS 선택자를 고칩니다.
3. `tests/fixtures/channels/pages.html` 도 새 구조로 고쳐 `npm test` 로 추출 결과를 고정한 뒤 `channels:check` 로 ✅ 확인.
- 점수 공식·근거 문장은 원본과 동일해야 합니다. 바꿀 땐 의도적인 변경인지 확인하고 `expected.json` 과의 차이를 테스트에 명시하세요.
- 주제 발굴은 두 갈래입니다. ① 실시간 트렌드(`channels/`): 6시간 이내 화제 사건의 **메인 키워드만** 저장(`channels/keywords.ts`: AI 해석 → 메인 키워드·대안 → 네이버 검색량 확인 → 문서수) → 사용자가 골라 바로 원고 생성. ② 검색어 기반(`topics/discover.ts` + `topics/expand.ts`): 사용자가 입력한 키워드를 줄여 가며(신한은행 유출 → 신한은행) 자동완성·함께 많이 찾는·검색광고 연관 수집(줄인 핵심은 구글 자동완성도) → 월검색량 30 미만 제외(시드=메인 키워드는 항상 저장) → 롱테일은 메인 키워드(시드 전체 또는 2단어 이상 핵심, `expand.ts` `anchorsOf`)를 반드시 포함(사용자가 정한 정의 — 메인 키워드가 없는 후보는 같은 주제여도 원고 연관어로만) → 모든 후보를 AI 로 같은 주제·블로그로 답할 수 있는지 확인(커뮤니티명·상위 분야 다른 주제 제외) → 비율(문서수÷검색량, "< 10" 바닥값이면 계산 안 함) → 롱테일 키워드만 저장(개수 억지로 안 채움). 제목은 사용자가 고른 키워드에서만 `generateTitles`(작업 `topic.titles`)로 상위 글 제목·AI 브리핑 벤치마킹 → 키워드를 맨 왼쪽에 둔 6가지 유형 → 원고 생성. 발굴 단계에서 모든 키워드의 제목을 한꺼번에 만드는 방식(토큰 낭비)으로 되돌리지 마세요. 제목 숫자는 근거 있는 사실만(`TITLE_NUMBER_RULE`). `signals.mainKeyword` 는 원고 지시(글 전체가 메인 키워드 내용)와 AI 검수의 섹션·FAQ별 제목-본문 일치 판정(`alignment`, 승인 전 확인 사항)에 쓰입니다. 규칙(n-gram·문자열 매칭)으로 관련성을 추측하는 방식으로 되돌리지 마세요. 실시간 키워드 로직을 바꾸면 `npm run channels:eval` 합격 기준으로 전후를 비교하세요.
- 제목 규칙(`topics/titleRules.ts`, 2026-10-08 검색광고 데이터로 검증): 시간 표현은 **검색량으로 판단** — 연도·회차는 실제로 검색되는 형태·어순 그대로만("2026 근로장려금"은 13만, "근로장려금 2026"은 120), 월·일·"기준"은 제목에 넣지 않음(본문·메타에만). 수명(상시/해마다 반복/이슈)별 전략, 독자층 단어·키워드 반복 괄호 금지, 40자 안팎. 사용자가 고른 제목(6가지 중 하나·`titleLocked`)은 원고 제목으로 **확정** — 원고 AI 는 조사 결과와 어긋날 때만 바꾸고 `titleChangeReason` 을 남김(이유 없이 바꾸면 코드가 되돌림). 같은 주제를 여러 계정에 쓰면 첫 원고만 확정, 나머지는 계정마다 다른 보조 검색어(`pickSecondaryKeywords`). 체크리스트 4(`titleChecks`)는 규칙 판정(토큰 0)으로 원고·제목 후보 화면에 표시, `Post.titlePlan` 에 기록해 발전 제안(연도 갱신·이슈형 짝 주제·제목 유형별 유입 비교)에 씀.
- 원본과 의도적으로 다르게 바꾼 동작(엄격한 묶기·가중 분류·신선도 채널 확대 등)은 `config.ts` 의 `tuning` 스위치(기본 켬)로만 넣습니다. 동등성 테스트는 `ORIGINAL_CHANNEL_CONFIG`(전부 끔)로 돌고, 개선 동작은 `tests/channels-improvements.test.ts` 가 검증합니다.

## 분석 데이터가 이상할 때
1. `db_summary` 로 계정의 구글 연결·GA4 속성 ID·서치콘솔 URL 설정 확인.
2. `ga4_report` / `gsc_query by=page` / `adsense_report` 로 API 값과 DB 값을 비교 — 글 매칭이 `null` 이면 원고의 `remoteUrl` 경로와 실제 URL 이 다른 것.
3. 필요하면 `analytics-mcp` 로 GA4 를 직접 조회해 교차 확인.
4. 동기화 로직은 `src/lib/analytics/sync.ts`, 조회는 `src/lib/analytics/google.ts` (MCP 와 같은 코드).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
