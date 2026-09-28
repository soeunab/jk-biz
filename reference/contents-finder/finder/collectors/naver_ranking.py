"""2. 네이버 랭킹 뉴스.

실제 화면(2026-09 기준)을 확인해 페이지 유형별로 작성했습니다.
  - entertain : 엔터 '많이 본 뉴스' (m.entertain.naver.com/ranking). 조회수(예: 70,294)가 표시되는 유일한 순위.
  - press     : 뉴스 랭킹(종합) news.naver.com/main/ranking/popularDay.naver. 언론사별 '많이 본 뉴스' 상위 5건 (조회수는 표시 안 됨).
                → 같은 이슈가 여러 언론사 랭킹에 동시에 올라 있으면 '큰 이슈'라는 신호로 씁니다.
  - section   : 섹션 페이지(news.naver.com/section/10x)의 헤드라인. 내 블로그 주제 섹션별로 편집된 주요 기사.
각 항목의 extra['kind'] 는 ent_rank / press_rank / section_headline 이며, 점수 계산에서 종류별로 다르게 취급합니다.
"""
from __future__ import annotations

import re
import time
from typing import Any, Dict, List

from ..context import RunContext
from ..models import ChannelResult, Item
from ..util import clean, parse_ago_minutes, parse_count, summarize_title_patterns
from . import _naver_common as nc

CHANNEL = "naver_ranking"
LABEL = "네이버 랭킹 뉴스"

JS_ENTERTAIN = """
() => [...document.querySelectorAll('li[class*="NewsItem_news_item"]')].map((li, i) => {
  const a = li.querySelector('a[href*="/article/"]');
  const t = li.querySelector('[class*="NewsItem_title"]');
  const v = li.querySelector('[class*="NewsItem_view"]');
  const d = li.querySelector('[class*="NewsItem_description"]');
  const rk = li.querySelector('[class*="rank_area"] .blind');
  const txt = e => e ? (e.innerText || e.textContent || '').replace(/\\s+/g, ' ').trim() : '';
  return {url: a ? a.href : '', title: txt(t), views: txt(v), desc: txt(d), rank: txt(rk), order: i};
}).filter(r => r.url && r.title)
"""

JS_PRESS = """
() => [...document.querySelectorAll('div.rankingnews_box')].flatMap(box => {
  const nm = box.querySelector('.rankingnews_name');
  const press = nm ? nm.innerText.trim() : '';
  return [...box.querySelectorAll('ul.rankingnews_list > li')].map(li => {
    const a = li.querySelector('a.list_title');
    const n = li.querySelector('.list_ranking_num');
    const tm = li.querySelector('.list_time');
    return {press: press, url: a ? a.href : '', title: a ? (a.innerText || '').replace(/\\s+/g, ' ').trim() : '',
            rank: n ? parseInt(n.innerText, 10) : null, time: tm ? tm.innerText.trim() : ''};
  });
}).filter(r => r.url && r.title)
"""

JS_SECTION = """
() => {
  const grab = (root, kind) => [...root.querySelectorAll('li.sa_item')].map((li, i) => {
    const a = li.querySelector('a.sa_text_title');
    const s = li.querySelector('.sa_text_strong');
    const p = li.querySelector('.sa_text_press');
    const tm = li.querySelector('.sa_text_datetime');
    return {kind: kind, url: a ? a.href : '', title: s ? (s.innerText || '').replace(/\\s+/g, ' ').trim() : '',
            press: p ? p.innerText.trim() : '', time: tm ? tm.innerText.trim() : '', order: i};
  }).filter(r => r.url && r.title);
  const head = document.querySelector('.as_section_headline');
  const late = document.querySelector('.section_latest_article');
  return {headline: head ? grab(head, 'headline') : [], latest: late ? grab(late, 'latest') : []};
}
"""

_ART_RE = re.compile(r"article/(\d{3})/(\d{6,12})")


def article_url(url: str) -> str:
    """분석용으로 어느 화면 주소든 n.news.naver.com/article/{언론사}/{기사번호} 로 통일 (본문 구조가 가장 단순)."""
    m = _ART_RE.search(url or "")
    return "https://n.news.naver.com/article/%s/%s" % (m.group(1), m.group(2)) if m else url


def _views(text: str):
    t = re.sub(r"조회수?", "", text or "")
    return parse_count(t.strip()) if re.search(r"\d", t) else None


