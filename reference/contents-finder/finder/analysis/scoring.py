"""그룹(소재)별 점수화와 근거 문장 생성."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..models import Item
from ..util import fmt_ago, fmt_count
from .crossref import Group
from .filters import flag_text, resolve_category

MAIN_CHANNELS = ["naver_home", "naver_ranking", "nate", "google_trends", "daum", "google_news"]
CHANNEL_LABEL = {
    "naver_home": "네이버 홈판", "naver_ranking": "네이버 랭킹", "nate": "네이트", "google_trends": "구글 트렌드",
    "daum": "다음", "google_news": "구글 뉴스", "creator_advisor": "크리에이터 어드바이저",
}


def _min(vals: List[Optional[int]]) -> Optional[int]:
    v = [x for x in vals if x is not None]
    return min(v) if v else None


def compute_metrics(g: Group) -> Dict[str, Any]:
    items = g.items
    by = lambda ch: [i for i in items if i.channel == ch]
    trends = by("google_trends")
    nate = [i for i in by("nate") if i.source == "네이트 실시간 이슈 키워드"]
    nate_news = [i for i in by("nate") if i.source != "네이트 실시간 이슈 키워드"]
    nav = by("naver_ranking")
    rank_items = [i for i in nav if i.extra.get("kind") == "ent_rank"]          # 조회수가 표시되는 엔터 랭킹
    press_items = [i for i in nav if i.extra.get("kind") == "press_rank"]       # 언론사별 랭킹(종합)
    head_items = [i for i in nav if i.extra.get("kind") == "section_headline"]  # 섹션 헤드라인
    home = [i for i in by("naver_home") if i.extra.get("service") != "CLIP"]
    gn = by("google_news")
    daum = by("daum")

    fresh_candidates = [i.age_minutes for i in daum + gn + trends if i.age_minutes is not None]
    return {
        "channels": [c for c in MAIN_CHANNELS if by(c)],
        "trend_pct": max([i.growth_pct for i in trends if i.growth_pct is not None], default=None),
        "trend_started_min": _min([i.age_minutes for i in trends]),
        "trend_volume": max([i.volume for i in trends if i.volume is not None], default=None),
        "trend_fresh": any(i.extra.get("fresh") for i in trends),
        "newest_age": min(fresh_candidates) if fresh_candidates else None,
        "naver_best_rank": _min([i.rank for i in rank_items]),
        "naver_max_views": max([i.views for i in rank_items if i.views], default=None),
        "home_hit": bool(home),
        "press_hits": len({i.press for i in press_items if i.press}),
        "press_best_rank": _min([i.rank for i in press_items]),
        "headline_hits": len({i.url for i in head_items}),
        "nate_rank": _min([i.rank for i in nate]),
        "nate_change": (nate[0].extra.get("change") if nate else None),
        "nate_news_hit": bool(nate_news),
        "gnews_cluster": max([i.cluster_size for i in gn if i.cluster_size], default=None),
        "daum_count": len({i.url or i.title for i in daum if i.source != "다음 실시간 트렌드"}),
        "daum_trend_rank": _min([i.rank for i in daum if i.source == "다음 실시간 트렌드"]),
    }


def score_group(g: Group, cfg: Dict[str, Any]) -> None:
    w = cfg["scoring"]
    m = compute_metrics(g)
    g.metrics = m
    score = 0
    why: List[str] = []

    n_ch = min(len(m["channels"]), 5)
    if n_ch:
        score += n_ch * w["per_channel"]
        if len(m["channels"]) >= 2:
            why.append("%d개 채널에서 동시 확인(%s)" % (len(m["channels"]), ", ".join(CHANNEL_LABEL[c] for c in m["channels"])))

    pct = m["trend_pct"]
    if pct is not None:
        started = fmt_ago(m["trend_started_min"])
        if pct >= 1000:
            score += w["trend_1000"]; why.append("구글 트렌드 검색량 %s%%↑ (%s부터) → 당일 즉시 소재" % (format(pct, ","), started))
        elif pct >= 500:
            score += w["trend_500"]; why.append("구글 트렌드 검색량 %s%%↑ (%s부터)" % (format(pct, ","), started))
        elif pct >= 200:
            score += w["trend_200"]; why.append("구글 트렌드 검색량 %s%%↑ (%s부터)" % (format(pct, ","), started))
        elif pct >= 100:
            score += w["trend_100"]; why.append("구글 트렌드 검색량 %s%%↑ (%s부터)" % (format(pct, ","), started))
    if m["trend_fresh"]:
        why.append("최근 %d시간 안에 시작된 초신선 키워드" % cfg["google_trends"].get("fresh_hours", 4))

    age = m["newest_age"]
    if age is not None:
        if age <= 30:
            score += w["fresh_30"]
        elif age <= 60:
            score += w["fresh_60"]
        elif age <= 180:
            score += w["fresh_180"]
        elif age <= 360:
            score += w["fresh_360"]
        if age <= 360:
            why.append("가장 최근 기사 %s (다른 블로거가 아직 덜 다뤘을 가능성)" % fmt_ago(age))

    br = m["naver_best_rank"]
    if br is not None:
        if br <= 3:
            score += w["naver_rank_top3"]
        elif br <= 10:
            score += w["naver_rank_top10"]
        else:
            score += w["naver_rank_other"]
        why.append("네이버 엔터 랭킹 %d위%s" % (br, (" · 조회수 %s" % fmt_count(m["naver_max_views"])) if m["naver_max_views"] else ""))
    mv = m["naver_max_views"]
    if mv:
        if mv >= 50_000:
            score += w["naver_views_50k"]
        elif mv >= 30_000:
            score += w["naver_views_30k"]
    ph = m["press_hits"]
    if ph:
        if ph >= 5:
            score += w["naver_press_5"]
        elif ph >= 3:
            score += w["naver_press_3"]
        elif ph >= 2:
            score += w["naver_press_2"]
        if ph >= 2:
            why.append("네이버 언론사 랭킹 %d곳에 동시에 오름(최고 %d위)" % (ph, m["press_best_rank"] or 0))
        else:
            why.append("네이버 언론사 랭킹 진입(%d위)" % (m["press_best_rank"] or 0))
    if m["headline_hits"]:
        score += w["naver_headline"]
        why.append("네이버 섹션 헤드라인 노출")
    if m["home_hit"]:
        score += w["naver_home"]
        why.append("네이버 모바일 홈판 노출 확인 (실제 클릭 검증)")
    if m["nate_rank"] is not None:
        score += w["nate_top5"] if m["nate_rank"] <= 5 else w["nate_other"]
        why.append("네이트 실시간 이슈 키워드 %d위" % m["nate_rank"])
    if m["daum_trend_rank"] is not None:
        why.append("다음 실시간 트렌드 %d위" % m["daum_trend_rank"])
    gc = m["gnews_cluster"]
    if gc and gc >= 5:
        score += w["gnews_cluster_5"]; why.append("구글 뉴스 같은 사건 기사 5건 이상 묶임(여러 매체가 동시에 보도)")
    elif gc and gc >= 3:
        score += w["gnews_cluster_3"]; why.append("구글 뉴스 같은 사건 기사 %d건 묶임" % gc)
    if m["daum_count"] >= 3:
        score += w["daum_multi_3"]; why.append("다음에 서로 다른 제목의 기사 %d건 (트래픽 커지는 중)" % m["daum_count"])

    # 카테고리 / 주제 적합성
    votes: List[str] = []
    for i in g.items:
        if i.category:
            votes.append(i.category)
        votes.extend(i.extra.get("categories", []) or [])
    text = " ".join(i.title for i in g.items)
    g.category = resolve_category(votes, text)
    include = set(cfg["blog"]["topics_include"])
    off_topic = g.category not in include
    if off_topic:
        score += w["off_topic_penalty"]
        why.append("내 블로그 주제 밖(%s) - 감점" % g.category)

    # 필터
    flags = flag_text(text, cfg["filters"])
    g.flags = flags
    if flags["soft"]:
        score += w["soft_negative_penalty"]
        why.append("논란성 표현 포함(%s) - 감점" % ", ".join(flags["soft"][:3]))
    if flags["hard"]:
        g.excluded_reason = "부정적 사건/이슈 키워드: %s" % ", ".join(flags["hard"][:4])
    elif cfg["filters"].get("exclude_politics") and flags["politics"]:
        g.excluded_reason = "정치 이슈 (블로그 주제 밖): %s" % ", ".join(flags["politics"][:3])

    # 선점 후보: 네이트/트렌드/다음에서는 보이는데 네이버 랭킹·홈판엔 아직 없음
    early = any(c in m["channels"] for c in ("nate", "google_trends", "daum"))
    on_naver = m["home_hit"] or br is not None or bool(m["press_hits"]) or bool(m["headline_hits"])
    m["preempt"] = bool(early and not on_naver and (age is None or age <= 360))
    if m["preempt"]:
        why.append("선점 후보: 네이버 랭킹/홈판에는 아직 없음")

    g.score = max(0, min(100, score))
    g.reasons = why
