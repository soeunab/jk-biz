"""3. 네이트 - 실시간 이슈 키워드 / 판 Top랭킹 / 급상승 관심뉴스 (2026-09 실제 DOM 확인 후 작성)."""
from __future__ import annotations

import time
from typing import List

from ..context import RunContext
from ..models import ChannelResult, Item
from ..util import clean

CHANNEL = "nate"
LABEL = "네이트 실시간 이슈"

# nate.com: '실시간 이슈 키워드' (순위 1~5, 6~10 이 두 개의 ol 로 나뉘어 있음)
JS_KEYWORDS = """
() => [...document.querySelectorAll('.isKeyword li')].map(li => {
  const rank = parseInt((li.querySelector('.num_rank') || {}).textContent || '0', 10);
  const a = li.querySelector('a');
  const kw = (li.querySelector('.txt_rank') || {}).textContent || '';
  const fc = li.querySelector('.fc');
  const cls = fc ? fc.className : '';
  const change = /new/.test(cls) ? 'new' : /up/.test(cls) ? 'up' : /down/.test(cls) ? 'down' : 'same';
  const delta = fc ? (fc.textContent || '').replace(/[^0-9]/g, '') : '';
  return {rank: rank, keyword: kw.trim(), url: a ? a.href : '', change: change, delta: delta};
})
"""

# pann.nate.com: 우측 '실시간 급상승 관심뉴스' (시사/스포츠/연예 탭)
JS_HOT_NEWS = """
() => {
  const out = [];
  document.querySelectorAll('#divHotNews [id^="news_div"]').forEach(div => {
    const tab = parseInt(div.id.replace('news_div', ''), 10) || 0;
    div.querySelectorAll('li').forEach(li => {
      const a = li.querySelector('a[href]');
      if (!a) return;
      const rank = parseInt((li.querySelector('strong') || {}).textContent || '0', 10);
      const i = li.querySelector('i');
      out.push({tab: tab, rank: rank, title: (a.getAttribute('title') || a.textContent || '').trim(),
                url: a.href, change: i ? i.className : ''});
    });
  });
  return out;
}
"""

# nate.com 메인의 '판 Top랭킹' (#pannList ol.rank li: 순위/댓글수/제목/링크, 20개)
JS_PANN_LIST = """
() => [...document.querySelectorAll('#pannList ol.rank > li')].map(li => {
  const a = li.querySelector('a.link') || li.querySelector('a[href*="/talk/"]');
  const r = parseInt((li.querySelector('.num_rank') || {}).textContent || '0', 10);
  const c = (li.querySelector('.emph') || {}).textContent || '';
  const m = c.match(/\\((\\d+)\\)/);
  return {rank: r, title: a ? a.textContent.trim() : '', url: a ? a.href : '', comments: m ? parseInt(m[1], 10) : null};
})
"""

TAB_LABEL = {1: "시사", 2: "스포츠", 3: "연예"}


def collect(rc: RunContext) -> ChannelResult:
    t0 = time.time()
    res = ChannelResult(channel=CHANNEL, label=LABEL)
    cfg = rc.cfg["nate"]
    page = rc.bs.new_page(mobile=False)
    items: List[Item] = []

    # 1) 실시간 이슈 키워드 (핵심) - 위젯이 1~5위 / 6~10위를 번갈아 보여주므로 여러 번 샘플링해서 합친다
    try:
        rc.bs.goto(page, cfg["keyword_url"], settle_ms=1200)
        by_rank = {}
        for _ in range(12):
            for r in page.evaluate(JS_KEYWORDS) or []:
                if r.get("keyword") and r.get("rank"):
                    by_rank.setdefault(r["rank"], r)
            if len(by_rank) >= 10:
                break
            page.wait_for_timeout(1200)
        for rank in sorted(by_rank):
            r = by_rank[rank]
            items.append(Item(channel=CHANNEL, source="네이트 실시간 이슈 키워드", title=clean(r["keyword"]),
                              url=r.get("url", ""), rank=rank,
                              extra={"change": r.get("change"), "delta": r.get("delta")}))
        if len(by_rank) < 10:
            res.notes.append("이슈 키워드 %d/10건만 수집" % len(by_rank))
        if not by_rank:
            rc.bs.dump(page, "nate_keywords", force=True)
        # 같은 페이지의 '판 Top랭킹'
        for r in page.evaluate(JS_PANN_LIST) or []:
            if r.get("title"):
                items.append(Item(channel=CHANNEL, source="네이트 판 Top랭킹", title=clean(r["title"]), url=r.get("url", ""),
                                  rank=r.get("rank") or None, extra={"comments": r.get("comments"), "community": True}))
        rc.bs.dump(page, "nate_main")
    except Exception as e:
        res.notes.append("이슈 키워드 수집 실패: %s" % str(e).splitlines()[0])
        rc.bs.dump(page, "nate_keywords_error", force=True)

    # 2) 판 메인: 급상승 관심뉴스 + 인기글
    try:
        rc.bs.goto(page, cfg["pann_url"], settle_ms=1500)
        for tab_id in (2, 3):        # 스포츠/연예 탭은 마우스를 올려야 로딩됨
            try:
                page.hover("#news_tab%d" % tab_id, timeout=3000)
                page.wait_for_timeout(500)
            except Exception:
                pass
        hot = page.evaluate(JS_HOT_NEWS) or []
        seen = set()
        for r in hot:
            if not r.get("title") or r["url"] in seen:
                continue
            seen.add(r["url"])
            tab = TAB_LABEL.get(r.get("tab"), str(r.get("tab")))
            cat = "스포츠" if tab == "스포츠" else ""   # 연예 탭은 기사별 키워드 분류에 맡김 (드라마/스타·연예인/방송 등으로 세분)
            items.append(Item(channel=CHANNEL, source="네이트 실시간 급상승 관심뉴스(%s)" % tab, title=clean(r["title"]),
                              url=r["url"], rank=r.get("rank") or None, category=cat,
                              extra={"change": r.get("change", "")}))
        rc.bs.dump(page, "nate_pann")
    except Exception as e:
        res.notes.append("판 수집 실패: %s" % str(e).splitlines()[0])
        rc.bs.dump(page, "nate_pann_error", force=True)

    res.items = items
    res.ok = any(i.source == "네이트 실시간 이슈 키워드" for i in items)
    if not res.ok:
        res.error = "실시간 이슈 키워드를 가져오지 못했습니다."
    res.seconds = time.time() - t0
    return res
