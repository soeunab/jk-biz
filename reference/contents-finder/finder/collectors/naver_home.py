"""1. 네이버 모바일 홈판 (m.naver.com) - 실제 사람들이 클릭 중인 '노출 검증 완료' 글 수집 + 상위 글 구조 분석.

실제 화면(2026-09 기준) 구조를 확인해 작성했습니다:
  - 피드의 각 항목은 data-title / data-url / data-service(BLOG·CAFE·CLIP·TV·CHZZK) / data-channel(작성자) 속성을 가진 요소입니다.
  - 블로그 글은 data-url 이 in.naver.com(인플루언서) 이거나 m.blog.naver.com 이며, 글 번호는 data-cid('아이디_글번호')에 있습니다.
  - 카드 안의 .chf_text 가 '14시간 전' 같은 게시 시각입니다.
구조가 바뀌어 0건이 나오면 리포트 상태표에 진단 정보가 나오고 data/debug/ 에 HTML/스크린샷이 저장됩니다.
"""
from __future__ import annotations

import re
import time
from typing import Any, Dict, List

from ..context import RunContext
from ..models import ChannelResult, Item
from ..util import clean, parse_ago_minutes, summarize_title_patterns
from . import _naver_common as nc

CHANNEL = "naver_home"
LABEL = "네이버 모바일 홈판"

JS_FEED = """
() => {
  const seen = new Map();
  const nodes = [...document.querySelectorAll('[data-title][data-url]')];
  nodes.forEach((el, order) => {
    const url = el.getAttribute('data-url') || '';
    const title = (el.getAttribute('data-title') || '').replace(/\\s+/g, ' ').trim();
    if (!url || !title || seen.has(url)) return;
    const card = el.querySelector('.chf_feed_card') || el.closest('.chf_feed_card');
    let time = '', pages = '';
    if (card) {
      const urls = new Set([...card.querySelectorAll('[data-url]')].map(x => x.getAttribute('data-url')));
      if (urls.size <= 1) {
        const t = card.querySelector('.chf_text'); time = t ? t.innerText.trim() : '';
        const p = card.querySelector('.chf_mw_page'); pages = p ? p.innerText.trim() : '';
      }
    }
    const rk = parseInt(el.getAttribute('data-nlog-imp-rank') || '', 10);
    seen.set(url, {
      url: url, title: title,
      service: el.getAttribute('data-service') || '',
      clip: el.getAttribute('data-is-clip') === 'true',
      channel: el.getAttribute('data-channel') || '',
      channel_url: el.getAttribute('data-channel-url') || '',
      cid: el.getAttribute('data-cid') || '',
      time: time, pages: pages, imp_rank: isNaN(rk) ? null : rk, order: order,
    });
  });
  return [...seen.values()];
}
"""

_CID_RE = re.compile(r"_(\d{6,})$")
_BLOG_ID_RE = re.compile(r"blog\.naver\.com/([\w.-]+)")


def blog_post_url(rec: Dict[str, Any]) -> str:
    """피드 항목에서 분석 가능한 블로그 글 주소(m.blog.naver.com/아이디/글번호)를 만든다."""
    if rec.get("service") != "BLOG":
        return ""
    url = rec.get("url", "")
    if "blog.naver.com" in url:
        return nc.to_mobile_blog_url(url)
    m_id = _BLOG_ID_RE.search(rec.get("channel_url", ""))
    m_no = _CID_RE.search(rec.get("cid", ""))
    if m_id and m_no:
        return "https://m.blog.naver.com/%s/%s" % (m_id.group(1), m_no.group(1))
    return ""


def collect(rc: RunContext) -> ChannelResult:
    t0 = time.time()
    res = ChannelResult(channel=CHANNEL, label=LABEL)
    cfg = rc.cfg["naver_home"]
    page = rc.bs.new_page(mobile=True)

    try:
        rc.bs.goto(page, cfg["url"], settle_ms=3000)
        rc.bs.scroll(page, times=int(cfg.get("scroll_times", 20)), step=1300, wait_ms=900)
        feed = page.evaluate(JS_FEED) or []
    except Exception as e:
        res.error = "네이버 모바일 홈 접속/스크롤 실패: %s" % str(e).splitlines()[0]
        rc.bs.dump(page, "naver_home_error", force=True)
        res.seconds = time.time() - t0
        return res

    if not feed:
        try:
            hist = page.evaluate(nc.JS_HOST_HISTOGRAM)
        except Exception:
            hist = []
        res.error = "홈판에서 피드 항목(data-title/data-url)을 찾지 못했습니다. 네이버가 화면 구조를 바꿨을 수 있습니다."
        res.notes.append("링크 도메인 분포(진단용): %s" % ", ".join("%s×%s" % (h, c) for h, c in hist))
        res.notes.append("data/debug/naver_home_empty.html / .png 를 확인하세요.")
        rc.bs.dump(page, "naver_home_empty", force=True)
        res.seconds = time.time() - t0
        return res
    rc.bs.dump(page, "naver_home")

    feed.sort(key=lambda r: (r.get("imp_rank") if r.get("imp_rank") is not None else 10 ** 6, r.get("order", 0)))
    items: List[Item] = []
    for idx, r in enumerate(feed, 1):
        title = clean(r.get("title"))
        if not title:
            continue
        svc = r.get("service") or ("CLIP" if r.get("clip") else "")
        it = Item(channel=CHANNEL, source="네이버 모바일 홈판", title=title, url=r["url"], rank=idx,
                  press=r.get("channel", ""), age_minutes=parse_ago_minutes(r.get("time")),
                  extra={"service": svc, "clip": bool(r.get("clip")), "pages": r.get("pages", ""),
                         "post_url": blog_post_url(r)})
        if svc != "BLOG":
            it.extra["supplementary"] = True     # 쇼츠/영상은 소재 교차검증(그룹핑)에서 제외하고 참고용으로만 표시
        items.append(it)

    # 상위 블로그 글 열어서 구조 분석
    posts: List[Dict[str, Any]] = []
    analyze_n = int(cfg.get("analyze_top", 6))
    blog_items = [i for i in items if i.extra.get("post_url")]
    for it in blog_items[:analyze_n]:
        d = nc.analyze_blog_post(rc.bs, page, it.extra["post_url"])
        d["feed_title"] = it.title
        d["feed_rank"] = it.rank
        d["blogger"] = it.press
        d["orig_url"] = it.url
        posts.append(d)
        it.extra["post"] = {k: d.get(k) for k in ("chars", "images", "segments", "first_image_after_chars", "found")}

    svc_count: Dict[str, int] = {}
    for i in items:
        svc_count[i.extra["service"] or "기타"] = svc_count.get(i.extra["service"] or "기타", 0) + 1
    res.items = items
    res.ok = True
    res.analysis = {
        "posts": posts,
        "summary": nc.summarize_posts(posts),
        "title_patterns": summarize_title_patterns([i.title for i in blog_items] or [i.title for i in items]),
        "blog_links": len(blog_items),
        "total_links": len(items),
        "services": svc_count,
    }
    if analyze_n and not blog_items:
        res.notes.append("홈판 항목 %d개 중 블로그 글이 없어 본문 구조 분석은 건너뜀" % len(items))
    res.seconds = time.time() - t0
    return res
