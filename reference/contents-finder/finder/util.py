"""공용 유틸: 한국어 숫자/시간 파싱, 토큰화, 제목 특징 추출."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Set

try:
    from zoneinfo import ZoneInfo
    KST = ZoneInfo("Asia/Seoul")
except Exception:  # pragma: no cover - tzdata 가 없을 때
    KST = timezone(timedelta(hours=9))


def now_kst() -> datetime:
    return datetime.now(KST)


WEEKDAYS_KO = ["월", "화", "수", "목", "금", "토", "일"]


def date_label(dt: datetime) -> str:
    return "%s(%s)" % (dt.strftime("%Y-%m-%d"), WEEKDAYS_KO[dt.weekday()])


# ---------------------------------------------------------------- 숫자/시간 파싱
_COUNT_RE = re.compile(r"([\d][\d,]*\.?\d*)\s*(억|만|천|K|k|M|m)?")


def parse_count(text: Optional[str]) -> Optional[int]:
    """'4.7만' -> 47000, '6만 명' -> 60000, '5천+' -> 5000, '1,234' -> 1234, '2.3K' -> 2300."""
    if not text:
        return None
    m = _COUNT_RE.search(str(text))
    if not m:
        return None
    try:
        num = float(m.group(1).replace(",", ""))
    except ValueError:
        return None
    unit = m.group(2) or ""
    mult = {"억": 100_000_000, "만": 10_000, "천": 1_000, "K": 1_000, "k": 1_000, "M": 1_000_000, "m": 1_000_000}.get(unit, 1)
    return int(round(num * mult))


def parse_pct(text: Optional[str]) -> Optional[int]:
    """'1,000%' -> 1000"""
    if not text:
        return None
    m = re.search(r"([\d][\d,]*)\s*%", str(text))
    return int(m.group(1).replace(",", "")) if m else None


_AGO_RE = re.compile(r"(?:(\d+)\s*일)?\s*(?:(\d+)\s*시간)?\s*(?:(\d+)\s*분)?\s*(?:(\d+)\s*초)?\s*전")


def parse_ago_minutes(text: Optional[str]) -> Optional[int]:
    """'56분 전' -> 56, '2시간 전' -> 120, '1일 전' -> 1440, '방금 전' -> 0."""
    if not text:
        return None
    t = str(text).strip()
    if "방금" in t:
        return 0
    if "동안" in t:      # '6시간 동안 지속됨' 같은 표현은 제외
        return None
    m = _AGO_RE.search(t)
    if not m or not any(m.groups()):
        return None
    d, h, mi, s = [int(x) if x else 0 for x in m.groups()]
    return d * 1440 + h * 60 + mi


def fmt_ago(minutes: Optional[int]) -> str:
    if minutes is None:
        return "-"
    if minutes < 60:
        return "%d분 전" % minutes
    if minutes < 1440:
        return "%d시간 전" % (minutes // 60)
    return "%d일 전" % (minutes // 1440)


def fmt_count(n: Optional[int]) -> str:
    if n is None:
        return "-"
    if n >= 10_000:
        v = n / 10_000
        return ("%.1f만" % v).replace(".0만", "만")
    return "{:,}".format(n)


def clean(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


# ---------------------------------------------------------------- 토큰화
_JOSA = sorted([
    "에서는", "으로는", "에게서", "이라는", "이라고", "으로", "에서", "에게", "까지", "부터", "처럼", "보다",
    "마저", "조차", "이나", "이란", "라는", "라고", "에는", "에도", "으로", "은", "는", "이", "가", "을", "를",
    "의", "에", "도", "만", "로", "과", "와", "께",
], key=len, reverse=True)

STOPWORDS: Set[str] = set("""
관련 기자 오늘 어제 내일 이번 지난 올해 내년 대해 위해 통해 이후 가운데 사이 최근 현재 결국 또한 하지만 그리고
공개 발표 이유 논란 단독 속보 종합 영상 동영상 사진 포토 인터뷰 연합뉴스 뉴스1 뉴시스 한국경제 매일경제
서울경제 조선일보 중앙일보 동아일보 한겨레 경향신문 머니투데이 이데일리 아시아경제 헤럴드경제 파이낸셜뉴스
스포츠 오늘의 대한 무엇 어떻게 어떤 정말 진짜 완전 대박 충격 반전 현실 이유는 있다 없다 한다 했다 된다 됐다
""".split())


def _strip_josa(tok: str) -> str:
    for j in _JOSA:
        if tok.endswith(j) and len(tok) - len(j) >= 2:
            return tok[: -len(j)]
    return tok


_PRESS_SUFFIX = re.compile(r"\s+[-–|]\s+[^-–|]{2,14}$")


def strip_press_suffix(text: str) -> str:
    """구글 뉴스 제목 끝의 ' - 조선비즈' 같은 매체명 꼬리를 제거 (매체명 때문에 다른 기사가 묶이는 것을 방지)."""
    return _PRESS_SUFFIX.sub("", text or "")


_TAG_RE = re.compile(r"\[[^\]]{1,14}\]|【[^】]{1,14}】")      # [단독] [속보] [인사이드 스토리] 같은 말머리
_ENDING_RE = re.compile(r"(는데|은데|지만|면서|라며|라고|했다|한다|됐다|였다|이다|입니다)$")


def tokens(text: str) -> Set[str]:
    """제목에서 비교용 토큰 집합을 만든다 (조사 제거, 불용어 제거, 숫자만인 토큰 제외)."""
    raw = re.findall(r"[가-힣A-Za-z0-9]{2,}", _TAG_RE.sub(" ", strip_press_suffix(text)))
    out: Set[str] = set()
    for r in raw:
        t = _strip_josa(r.lower()) if re.search(r"[가-힣]", r) else r.lower()
        if len(t) < 2 or t in STOPWORDS or t.isdigit():
            continue
        if _ENDING_RE.search(t) and re.search(r"[가-힣]", t):     # '알았는데', '했지만' 같은 서술어 토큰은 소재 판별에 도움이 안 됨
            continue
        if re.fullmatch(r"\d+[가-힣]{1,3}", t):     # '2027년', '10시간', '34세' 같은 숫자+단위는 다른 기사와 잘못 묶이는 원인
            continue
        out.add(t)
    return out


def norm(text: str) -> str:
    """공백/기호 제거 후 소문자화 (부분 문자열 비교용)."""
    return re.sub(r"[^가-힣a-z0-9]", "", strip_press_suffix(text).lower())


# ---------------------------------------------------------------- 제목 특징
def title_features(title: str) -> Dict[str, object]:
    t = clean(title)
    return {
        "length": len(t),
        "has_number": bool(re.search(r"\d", t)),
        "has_quote": bool(re.search(r"[\"'“”‘’『』「」]", t)),
        "has_bracket": bool(re.search(r"[\[\(【<]", t)),
        "has_question": "?" in t,
        "has_exclaim": "!" in t,
        "has_ellipsis": ("…" in t) or ("..." in t),
        "has_dash_split": bool(re.search(r"[-–—|·]", t)),
    }


def summarize_title_patterns(titles: List[str]) -> Dict[str, object]:
    titles = [clean(t) for t in titles if t]
    if not titles:
        return {}
    feats = [title_features(t) for t in titles]
    n = len(titles)

    def pct(key: str) -> int:
        return int(round(100.0 * sum(1 for f in feats if f[key]) / n))

    lengths = sorted(f["length"] for f in feats)  # type: ignore[arg-type]
    words: Dict[str, int] = {}
    for t in titles:
        for w in tokens(t):
            words[w] = words.get(w, 0) + 1
    common = sorted(((w, c) for w, c in words.items() if c >= 2), key=lambda x: (-x[1], x[0]))[:8]
    return {
        "count": n,
        "avg_length": round(sum(lengths) / n, 1),
        "median_length": lengths[n // 2],
        "quote_pct": pct("has_quote"),
        "number_pct": pct("has_number"),
        "question_pct": pct("has_question"),
        "ellipsis_pct": pct("has_ellipsis"),
        "bracket_pct": pct("has_bracket"),
        "common_words": common,
    }
