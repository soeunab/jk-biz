"""6. 네이버 크리에이터 어드바이저 - 보조 참고용 (기본 OFF).

7~10일 전 글감이 섞여 있어 트래픽이 끝물일 수 있으므로 메인 채널로 쓰지 않고,
로그인된 브라우저 프로필(data/browser_profile)이 있을 때만 화면 텍스트를 참고 자료로 덤프합니다.
로그인은 `python main.py --login` 으로 직접 1회만 해 주세요 (아이디/비밀번호는 코드가 다루지 않습니다).
"""
from __future__ import annotations

import time

from ..context import RunContext
from ..models import ChannelResult, Item
from ..util import clean

CHANNEL = "creator_advisor"
LABEL = "네이버 크리에이터 어드바이저(보조)"


def collect(rc: RunContext) -> ChannelResult:
    from pathlib import Path
    t0 = time.time()
    res = ChannelResult(channel=CHANNEL, label=LABEL)
    cfg = rc.cfg["creator_advisor"]
    url = (cfg.get("url") or "").strip()
    if not url:
        res.error = "creator_advisor.url 이 비어 있어 건너뜀 (보조 채널)"
        return res
    profile = Path(__file__).resolve().parents[2] / "data" / "browser_profile"
    if not profile.exists():
        res.error = "로그인 프로필이 없어 건너뜀 - `python main.py --login` 으로 1회 로그인하세요."
        return res

    ctx = None
    try:
        bcfg = rc.cfg.get("browser", {})
        kwargs = dict(user_data_dir=str(profile), headless=bool(bcfg.get("headless", True)), locale="ko-KR")
        if bcfg.get("channel"):
            kwargs["channel"] = bcfg["channel"]
        ctx = rc.bs.pw.chromium.launch_persistent_context(**kwargs)
        page = ctx.new_page()
        page.set_default_timeout(int(bcfg.get("nav_timeout_sec", 30)) * 1000)
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(3500)
        if "nid.naver.com" in page.url or "login" in page.url:
            res.error = "로그인이 만료되었습니다 - `python main.py --login` 을 다시 실행하세요."
            return res
        rows = page.evaluate(
            "() => [...document.querySelectorAll('li, tr')].map(e => (e.innerText || '').replace(/\\s+/g, ' ').trim())"
            ".filter(t => t.length >= 8 && t.length <= 120).slice(0, 60)") or []
        for i, t in enumerate(rows, 1):
            res.items.append(Item(channel=CHANNEL, source="크리에이터 어드바이저(보조)", title=clean(t), rank=i,
                                  extra={"supplementary": True}))
        res.ok = bool(res.items)
        res.notes.append(cfg.get("note", ""))
        if not res.ok:
            res.error = "화면에서 참고할 텍스트를 찾지 못했습니다."
    except Exception as e:
        res.error = "크리에이터 어드바이저 실패: %s" % str(e).splitlines()[0]
    finally:
        if ctx:
            try:
                ctx.close()
            except Exception:
                pass
    res.seconds = time.time() - t0
    return res