def _dedupe(rows: List[Dict[str, Any]], seen: set) -> List[Dict[str, Any]]:
    out = []
    for r in rows:
        m = _ART_RE.search(r.get("url", ""))
        key = "%s_%s" % (m.group(1), m.group(2)) if m else r.get("url")
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def collect(rc: RunContext) -> ChannelResult:
    t0 = time.time()
    res = ChannelResult(channel=CHANNEL, label=LABEL)
    cfg = rc.cfg["naver_ranking"]
    page = rc.bs.new_page(mobile=False)
    items: List[Item] = []
    analysis: Dict[str, Any] = {"articles": [], "pages": {}}
    press_max = int(cfg.get("press_rank_max", 5))
    default_top = int(cfg.get("analyze_top", 3))

    for pg in cfg.get("pages", []):
        name, url, cat = pg.get("name", ""), pg["url"], pg.get("category", "")
        ptype = pg.get("type") or ("entertain" if "entertain" in url else "section" if "/section/" in url else "press")
        analyze_n = int(pg.get("analyze_top", default_top))
        try:
            rc.bs.goto(page, url, settle_ms=2500)
            page_items: List[Item] = []
            if ptype == "entertain":
                rows = _dedupe(page.evaluate(JS_ENTERTAIN) or [], set())
                for r in rows:
                    m = re.search(r"\d+", r.get("rank", ""))
                    rank = int(m.group()) if m else len(page_items) + 1
                    page_items.append(Item(channel=CHANNEL, source=name, title=clean(r["title"]), url=r["url"], rank=rank,
                                           category=cat, views=_views(r.get("views", "")),
                                           extra={"kind": "ent_rank", "desc": clean(r.get("desc", ""))[:90]}))
            elif ptype == "press":
                rows = page.evaluate(JS_PRESS) or []
                for r in rows:
                    if r.get("rank") and r["rank"] > press_max:
                        continue
                    page_items.append(Item(channel=CHANNEL, source=name, title=clean(r["title"]), url=r["url"], rank=r.get("rank"),
                                           category=cat, press=r.get("press", ""), age_minutes=parse_ago_minutes(r.get("time")),
                                           extra={"kind": "press_rank"}))
            else:  # section
                data = page.evaluate(JS_SECTION) or {}
                rows = _dedupe(data.get("headline", []), set())
                for i, r in enumerate(rows, 1):
                    page_items.append(Item(channel=CHANNEL, source=name, title=clean(r["title"]), url=r["url"], rank=i,
                                           category=cat, press=r.get("press", ""), age_minutes=parse_ago_minutes(r.get("time")),
                                           extra={"kind": "section_headline"}))
                if cfg.get("include_latest"):
                    seen_h = {it.url for it in page_items}
                    for i, r in enumerate(data.get("latest", []), 1):
                        if r["url"] in seen_h:
                            continue
                        page_items.append(Item(channel=CHANNEL, source=name + " 최신", title=clean(r["title"]), url=r["url"], rank=i,
                                               category=cat, press=r.get("press", ""), age_minutes=parse_ago_minutes(r.get("time")),
                                               extra={"kind": "section_latest"}))
            if not page_items:
                res.notes.append("%s: 기사 0건 (data/debug 확인)" % name)
                rc.bs.dump(page, "naver_ranking_" + name, force=True)
                continue
            rc.bs.dump(page, "naver_ranking_" + name)
            items.extend(page_items)
            analysis["pages"][name] = {
                "type": ptype,
                "count": len(page_items),
                "with_views": sum(1 for i in page_items if i.views),
                "title_patterns": summarize_title_patterns([i.title for i in page_items[:30]]),
            }
            # 상위 기사 본문 분량/사진 수 확인 (제목에 붙은 조회수/순위와 함께 표에 표시)
            for it in page_items[:analyze_n]:
                d = nc.analyze_news_article(rc.bs, page, article_url(it.url))
                d["source"] = name
                d["rank"] = it.rank
                d["views"] = it.views
                d["list_title"] = it.title
                d["orig_url"] = it.url
                analysis["articles"].append(d)
                it.extra["article"] = {k: d.get(k) for k in ("chars", "images", "found")}
        except Exception as e:
            res.notes.append("%s 수집 실패: %s" % (name, str(e).splitlines()[0]))
            rc.bs.dump(page, "naver_ranking_error_" + name, force=True)

    res.items = items
    res.ok = bool(items)
    res.analysis = analysis
    if not res.ok:
        res.error = "네이버 랭킹 기사를 가져오지 못했습니다."
    res.seconds = time.time() - t0
    return res
