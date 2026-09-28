"""5-b. 구글 뉴스 - 토픽별 RSS. 같은 사건을 묶은 기사 수(cluster_size)로 '여러 매체가 동시에 다루는 이슈'를 판별.

브라우저 없이 requests 만 사용하므로 가장 안정적입니다. (RSS 구조는 2026-09 실제 응답으로 확인)
"""
from __future__ import annotations

import html
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import List, Optional

import requests

from ..context import RunContext
from ..models import ChannelResult, Item
from ..util import clean

CHANNEL = "google_news"
LABEL = "구글 뉴스"

RSS = "https://news.google.com/rss/topics/%s?hl=ko&gl=KR&ceid=KR:ko"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"}


def parse_rss(xml_bytes: bytes, now_utc: Optional[datetime] = None, limit: int = 40):
    """RSS -> [(title, press, age_minutes, cluster_size, url, related_titles)]"""
    now_utc = now_utc or datetime.now(timezone.utc)
    root = ET.fromstring(xml_bytes)
    rows = []
    for i, it in enumerate(root.iter("item")):
        if i >= limit:
            break
        title = it.findtext("title") or ""
        src_el = it.find("source")
        press = (src_el.text or "").strip() if src_el is not None else ""
        if press and title.endswith(" - " + press):
            title = title[: -len(" - " + press)]
        else:
            title = re.sub(r"\s+-\s+[^-]{2,14}$", "", title)     # 매체 표기가 다른 경우('- 조선비즈')도 제거
        age = None
        pub = it.findtext("pubDate")
        if pub:
            try:
                dt = parsedate_to_datetime(pub)
                age = max(0, int((now_utc - dt).total_seconds() // 60))
            except Exception:
                age = None
        desc = html.unescape(it.findtext("description") or "")
        related = [clean(html.unescape(x)) for x in re.findall(r"<a [^>]*>(.*?)</a>", desc, flags=re.S)]
        cluster = max(1, len(re.findall(r"<li>", desc)))
        rows.append((clean(title), press, age, cluster, it.findtext("link") or "", related))
    return rows


def collect(rc: RunContext) -> ChannelResult:
    t0 = time.time()
    res = ChannelResult(channel=CHANNEL, label=LABEL)
    cfg = rc.cfg["google_news"]
    items: List[Item] = []
    now_utc = datetime.now(timezone.utc)

    for label, spec in (cfg.get("topics") or {}).items():
        try:
            r = requests.get(RSS % spec["id"], headers=UA, timeout=25)
            r.raise_for_status()
            for idx, (title, press, age, cluster, link, related) in enumerate(
                    parse_rss(r.content, now_utc, int(cfg.get("per_topic", 40))), 1):
                items.append(Item(channel=CHANNEL, source="구글 뉴스 %s" % label, title=title, url=link, rank=idx,
                                  category=spec.get("category", ""), age_minutes=age, cluster_size=cluster, press=press,
                                  extra={"related": related[:6]}))
        except Exception as e:
            res.notes.append("토픽 %s 수집 실패: %s" % (label, str(e).splitlines()[0]))

    res.items = items
    res.ok = bool(items)
    if not res.ok:
        res.error = "구글 뉴스 RSS 를 가져오지 못했습니다."
    res.seconds = time.time() - t0
    return res
