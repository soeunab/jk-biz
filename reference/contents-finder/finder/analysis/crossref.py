"""교차검증: 서로 다른 채널의 항목들을 '같은 소재'로 묶는다.

시드(깨끗한 키워드 우선)를 기준으로 그룹을 만들고, 제목 토큰이 겹치는 항목을 붙인다.
연쇄 결합(체이닝)을 막기 위해 '그룹 핵심 토큰'과 비교한다.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Dict, List, Set

from ..models import Item
from ..util import norm, tokens

# 시드 우선순위 (낮을수록 먼저 시드가 됨)
SEED_PRIORITY = {
    ("google_trends", None): 0,
    ("nate", "네이트 실시간 이슈 키워드"): 1,
    ("daum", "다음 실시간 트렌드"): 1,
    ("naver_ranking", None): 2,
    ("naver_home", None): 3,
    ("nate", None): 4,
    ("daum", None): 5,
    ("google_news", None): 6,
}


def _priority(it: Item) -> int:
    return SEED_PRIORITY.get((it.channel, it.source), SEED_PRIORITY.get((it.channel, None), 9))


@dataclass
class Group:
    id: int
    label: str
    items: List[Item] = field(default_factory=list)
    core: Set[str] = field(default_factory=set)
    seed_norm: str = ""
    member_norms: List[str] = field(default_factory=list)
    metrics: Dict = field(default_factory=dict)
    score: int = 0
    reasons: List[str] = field(default_factory=list)
    category: str = ""
    flags: Dict = field(default_factory=dict)
    excluded_reason: str = ""

    @property
    def channels(self) -> Set[str]:
        return {i.channel for i in self.items}


def _item_tokens(it: Item) -> Set[str]:
    toks = tokens(it.title)
    if it.channel == "google_trends":
        for r in it.extra.get("related", []) or []:
            toks |= tokens(r)
    return toks


def build_groups(items: List[Item], threshold: float = 1.6) -> List[Group]:
    pool = [i for i in items if not i.extra.get("community") and not i.extra.get("supplementary")]
    toks = {id(i): _item_tokens(i) for i in pool}
    df: Counter = Counter()
    for i in pool:
        for t in toks[id(i)]:
            df[t] += 1

    def weight(t: str) -> float:
        n = df[t]
        if len(t) >= 4 and n <= 8:
            return 1.6
        if len(t) >= 3 and n <= 4:
            return 1.0
        return 0.6 if len(t) >= 3 else 0.4

    ordered = sorted(pool, key=lambda i: (_priority(i), i.rank if i.rank is not None else 999))
    groups: List[Group] = []
    for it in ordered:
        it_toks = toks[id(it)]
        it_norm = norm(it.title)
        best, best_score = None, 0.0
        for g in groups:
            s = sum(weight(t) for t in (it_toks & g.core))
            if len(g.seed_norm) >= 3 and g.seed_norm in it_norm:
                s += 2.0
            if 3 <= len(it_norm) <= 14 and any(it_norm in m for m in g.member_norms):
                s += 2.0
            if s > best_score:
                best, best_score = g, s
        if best is not None and best_score >= threshold:
            best.items.append(it)
            best.core |= it_toks if len(best.items) <= 3 else set()   # 초반 멤버만 핵심 토큰 확장
            best.member_norms.append(it_norm)
        else:
            groups.append(Group(id=len(groups) + 1, label=it.title, items=[it], core=set(it_toks),
                                seed_norm=it_norm, member_norms=[it_norm]))
    return groups
