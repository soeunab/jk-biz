"""데이터 모델: 수집된 항목(Item)과 채널 결과(ChannelResult)."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


@dataclass
class Item:
    channel: str                      # naver_home / naver_ranking / nate / google_trends / daum / google_news / creator_advisor
    source: str                       # 세부 출처 (예: "네이트 실시간 이슈 키워드", "다음 경제")
    title: str
    url: str = ""
    rank: Optional[int] = None
    category: str = ""                # 네이버 블로그 카테고리 라벨 (finder.analysis.filters.CATEGORY_LIST 참고)
    views: Optional[int] = None       # 조회수 (네이버 랭킹)
    age_minutes: Optional[int] = None  # 몇 분 전 (다음/구글뉴스/구글트렌드 시작 시각)
    growth_pct: Optional[int] = None  # 검색량 증가율 % (구글 트렌드)
    volume: Optional[int] = None      # 검색량 (구글 트렌드)
    cluster_size: Optional[int] = None  # 같은 사건을 다룬 기사 수 (구글 뉴스)
    press: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ChannelResult:
    channel: str
    label: str
    ok: bool = False
    items: List[Item] = field(default_factory=list)
    error: str = ""
    seconds: float = 0.0
    notes: List[str] = field(default_factory=list)
    analysis: Dict[str, Any] = field(default_factory=dict)   # 채널별 상세 분석(글 구조 등)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        return d
