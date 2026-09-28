"""설정 로딩: config.yaml 을 기본값 위에 덮어씁니다."""
from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Dict

import yaml

ROOT = Path(__file__).resolve().parent.parent

DEFAULTS: Dict[str, Any] = {
    "timezone": "Asia/Seoul",
    "blog": {
        "topics_include": ["비즈니스·경제"],   # 실행 시 대화형으로 선택한 카테고리로 매번 덮어씀
        "guidelines": {"photos": 7, "min_chars": 1300, "max_chars": 1900},
    },
    "browser": {"channel": "chrome", "headless": True, "nav_timeout_sec": 30},
    "channels": {
        "naver_home": True, "naver_ranking": True, "nate": True, "google_trends": True,
        "daum": True, "google_news": True, "creator_advisor": False,
    },
    "naver_home": {"url": "https://m.naver.com/", "scroll_times": 20, "analyze_top": 6},
    "naver_ranking": {"analyze_top": 3, "press_rank_max": 5, "include_latest": False, "pages": []},
    "nate": {"keyword_url": "https://www.nate.com/", "pann_url": "https://pann.nate.com/"},
    "google_trends": {"hours": 24, "fresh_hours": 4, "instant_pct": 1000, "categories": {}},
    "daum": {"fresh_minutes": 180, "pages": [], "trend_keywords": True},
    "google_news": {"per_topic": 40, "topics": {}},
    "creator_advisor": {"url": "", "note": ""},
    "filters": {"exclude_politics": True, "negative_hard": [], "negative_soft": [], "politics": [], "ignore_keywords": []},
    "scoring": {
        "per_channel": 10, "trend_1000": 25, "trend_500": 15, "trend_200": 8, "trend_100": 4,
        "fresh_30": 15, "fresh_60": 12, "fresh_180": 8, "fresh_360": 4,
        "naver_rank_top3": 15, "naver_rank_top10": 10, "naver_rank_other": 5,
        "naver_views_50k": 8, "naver_views_30k": 5, "naver_home": 12,
        "naver_press_5": 10, "naver_press_3": 7, "naver_press_2": 4, "naver_headline": 4,
        "nate_top5": 10, "nate_other": 6, "gnews_cluster_5": 5, "gnews_cluster_3": 2,
        "daum_multi_3": 6, "off_topic_penalty": -15, "soft_negative_penalty": -15,
    },
    "llm": {
        "enabled": True, "base_url": "http://127.0.0.1:8080/v1", "model": "default", "api_key": "", "api": "auto", "no_think": "auto", "merge_system": "auto",
        "max_topics": 5, "timeout_sec": 240, "max_tokens": 900, "autostart_cmd": "",
    },
    "report": {"top_n": 7, "keep_days": 90},
}


def _merge(base: Dict[str, Any], over: Dict[str, Any]) -> Dict[str, Any]:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict) and k not in ("categories", "topics"):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load_config(path: str | None = None) -> Dict[str, Any]:
    p = Path(path) if path else ROOT / "config.yaml"
    user: Dict[str, Any] = {}
    if p.exists():
        with open(p, "r", encoding="utf-8") as f:
            user = yaml.safe_load(f) or {}
    cfg = _merge(DEFAULTS, user)
    # YAML 숫자 키를 문자열로 통일 (카테고리 ID)
    cats = cfg["google_trends"].get("categories") or {}
    cfg["google_trends"]["categories"] = {str(k): v for k, v in cats.items()}
    return cfg
