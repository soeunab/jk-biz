# 지원포유 콘텐츠 스튜디오 — Claude Code 작업 안내

블로그(구글 블로거·네이버) 원고 생성 → 비공개 발행 → 사람 검수 → 공개 발행 → 카드뉴스 → 분석·발전 제안 대시보드.
Next.js 16 App Router + Prisma(SQLite) + 워커(`scripts/worker.ts`, DB 작업 큐). UI·문구·주석은 한국어.

## 구조
- `src/lib/llm/` — AI 공급자 라우팅(`index.ts`: write/light/research 작업별), `claudeCode.ts`(구독 로그인 `claude -p`), `ollama.ts`, `manual.ts`(수동 복사·붙여넣기), `schemas.ts`
- `src/lib/content/` — 원고 생성·렌더링·SEO/AEO/GEO 점검(`seo.ts`)·승인 전 확인 사항(`readiness.ts`)·위험 주제(`risk.ts`)·시제 모순(`tense.ts`)·유사도
- `src/lib/publishers/` — `blogger.ts`(API), `naver.ts`(Playwright 로 스마트에디터 조작, `SELECTORS`), `google.ts`(OAuth)
- `src/lib/analytics/` — `google.ts`(GA4·서치콘솔·애드센스 조회), `sync.ts`(DB 동기화), `queries.ts`
- `src/lib/jobs/` — 작업 큐, `context.ts`(수동 모드용 작업 컨텍스트)
- `scripts/` — worker, naver-login, naver-check, check-ai, check-concepts, mcp-server

## 명령
```bash
npm test            # 단위 테스트 (vitest)
npm run typecheck
npm run build
npm run check:ai    # 작업별 담당 AI·Claude Code 로그인·Ollama 응답 확인 (--quick)
npm run naver:check -- <계정ID>   # 네이버 에디터 선택자 점검 (글은 쓰지 않음)
```

## 지켜야 할 것
- **AI 비용**: 사용자는 Claude 구독으로 운영합니다. API 키 경로(anthropic/gemini)를 기본값으로 만들지 마세요. `claudeCode.ts` 의 `subscriptionEnv()`(API 키 환경변수 제거)와 도구 차단(`--tools ""`)을 약화시키지 마세요.
- **사람 검수 없이 공개 발행하는 경로를 만들지 마세요.** 비공개 발행 → 승인 → 공개가 원칙입니다.
- AI 가 경험·수치·요금제를 지어내지 않도록 한 프롬프트 규칙(`[경험 추가]` 자리표시 등)을 유지하세요.
- DB 는 마이그레이션이 아니라 `prisma db push` 를 씁니다. **Prisma MCP 의 migrate-reset / migrate-dev 는 실행하지 마세요**(데이터 삭제 위험). SQLite 는 Json 기본값을 못 가지므로 `Json?` 로 둡니다.
- 비밀값(`.env`, `storage/`)은 커밋하지 않습니다. `storage/naver/*.json` 은 네이버 로그인 세션입니다.

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
