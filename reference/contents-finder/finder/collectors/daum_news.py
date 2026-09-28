"""5-a. 다음 뉴스 - 이 시각 주요뉴스 / 카테고리별 기사 '몇 분 전' + 실시간 트렌드 키워드 (2026-09 실제 DOM 확인 후 작성)."""
from __future__ import annotations

import time
from typing import List
from urllib.parse import parse_qs, urlparse

from ..context import RunContext
from ..models import ChannelResult, Item
from ..util import clean, parse_ago_minutes

CHANNEL = "daum"
LABEL = "다음 뉴스"

JS_ARTICLES = """
() => {
  const seen = new Set();
  const out = [];
  document.querySelectorAll('a[href*="v.daum.net/v/"]').forEach(a => {
    if (seen.has(a.href)) return;
    seen.add(a.href);
    const t = a.querySelector('.tit_txt') || a.querySelector('strong') || a;
    out.push({url: a.href,
              title: (t.textContent || '').replace(/\\s+/g, ' ').trim(),
              infos: [...a.querySelectorAll('.txt_info')].map(e => e.textContent.trim())});
  });
  return out;
}
"""

JS_TRENDS = """
() => {
  const h = [...document.querySelectorAll('h2,h3,strong')].find(e => e.textContent.trim() === '실시간 트렌드');
  if (!h) return [];
  let box = h.parentElement;
  for (let i = 0; i < 5 && box; i++) {
    const as = [...box.querySelectorAll('a')].filter(a => /\\d+위/.test(a.textContent));
    if (as.length >= 5) return as.map(a => ({text: a.textContent.replace(/\\s+/g, ' ').trim(), href: a.href}));
    box = box.parentElement;
  }
  return [];
}
"""


def _parse_trend_text(text: str):
    """'1위, 트럼프 대이란 대응 , 신규' -> (1, '트럼프 대이란 대응', '신규')"""
    parts = [p.strip() for p in text.split(",")]
    try:
        rank = int(parts[0].replace("위", "").strip())
    except Exception:
        return None
    if len(parts) < 2:
        return None
    return rank, parts[1], (parts[2] if len(parts) > 2 else "")


def collect(rc: RunContext) -> ChannelResult:
    t0 = time.time()
    res = ChannelResult(channel=CHANNEL, label=LABEL)
    cfg = rc.cfg["daum"]
    page = rc.bs.new_page(mobile=False)
    items: List[Item] = []
    by_url = {}

    for pg in cfg.get("pages", []):
        name, url, cat = pg.get("name", ""), pg["url"], pg.get("category", "")
        try:
            rc.bs.goto(page, url, settle_ms=1800)
            rows = page.evaluate(JS_ARTICLES) or []
            n_new = 0
            for idx, r in enumerate(rows, 1):
                if not r["title"]:
                    continue
                if r["url"] in by_url:                 # 이미 다른 페이지에서 수집됨 -> 건너뜀
                    # 주의: 여기서 카테고리를 덮어쓰지 않는다. 섹션 페이지(다음 경제/IT 등)에는
                    # 사이드바 '많이 본 뉴스' 같은 사이트 전체 인기 위젯이 섞여 있어서, 그 섹션과
                    # 무관한 기사(예: 연예 기사)까지 잘못 그 섹션 카테고리로 태깅되는 문제가 있었다.
                    # 카테고리는 그 기사가 처음 발견된 페이지 기준만 쓰고, 없으면 제목 키워드 기반
                    # 자동 분류(finder.analysis.filters.classify_text)에 맡긴다.
                    continue
                infos = r.get("infos", [])
                press = infos[0] if infos else ""
                age = None
                for x in infos:
                    a = parse_ago_minutes(x)
                    if a is not None:
                        age = a
                it = Item(channel=CHANNEL, source=name, title=clean(r["title"]), url=r["url"], rank=idx,
                          category=cat, age_minutes=age, press=press)
                by_url[r["url"]] = it
                items.append(it)
                n_new += 1
            if n_new == 0:
                res.notes.append("%s: 기사 0건" % name)
                rc.bs.dump(page, "daum_" + name, force=True)
            else:
                rc.bs.dump(page, "daum_" + name)

            if cfg.get("trend_keywords") and url.rstrip("/").endswith("news.daum.net"):
                for t in page.evaluate(JS_TRENDS) or []:
                    p = _parse_trend_text(t["text"])
                    if not p:
                        continue
                    rank, kw, chg = p
                    items.append(Item(channel=CHANNEL, source="다음 실시간 트렌드", title=clean(kw), url=t.get("href", ""),
                                      rank=rank, extra={"change": chg, "keyword_only": True}))
        except Exception as e:
            res.notes.append("%s 수집 실패: %s" % (name, str(e).splitlines()[0]))
            rc.bs.dump(page, "daum_error_" + name, force=True)

    res.items = items
    res.ok = any(i.source != "다음 실시간 트렌드" for i in items)
    if not res.ok:
        res.error = "다음 뉴스 기사를 가져오지 못했습니다."
    res.seconds = time.time() - t0
    return res
