"""4. 구글 트렌드 - 실시간 인기(Trending now) + 카테고리별 태깅 (2026-09 실제 DOM 확인 후 작성)."""
from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from ..context import RunContext
from ..models import ChannelResult, Item
from ..util import clean, parse_ago_minutes, parse_count, parse_pct

CHANNEL = "google_trends"
LABEL = "구글 트렌드"

URL = "https://trends.google.com/trending?geo=KR&hl=ko&hours=%d"

JS_ROWS = """
() => [...document.querySelectorAll('tr[data-row-id]')].map(tr =>
  tr.innerText.split(/\\n+/).map(s => s.trim()).filter(Boolean))
"""

JS_MENU_COUNTS = """
() => {
  const m = [...document.querySelectorAll('[role="menu"]')].find(m => (m.getAttribute('aria-label') || '').includes('카테고리'));
  if (!m) return {};
  const o = {};
  m.querySelectorAll('[data-value]').forEach(e => {
    const t = e.innerText.split(/\\n+/).map(s => s.trim());
    const n = parseInt(t[1], 10);
    o[e.getAttribute('data-value')] = isNaN(n) ? 0 : n;
  });
  return o;
}
"""

_ICONS = {"trending_up", "timelapse", "arrow_upward", "arrow_downward", "trending_flat", "trending_down"}
_VOL_RE = re.compile(r"^[\d.,]+\s*(천|만|억)?\+?$")


def parse_trend_row(lines: List[str]) -> Optional[Dict[str, Any]]:
    """['이현중','5천+','arrow_upward','1,000%','12시간 전','trending_up','활성','아시안게임 농구', ..., '외 5개'] -> dict"""
    lines = [l for l in lines if l]
    if not lines:
        return None
    kw = lines[0]
    volume = pct = started = None
    status = ""
    related: List[str] = []
    for ln in lines[1:]:
        if ln in _ICONS or re.fullmatch(r"외 \d+개", ln):
            continue
        if volume is None and _VOL_RE.match(ln):
            volume = parse_count(ln)
            continue
        if pct is None and re.fullmatch(r"[\d,]+%", ln):
            pct = parse_pct(ln)
            continue
        if started is None and re.search(r"\d+\s*(분|시간|일)\s*전", ln) and "동안" not in ln:
            started = parse_ago_minutes(ln)
            continue
        if ln == "활성" or "지속됨" in ln:
            status = ln
            continue
        related.append(ln)
    return {"keyword": kw, "volume": volume, "pct": pct, "started_min": started, "status": status, "related": related}


def _read_rows(page) -> List[Dict[str, Any]]:
    rows = page.evaluate(JS_ROWS) or []
    out = []
    for lines in rows:
        r = parse_trend_row(lines)
        if r and r["keyword"]:
            out.append(r)
    return out


def collect(rc: RunContext) -> ChannelResult:
    t0 = time.time()
    res = ChannelResult(channel=CHANNEL, label=LABEL)
    cfg = rc.cfg["google_trends"]
    page = rc.bs.new_page(mobile=False)

    try:
        rc.bs.goto(page, URL % int(cfg.get("hours", 24)), settle_ms=2500)
        try:
            page.wait_for_selector("tr[data-row-id]", timeout=15000)
        except Exception:
            pass
        base = _read_rows(page)
    except Exception as e:
        res.error = "구글 트렌드 접속 실패: %s" % str(e).splitlines()[0]
        rc.bs.dump(page, "google_trends_error", force=True)
        res.seconds = time.time() - t0
        return res

    if not base:
        res.error = "트렌드 행을 찾지 못했습니다 (화면 구조 변경 또는 로딩 지연)."
        rc.bs.dump(page, "google_trends_empty", force=True)
        res.seconds = time.time() - t0
        return res
    rc.bs.dump(page, "google_trends")

    by_kw: Dict[str, Item] = {}
    for i, r in enumerate(base, 1):
        it = Item(channel=CHANNEL, source="구글 트렌드 실시간 인기(%d시간)" % int(cfg.get("hours", 24)),
                  title=clean(r["keyword"]), url="https://trends.google.com/trends/explore?q=%s&geo=KR" % quote(r["keyword"]),
                  rank=i, volume=r["volume"], growth_pct=r["pct"], age_minutes=r["started_min"],
                  extra={"status": r["status"], "related": r["related"], "categories": []})
        by_kw[it.title] = it

    # 카테고리별 태깅 (진짜 클릭이 필요: 스크립트 click() 은 반영되지 않음)
    cats: Dict[str, str] = cfg.get("categories", {}) or {}
    try:
        import re as _re
        btn = page.get_by_role("button", name=_re.compile("카테고리 선택"))
        btn.first.click()
        page.wait_for_timeout(600)
        counts = page.evaluate(JS_MENU_COUNTS) or {}
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        for cid, label in cats.items():
            if not counts.get(str(cid)):
                continue
            done = False
            last_err = ""
            for attempt in (1, 2):
                try:
                    if attempt == 2:      # 첫 시도 실패 시 페이지를 새로 열어 다시 시도
                        rc.bs.goto(page, URL % int(cfg.get("hours", 24)), settle_ms=2500)
                    page.get_by_role("button", name=_re.compile("카테고리 선택")).first.click(timeout=8000)
                    page.wait_for_timeout(500)
                    page.locator('[role="menu"][aria-label*="카테고리"] [data-value="%s"]' % cid).first.click(timeout=8000)
                    page.wait_for_timeout(2200)
                    for r in _read_rows(page):
                        it = by_kw.get(clean(r["keyword"]))
                        if it is None:
                            it = Item(channel=CHANNEL, source="구글 트렌드 실시간 인기(%d시간)" % int(cfg.get("hours", 24)),
                                      title=clean(r["keyword"]), volume=r["volume"], growth_pct=r["pct"],
                                      age_minutes=r["started_min"], extra={"status": r["status"], "related": r["related"], "categories": []})
                            by_kw[it.title] = it
                        it.extra.setdefault("categories", []).append(label)
                        if not it.category:
                            it.category = label
                    done = True
                    break
                except Exception as e:
                    last_err = str(e).splitlines()[0]
                    try:
                        page.keyboard.press("Escape")
                    except Exception:
                        pass
            if not done:
                res.notes.append("카테고리 %s(%s) 태깅 실패: %s" % (cid, label, last_err))
    except Exception as e:
        res.notes.append("카테고리 메뉴 조작 실패(전체 목록만 사용): %s" % str(e).splitlines()[0])

    # 초신선(지난 N시간) 키워드 표시
    fresh_h = int(cfg.get("fresh_hours", 4))
    try:
        rc.bs.goto(page, URL % fresh_h, settle_ms=2200)
        page.wait_for_selector("tr[data-row-id]", timeout=10000)
        for r in _read_rows(page):
            it = by_kw.get(clean(r["keyword"]))
            if it:
                it.extra["fresh"] = True
    except Exception:
        pass

    res.items = list(by_kw.values())
    res.ok = True
    res.seconds = time.time() - t0
    return res
