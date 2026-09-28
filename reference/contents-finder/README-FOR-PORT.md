# 이 폴더는 포팅용 참고 자료입니다 (jk-biz 앱의 일부 아님)

원본: `/Users/soeunab78/blog-automation/contents-finder` (별개의 파이썬 프로젝트, 같은 "지원포유" 블로그를 위해
매일 6개 채널에서 실시간 소재를 찾아 리포트를 만들던 도구). jk-biz 의 `/topics` 주제 발굴 기능으로
**흡수**하기 위해 소스만 그대로 복사해뒀습니다 (config.yaml 의 자격증명은 전부 빈 값 — 실제 시크릿 없음).

포팅이 끝나 jk-biz 자체 기능으로 완전히 대체되면 이 폴더는 지워도 됩니다.

- `finder/collectors/*.py` — 채널별 수집 (Playwright 로 실제 페이지를 열어 DOM 긁음. API 아님)
- `finder/analysis/crossref.py` — 같은 사건을 다룬 여러 채널 항목을 하나의 "소재" 그룹으로 묶는 교차검증
- `finder/analysis/scoring.py` — 그룹별 점수·근거 문장 생성 (참여 채널 수, 신선도, 네이버 랭킹, 트렌드 급등률 등 가중합)
- `finder/analysis/filters.py` — 네이버 블로그 32개 공식 카테고리 분류 + 부정/정치 이슈 필터
- `finder/analysis/llm.py` — 로컬 LLM(Ollama)으로 상위 소재에 제목·글 구성안 제안
- `finder/report.py` — 마크다운 리포트 생성 (`example-report.md` 가 실제 산출물 예시)
- `config.yaml` — 채널별 설정, 점수 가중치, 필터 단어, 카테고리 목록
