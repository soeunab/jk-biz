"""파이썬 원본(reference/contents-finder)으로 기대값 생성 — TS 포팅이 원본과 같은 결과를 내는지 비교용.

사용법 (저장소 루트에서): python3 tests/fixtures/channels/gen_expected.py
원본 모듈(util·filters·crossref·scoring·config)만 import 하며 네트워크·브라우저는 쓰지 않습니다.
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "reference", "contents-finder"))

from finder.config import load_config  # noqa: E402
from finder.models import Item  # noqa: E402
from finder.analysis.crossref import build_groups  # noqa: E402
from finder.analysis.scoring import score_group  # noqa: E402
from finder.analysis import filters  # noqa: E402
from finder import util  # noqa: E402

HERE = os.path.dirname(__file__)
cfg = load_config(os.path.join(ROOT, "reference", "contents-finder", "config.yaml"))


def run(include):
    cfg["blog"]["topics_include"] = include
    items = [Item(**d) for d in json.load(open(os.path.join(HERE, "items.json"), encoding="utf-8"))]
    groups = build_groups(items)
    for g in groups:
        score_group(g, cfg)
    return [
        {
            "label": g.label,
            "titles": [i.title for i in g.items],
            "score": g.score,
            "reasons": g.reasons,
            "category": g.category,
            "excluded_reason": g.excluded_reason,
            "metrics": g.metrics,
            "flags": g.flags,
        }
        for g in groups
    ]


TEXTS = [
    "명절 앞둔 원산지 표시위반 단속서 최다적발은 '김치·돼지고기'",
    "[단독] 삼성전자, 2027년 신제품 공개했다 - 조선비즈",
    "‘적자 기업’서 200조 몸값으로…SK하닉 솔리다임, 내년 美 상장 시동",
    "10시간 동안 34세 남성이 알았는데 반전",
    "AI 인공지능으로 보고서 쓰는 법",
    "아이폰 18 사전예약 첫날 품절…프로 모델 인기 폭발적",
    "【속보】 기름값 19주째 하락…고속도로 주유소 할인 등 영향 | SBS",
    "가을 캠핑 준비물 체크리스트",
    "금리 인하에 코스피 상승, 부동산 전세 시장은?",
    "강아지 고양이 반려동물 동물병원 사료",
]
COUNTS = ["4.7만", "6만 명", "5천+", "1,234", "2.3K", "70,294", "1.5억", "조회 3.3만", "0.5", "2.5", "없음", ""]
AGOS = ["56분 전", "2시간 전", "1일 전", "방금 전", "1일 2시간 30분 전", "6시간 동안 지속됨", "전날", "3시간 전 업데이트", "12시간 전", ""]
PCTS = ["1,000%", "900%", "약 50 %", "없음"]
FMT_COUNTS = [None, 0, 999, 9999, 10000, 12500, 13500, 47000, 70294, 1000000]
FMT_AGOS = [None, 0, 59, 60, 119, 1439, 1440, 3000]

expected = {
    "groups_business": run(["비즈니스·경제"]),
    "groups_it": run(["IT·컴퓨터"]),
    "tokens": {t: sorted(util.tokens(t)) for t in TEXTS},
    "norm": {t: util.norm(t) for t in TEXTS},
    "classify": {t: filters.classify_text(t) for t in TEXTS},
    "flags": {t: filters.flag_text(t, cfg["filters"]) for t in TEXTS + ["아파트 화재로 주민 대피", "사고방식이 바뀐 사고 현장", "대통령 국정감사 발언 논란"]},
    "parse_count": {t: util.parse_count(t) for t in COUNTS},
    "parse_ago": {t: util.parse_ago_minutes(t) for t in AGOS},
    "parse_pct": {t: util.parse_pct(t) for t in PCTS},
    "fmt_count": [[n, util.fmt_count(n)] for n in FMT_COUNTS],
    "fmt_ago": [[n, util.fmt_ago(n)] for n in FMT_AGOS],
    "resolve": [
        [["IT·컴퓨터", "비즈니스·경제", "비즈니스·경제"], "", filters.resolve_category(["IT·컴퓨터", "비즈니스·경제", "비즈니스·경제"], "")],
        [["게임", "스포츠"], "", filters.resolve_category(["게임", "스포츠"], "")],
        [["", ""], "코스피 금리", filters.resolve_category(["", ""], "코스피 금리")],
    ],
}
# 수집기 순수 파서 (브라우저·네트워크 없이 원본 함수만 실행)
from datetime import datetime, timezone  # noqa: E402
from finder.collectors.google_trends import parse_trend_row  # noqa: E402
from finder.collectors.google_news import parse_rss  # noqa: E402
from finder.collectors.daum_news import _parse_trend_text  # noqa: E402

TREND_ROWS = [
    ["이현중", "5천+", "arrow_upward", "1,000%", "12시간 전", "trending_up", "활성", "아시안게임 농구", "외 5개"],
    ["고기", "2만+", "1,000%", "1시간 전", "돼지고기 원산지", "김치"],
    ["자영업", "500+", "timelapse", "900%", "22시간 전", "6시간 동안 지속됨"],
    [],
]
DAUM_TRENDS = ["1위, 트럼프 대이란 대응 , 신규", "2위, 추석 기차표", "위, 빈 순위", "10위", "3위,  고기 , 상승"]
NOW = datetime(2026, 9, 26, 9, 0, tzinfo=timezone.utc)
rss = [list(r) for r in parse_rss(open(os.path.join(HERE, "google-news.xml"), "rb").read(), NOW, 40)]
expected["parsers"] = {
    "trend_rows": [[r, parse_trend_row(r)] for r in TREND_ROWS],
    "daum_trends": [[t, list(_parse_trend_text(t)) if _parse_trend_text(t) else None] for t in DAUM_TRENDS],
    "rss_now": NOW.isoformat(),
    "rss": rss,
}

with open(os.path.join(HERE, "expected.json"), "w", encoding="utf-8") as f:
    json.dump(expected, f, ensure_ascii=False, indent=1)
print("groups:", len(expected["groups_business"]), "→ expected.json")
