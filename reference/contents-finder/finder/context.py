"""수집기에 전달되는 실행 컨텍스트."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional


@dataclass
class RunContext:
    cfg: Dict[str, Any]
    log: logging.Logger
    now: datetime
    bs: Optional[Any] = None       # BrowserSession (브라우저가 필요 없는 채널만 돌릴 때는 None)
    debug: bool = False
