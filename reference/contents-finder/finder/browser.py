"""Playwright 브라우저 세션 관리 + 디버그 덤프."""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

DESKTOP_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


class BrowserSession:
    """하나의 브라우저를 띄우고 페이지(컨텍스트)를 필요할 때마다 만든다."""

    def __init__(self, cfg: Dict[str, Any], debug_dir: Path, log: logging.Logger, debug_always: bool = False):
        self.cfg = cfg
        self.bcfg = cfg.get("browser", {})
        self.debug_dir = Path(debug_dir)
        self.log = log
        self.debug_always = debug_always
        self.pw = None
        self.browser = None
        self._contexts: List[Any] = []

    # ------------------------------------------------------------------ 수명주기
    def __enter__(self) -> "BrowserSession":
        from playwright.sync_api import sync_playwright  # 늦게 import: 설치 전에도 다른 모듈 테스트 가능
        self.pw = sync_playwright().start()
        self.browser = self._launch()
        return self

    def __exit__(self, *exc) -> None:
        for c in self._contexts:
            try:
                c.close()
            except Exception:
                pass
        try:
            if self.browser:
                self.browser.close()
        finally:
            if self.pw:
                self.pw.stop()

    def _launch(self):
        headless = bool(self.bcfg.get("headless", True))
        channel = self.bcfg.get("channel") or None
        if channel:
            try:
                return self.pw.chromium.launch(channel=channel, headless=headless)
            except Exception as e:  # 크롬 미설치 등
                self.log.warning("channel=%s 실행 실패(%s) -> 번들 chromium 으로 재시도", channel, str(e).splitlines()[0])
        return self.pw.chromium.launch(headless=headless)

    # ------------------------------------------------------------------ 페이지
    def new_page(self, mobile: bool = False):
        kwargs: Dict[str, Any] = {"locale": "ko-KR", "timezone_id": "Asia/Seoul"}
        if mobile:
            dev = self.pw.devices.get("iPhone 13") or {}
            kwargs.update(dev)
        else:
            kwargs.update({"user_agent": DESKTOP_UA, "viewport": {"width": 1366, "height": 900}})
        ctx = self.browser.new_context(**kwargs)
        self._contexts.append(ctx)
        page = ctx.new_page()
        page.set_default_timeout(int(self.bcfg.get("nav_timeout_sec", 30)) * 1000)
        return page

    def goto(self, page, url: str, settle_ms: int = 2500) -> None:
        page.goto(url, wait_until="domcontentloaded")
        try:
            page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass
        page.wait_for_timeout(settle_ms)

    def scroll(self, page, times: int = 8, step: int = 1400, wait_ms: int = 700) -> None:
        for _ in range(times):
            page.evaluate("window.scrollBy(0, %d)" % step)
            page.wait_for_timeout(wait_ms)

    # ------------------------------------------------------------------ 디버그
    def dump(self, page, name: str, force: bool = False) -> Optional[str]:
        """실패했거나 --debug 일 때 HTML/스크린샷을 저장한다 (셀렉터 점검용)."""
        if not (force or self.debug_always):
            return None
        try:
            self.debug_dir.mkdir(parents=True, exist_ok=True)
            safe = re.sub(r"[^0-9A-Za-z가-힣_-]+", "_", name)
            html_path = self.debug_dir / (safe + ".html")
            html_path.write_text(page.content(), encoding="utf-8")
            try:
                page.screenshot(path=str(self.debug_dir / (safe + ".png")), full_page=False)
            except Exception:
                pass
            return str(html_path)
        except Exception as e:  # pragma: no cover
            self.log.warning("debug dump 실패: %s", e)
            return None
