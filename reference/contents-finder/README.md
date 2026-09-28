# contents-finder — 매일 오전 8시 소재 발굴 자동화 (지원포유)

6대 채널(네이버 모바일 홈판 · 네이버 랭킹 · 네이트 · 구글 트렌드 · 다음/구글 뉴스 · 크리에이터 어드바이저[보조])에서
데이터를 수집 → 채널 간 교차검증 → 점수화 → `reports/YYYY-MM-DD.md` 리포트를 만듭니다.
실행할 때마다 네이버 블로그 32개 카테고리 중 원하는 주제 하나를 골라 그 주제에 맞는 소재만 추천받을 수 있습니다.

## 설치 (맥미니에서 딱 한 번)

터미널을 열고 아래 두 줄을 붙여넣으세요.

```bash
cd ~/blog-automation/contents-finder
bash setup.sh
```

## 시험 실행

```bash
./run_daily.sh --debug
```

끝나면 `reports/latest.md` 를 열어 보세요. `--debug` 로 실행하면 채널별 화면(HTML/스크린샷)이 `data/debug/날짜/` 에 저장됩니다.

## 실행 시 주제(카테고리) 선택

`python main.py` 또는 `./run_daily.sh` 를 실행하면(더블클릭 `소재발굴_실행.command` 포함) 데이터 수집을 시작하기 전에 터미널에 아래처럼 번호 목록이 뜹니다.

```
어떤 주제를 분석할까요? 번호나 이름을 입력하세요. (Enter = 30.비즈니스·경제)
   1. 문학·책
   2. 영화
   ...
  30. 비즈니스·경제  <- 기본값
   ...
  33. 주제 선택 보류
> 
```

- 번호(예: `30`)나 카테고리 이름(예: `비즈니스·경제`)을 입력하고 Enter.
- **아무것도 입력하지 않고 Enter만 누르면 기본값인 "비즈니스·경제"** 로 진행합니다.
- 목록 맨 마지막의 **"주제 선택 보류"** 를 고르면 카테고리로 거르지 않고 전체 소재를 다 보여줍니다(예전 방식과 비슷).
- 데이터 수집(6대 채널)은 매번 전체를 그대로 수집하고, 고른 주제는 분석·추천 단계에서만 적용됩니다. 그래서 리포트의 "TOP" 에는 고른 주제만, "주제 밖이지만 화제인 이슈" 에는 나머지 카테고리가 참고용으로 나옵니다.
- 카테고리 목록/키워드 분류 기준은 `finder/analysis/filters.py` 의 `CATEGORY_LIST`, `CATEGORY_KEYWORDS` 에 있습니다.
- `--from-raw` 로 재분석할 때도 주제를 다시 선택합니다.
- SSH나 스케줄러처럼 입력을 받을 수 없는 환경에서 실행하면 자동으로 기본값(비즈니스·경제)으로 진행됩니다(멈추지 않음).

## 매일 오전 8시 자동 실행 등록

```bash
./install_launchd.sh          # 등록 (해제: ./install_launchd.sh --remove)
```

- 맥에 **로그인된 상태**여야 실행됩니다 (로그인 세션의 launchd 에이전트).
- 8시에 맥이 잠자기 상태였다면 깨어난 직후 실행됩니다. 정시 실행이 필요하면 한 번만 `sudo pmset repeat wakeorpoweron MTWRFSU 07:55:00`
- 로그: `logs/날짜.log`, `logs/launchd.out.log`, `logs/launchd.err.log`

## 로컬 LLM 연결 (Gemma / Qwen 등) — 추천 제목/글 구성 자동 생성

원고 초안 생성에 쓰는 것과 **같은 모델·같은 서버**를 그대로 쓰면 됩니다. OpenAI 호환 API 만 열려 있으면 어떤 모델이든 동작합니다.
`config.yaml` 의 `llm.base_url` 을 그 서버 주소로 맞추세요.

| 서버 | base_url 예시 | 비고 |
|---|---|---|
| Ollama | `http://127.0.0.1:11434/v1` | `model` 에 태그(예: `gemma3:12b`) 또는 `default`(자동 감지) |
| LM Studio | `http://127.0.0.1:1234/v1` | 서버 탭에서 Start Server |
| mlx_lm.server | `http://127.0.0.1:8080/v1` | `mlx_lm.server --model <경로> --port 8080` |
| llama.cpp | `http://127.0.0.1:8080/v1` | `llama-server -m <모델.gguf> --port 8080` |

- `model: default` 이면 서버가 알려주는 첫 모델을 자동으로 씁니다. 모델명에 `gemma` 가 있으면 system 지시문을 사용자 메시지에 합쳐 보내고(`merge_system: auto`), `qwen` 이면 `/no_think` 를 붙입니다(`no_think: auto`).
- 서버가 꺼져 있으면 AI 제안만 건너뛰고 나머지 리포트는 정상 생성됩니다.
- 서버를 자동으로 켜고 싶으면 `llm.autostart_cmd` 에 실행 명령을 넣으세요. 모델 파일이 **외장 SSD** 에 있으면 오전 8시에 SSD 가 연결(마운트)되어 있어야 합니다.

## 자주 바꾸는 설정 (config.yaml)

| 바꾸고 싶은 것 | 위치 |
|---|---|
| 실행 시 기본으로 뜨는 주제 (대화형 프롬프트에서 Enter만 눌렀을 때) | `finder/analysis/filters.py` 의 `DEFAULT_CATEGORY` |
| 부정/정치 제외 단어 | `filters.negative_hard`, `filters.politics` |
| 점수 가중치 | `scoring.*` |
| 다음/네이버 수집 페이지 추가·삭제 | `daum.pages`, `naver_ranking.pages` |
| 채널 끄기/켜기 | `channels.*` |
| 리포트 상위 개수 | `report.top_n` |

## 폴더 구조

```
main.py                 진입점 (python main.py --help)
finder/collectors/      채널별 수집기 (네이버 홈판/랭킹, 네이트, 구글 트렌드, 다음, 구글 뉴스, 크리에이터 어드바이저)
finder/analysis/        교차검증(crossref) · 점수(scoring) · 필터(filters) · 로컬 LLM(llm)
finder/report.py        Markdown 리포트
reports/                날짜별 리포트 + latest.md
data/raw/               수집 원본 JSON (재분석: python main.py --from-raw data/raw/날짜.json)
data/debug/             --debug 또는 실패 시 저장되는 HTML/스크린샷
```

## 채널별 참고

- **네이버 홈판 / 네이버 랭킹**: 네이버 화면 구조가 자주 바뀌어 링크 패턴 기반으로 수집합니다. 0건이 나오면 리포트 맨 위 '채널 수집 상태' 표와 `data/debug/` 를 확인하세요.
- **구글 트렌드**: 카테고리 필터는 실제 클릭으로 적용합니다(검색량 1,000%↑ 는 🔥 표시).
- **구글 뉴스**: RSS 를 사용합니다. 한국판 구글 뉴스에는 '실시간 급상승 관심뉴스' 목록이 없어(네이트 판 사이드바에 있음) 네이트 쪽 데이터로 대체했습니다.
- **크리에이터 어드바이저**: 기본 꺼짐(보조용). 쓰려면 `channels.creator_advisor: true`, `creator_advisor.url` 설정 후 `python main.py --login` 으로 직접 1회 로그인. 아이디/비밀번호는 저장·처리하지 않습니다.
- **'선점 후보'** 는 수집한 네이버 랭킹/홈판에 아직 없다는 뜻의 추정입니다. 발행 전 네이버 블로그 검색으로 한 번 더 확인하세요.
