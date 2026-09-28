"""네이버 채널 공용: 블로그 글/뉴스 기사 본문 구조 분석(제목 구성, 사진 수, 분량, 글을 끊은 위치).

블로그 본문/뉴스 기사 본문 셀렉터는 실제 화면 저장본(2026-09)으로 홈판/랭킹 목록 구조를 확인한 뒤 작성했고,
기사 본문 분량은 n.news.naver.com 기사에서 동작을 확인했습니다. 결과가 비면 data/debug/ 의 HTML/스크린샷으로 셀렉터를 점검하세요.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

from ..util import clean, parse_count

# ---------------------------------------------------------------------------
# 블로그 글 분석 (SmartEditor ONE: .se-main-container > .se-component)
# ---------------------------------------------------------------------------
JS_BLOG_POST = """
() => {
  const root = document.querySelector('.se-main-container') || document.querySelector('#postViewArea')
            || document.querySelector('.post_ct') || document.querySelector('#viewTypeSelector');
  const titleEl = document.querySelector('.se-title-text') || document.querySelector('.tit_h3')
               || document.querySelector('.se_title') || document.querySelector('h3.se_textarea');
  const title = ((titleEl && titleEl.innerText) || document.title || '').replace(/\\s+/g, ' ').trim();
  if (!root) return {found: false, title: title, url: location.href};
  const okImg = im => {
    const src = (im.currentSrc || im.src || im.getAttribute('data-lazy-src') || '');
    if (/sticker|emoticon|static\\.blog|blank|spacer|ssl\\.pstatic\\.net\\/static/i.test(src)) return false;
    return (im.naturalWidth || im.width || 0) >= 80 || /postfiles|blogfiles|phinf/.test(src);
  };
  let mods = [...root.querySelectorAll(':scope > .se-component')];
  if (!mods.length) mods = [root];
  const segs = [];
  let cur = 0, images = 0, total = 0, textBlocks = 0, firstImageAt = null, videos = 0;
  mods.forEach(m => {
    const imgs = [...m.querySelectorAll('img')].filter(okImg);
    const cls = (m.className || '') + '';
    if (/se-video|se-oglink/.test(cls) && !imgs.length) { videos += /se-video/.test(cls) ? 1 : 0; }
    const isImg = imgs.length > 0 && !/se-text/.test(cls);
    if (isImg) {
      if (firstImageAt === null) firstImageAt = total;
      segs.push(cur); cur = 0; images += imgs.length;
    } else {
      const len = ((m.innerText || '').replace(/\\s+/g, ' ').trim()).length;
      if (len > 0) { cur += len; total += len; textBlocks += 1; }
    }
  });
  segs.push(cur);
  const text = (root.innerText || '').replace(/\\s+/g, ' ').trim();
  return {found: true, title: title, url: location.href, chars: text.length, chars_body_text: total,
          chars_no_space: text.replace(/\\s/g, '').length, images: images, segments: segs,
          text_blocks: textBlocks, first_image_after_chars: firstImageAt, videos: videos};
}
"""

# ---------------------------------------------------------------------------
# 뉴스 기사 본문 분량/사진 수
# ---------------------------------------------------------------------------
JS_NEWS_ARTICLE = """
() => {
  const root = document.querySelector('#dic_area') || document.querySelector('#articleBodyContents')
            || document.querySelector('#articeBody') || document.querySelector('._article_content')
            || document.querySelector('#newsEndContents') || document.querySelector('article');
  const tEl = document.querySelector('#title_area') || document.querySelector('.media_end_head_headline')
           || document.querySelector('h2.end_tit') || document.querySelector('h2.title') || document.querySelector('h1');
  const title = ((tEl && tEl.innerText) || document.title || '').replace(/\\s+/g, ' ').trim();
  if (!root) return {found: false, title: title, url: location.href};
  const text = (root.innerText || '').replace(/\\s+/g, ' ').trim();
  const imgs = [...root.querySelectorAll('img')].filter(im => (im.naturalWidth || im.width || 0) >= 120);
  return {found: text.length > 0, title: title, url: location.href, chars: text.length,
          chars_no_space: text.replace(/\\s/g, '').length, images: imgs.length};
}
"""

JS_HOST_HISTOGRAM = """
() => {
  const h = {};
  document.querySelectorAll('a[href]').forEach(a => { try { const u = new URL(a.href); h[u.host] = (h[u.host] || 0) + 1; } catch (e) {} });
  return Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, 12);
}
"""


def to_mobile_blog_url(url: str) -> str:
    """blog.naver.com/{id}/{no} 또는 PostView.naver?blogId=&logNo= -> m.blog.naver.com/{id}/{no}"""
    try:
        u = urlparse(url)
        if "blog.naver.com" not in u.netloc:
            return url
        q = parse_qs(u.query)
        if "blogId" in q and "logNo" in q:
            return "https://m.blog.naver.com/%s/%s" % (q["blogId"][0], q["logNo"][0])
        parts = [p for p in u.path.split("/") if p]
        if len(parts) >= 2 and parts[1].isdigit():
            return "https://m.blog.naver.com/%s/%s" % (parts[0], parts[1])
    except Exception:
        pass
    return url


def analyze_blog_post(bs, page, url: str) -> Dict[str, Any]:
    try:
        bs.goto(page, to_mobile_blog_url(url), settle_ms=2200)
        data = page.evaluate(JS_BLOG_POST) or {}
        if not data.get("found"):
            # 일부 글은 iframe(mainFrame) 안에 본문이 있음
            for fr in page.frames:
                if fr == page.main_frame:
                    continue
                try:
                    d2 = fr.evaluate(JS_BLOG_POST)
                    if d2 and d2.get("found"):
                        data = d2
                        break
                except Exception:
                    continue
        data["url"] = url
        return data
    except Exception as e:
        return {"found": False, "url": url, "error": str(e).splitlines()[0]}


def analyze_news_article(bs, page, url: str) -> Dict[str, Any]:
    try:
        bs.goto(page, url, settle_ms=1500)
        data = page.evaluate(JS_NEWS_ARTICLE) or {}
        data["url"] = url
        return data
    except Exception as e:
        return {"found": False, "url": url, "error": str(e).splitlines()[0]}


def parse_views(text: str) -> Optional[int]:
    """'... 4.7만 명 ...' / '조회 3.3만' -> 정수."""
    if not text:
        return None
    m = re.search(r"조회(?:수)?\s*([\d][\d.,]*\s*[만천]?)", text)
    if not m:
        m = re.search(r"([\d][\d.,]*\s*[만천]?)\s*(?:명|회)(?!\s*이상)", text)
    return parse_count(m.group(1)) if m else None


def summarize_posts(posts: List[Dict[str, Any]]) -> Dict[str, Any]:
    """분석한 글들의 요약 통계 (사진 수/분량 중앙값, 끊은 위치 평균)."""
    ok = [p for p in posts if p.get("found")]
    if not ok:
        return {}

    def med(vals: List[float]) -> Optional[float]:
        vals = sorted(v for v in vals if v is not None)
        return vals[len(vals) // 2] if vals else None

    seg_lens = [s for p in ok for s in (p.get("segments") or [])[1:-1] if s]
    return {
        "analyzed": len(ok),
        "median_images": med([p.get("images") for p in ok]),
        "median_chars": med([p.get("chars") for p in ok]),
        "avg_segment_chars": round(sum(seg_lens) / len(seg_lens)) if seg_lens else None,
        "median_first_image_after": med([p.get("first_image_after_chars") for p in ok]),
    }
