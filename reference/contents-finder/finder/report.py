"""Markdown 리포트 생성."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from .analysis.crossref import Group
from .analysis.scoring import CHANNEL_LABEL
from .models import ChannelResult, Item
from .util import date_label, fmt_ago, fmt_count


def esc(s: Any) -> str:
    return str(s if s is not None else "").replace("|", "\\|").replace("\n", " ").strip()


def link(title: str, url: str) -> str:
    t = esc(title)
    if url and url.startswith("http"):
        return "[%s](%s)" % (t, url.replace(" ", "%20").replace("(", "%28").replace(")", "%29"))
    return t


def table(headers: List[str], rows: List[List[Any]]) -> str:
    if not rows:
        return "_데이터 없음_\n"
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    for r in rows:
        out.append("| " + " | ".join(esc(c) for c in r) + " |")
    return "\n".join(out) + "\n"


def _item_line(it: Item) -> str:
    bits = []
    if it.growth_pct:
        bits.append("검색량 %s%%↑" % format(it.growth_pct, ","))
    if it.views:
        bits.append("조회수 %s" % fmt_count(it.views))
    if it.age_minutes is not None:
        bits.append(fmt_ago(it.age_minutes))
    if it.cluster_size and it.cluster_size > 1:
        bits.append("같은 사건 %d건" % it.cluster_size)
    kind = it.extra.get("kind")
    if it.press:
        bits.insert(0, it.press)
    if it.rank and kind == "press_rank":
        bits.insert(1 if it.press else 0, "언론사 랭킹 %d위" % it.rank)
    elif it.rank and kind != "section_headline" and it.channel != "naver_home":
        bits.insert(0, "%d위" % it.rank)
    elif it.channel == "naver_home":
        bits.insert(0, "홈판 %d번째 노출" % it.rank)
    return "- %s · %s: %s%s" % (CHANNEL_LABEL.get(it.channel, it.channel), it.source, link(it.title, it.url),
                                (" (%s)" % ", ".join(bits)) if bits else "")


def _group_of(item: Item, item_group: Dict[int, Group]) -> Optional[Group]:
    return item_group.get(id(item))


def render(now: datetime, cfg: Dict[str, Any], results: List[ChannelResult], groups: List[Group],
           ranked: List[Group], excluded: List[Group], off_topic: List[Group], suggestions: Dict[int, Any],
           llm_state: str, total_seconds: float) -> str:
    L: List[str] = []
    top_n = int(cfg["report"]["top_n"])
    item_group: Dict[int, Group] = {id(i): g for g in groups for i in g.items}
    off_ids = {g.id for g in off_topic}
    res_by = {r.channel: r for r in results}
    ok_n = sum(1 for r in results if r.ok and r.channel != "creator_advisor")
    tot_n = sum(1 for r in results if r.channel != "creator_advisor")

    L.append("# %s 소재 발굴 리포트" % date_label(now))
    L.append("")
    L.append("> 생성 %s KST · 채널 %d/%d 수집 성공 · 소요 %d분 %d초 · 로컬 AI: %s" % (
        now.strftime("%H:%M"), ok_n, tot_n, int(total_seconds // 60), int(total_seconds % 60), llm_state))
    L.append("> 선택한 주제: %s" % ", ".join(cfg["blog"]["topics_include"]))
    L.append("")

    # ---- 0. 채널 상태
    L.append("## 0. 채널 수집 상태")
    L.append("")
    rows = []
    for r in results:
        st = "✅ 성공" if r.ok else ("⏭ 건너뜀" if r.channel == "creator_advisor" else "❌ 실패")
        note = r.error if not r.ok else ""
        if r.notes:
            note = (note + " / " if note else "") + " / ".join(n for n in r.notes if n)
        note = note if len(note) <= 220 else note[:217] + "..."
        rows.append([r.label, st, len(r.items), "%.0fs" % r.seconds, note])
    L.append(table(["채널", "상태", "수집 건수", "소요", "비고"], rows))

    # ---- 1. TOP
    L.append("## 1. 오늘 바로 쓸 소재 TOP %d" % top_n)
    L.append("")
    if not ranked:
        L.append("_추천할 소재가 없습니다. 채널 수집 상태를 확인하세요._\n")
    for n, g in enumerate(ranked[:top_n], 1):
        tags = ["점수 %d" % g.score, g.category or "미분류", "%d개 채널" % len(g.metrics.get("channels", []))]
        if g.metrics.get("preempt"):
            tags.append("🚀 선점 후보")
        if (g.metrics.get("trend_pct") or 0) >= cfg["google_trends"].get("instant_pct", 1000):
            tags.append("🔥 즉시 소재")
        L.append("### %d. %s" % (n, esc(g.label)))
        L.append("")
        L.append("`%s`" % " · ".join(tags))
        L.append("")
        for w in g.reasons:
            L.append("- " + w)
        L.append("")
        L.append("**수집 근거**")
        L.append("")
        for it in g.items[:7]:
            L.append(_item_line(it))
        L.append("")
        s = suggestions.get(g.id)
        if s is not None and not s.get("titles") and not s.get("raw"):
            L.append("_AI 응답이 비어 있어 제안을 만들지 못했습니다 (logs 확인)._")
            L.append("")
        if s:
            if s.get("titles"):
                L.append("**추천 제목 (로컬 AI)**")
                L.append("")
                for t in s["titles"][:3]:
                    L.append("- " + esc(t))
                L.append("")
            if s.get("angle"):
                L.append("**차별화 관점**: " + esc(s["angle"]))
                L.append("")
            if s.get("outline"):
                L.append("**글 구성안**")
                L.append("")
                for i, o in enumerate(s["outline"], 1):
                    L.append("%d. %s" % (i, esc(o)))
                L.append("")
            if s.get("caution"):
                L.append("**주의**: " + esc(s["caution"]))
                L.append("")
            if s.get("raw") and not s.get("titles"):
                L.append("**AI 응답(원문)**: " + esc(s["raw"]))
                L.append("")

    # ---- 2. 교차검증 표
    L.append("## 2. 교차검증 표 (2개 이상 채널에서 확인된 소재)")
    L.append("")
    multi = [g for g in ranked if len(g.metrics.get("channels", [])) >= 2][:25]
    rows = []
    for i, g in enumerate(multi, 1):
        m = g.metrics
        rows.append([i, g.label[:40], g.score, g.category, ", ".join(CHANNEL_LABEL[c] for c in m["channels"]),
                     fmt_ago(m.get("newest_age")), "🚀" if m.get("preempt") else ""])
    L.append(table(["#", "소재", "점수", "분류", "확인된 채널", "가장 최근 기사", "선점"], rows))

    # ---- 3. 채널별 원본
    L.append("## 3. 채널별 원본 데이터")
    L.append("")

    # ① 홈판
    r = res_by.get("naver_home")
    L.append("### ① 네이버 모바일 홈판 (실제 클릭 중인 노출 검증 글)")
    L.append("")
    if r and r.ok:
        an = r.analysis or {}
        sm = an.get("summary") or {}
        svc = an.get("services") or {}
        if svc:
            L.append("- 이번에 노출된 피드 %d개: %s" % (an.get("total_links", 0), " · ".join("%s %d" % (k, v) for k, v in sorted(svc.items(), key=lambda kv: -kv[1]))))
        if sm:
            L.append("- 분석한 글 %s개 · 사진 수 중앙값 **%s장** · 본문 중앙값 **%s자** · 사진과 사진 사이 평균 글 길이 %s자 · 첫 사진까지 글 %s자" % (
                sm.get("analyzed"), sm.get("median_images"), sm.get("median_chars"), sm.get("avg_segment_chars"), sm.get("median_first_image_after")))
        tp = an.get("title_patterns") or {}
        if tp:
            L.append("- 블로그 제목 패턴: 평균 %s자 · 따옴표 %s%% · 숫자 %s%% · 물음표 %s%% · 말줄임 %s%%" % (
                tp.get("avg_length"), tp.get("quote_pct"), tp.get("number_pct"), tp.get("question_pct"), tp.get("ellipsis_pct")))
        L.append("- 참고: 최근 홈판 글은 글을 읽기보다 **이미지 위주로 소비**되는 흐름 → 사진 7장 내외를 크게 배치하고 글은 사진 사이에 짧게 끊는 구성 권장")
        L.append("")
        rows = []
        posts = {p.get("url"): p for p in an.get("posts", [])}
        shown = [i for i in r.items if i.extra.get("service") == "BLOG"][:20]
        for it in shown:
            p = posts.get(it.extra.get("post_url")) or {}
            seg = "/".join(str(x) for x in (p.get("segments") or [])[:8]) if p.get("found") else ""
            rows.append([it.rank, it.extra.get("service"), it.press, link(it.title, it.url), fmt_ago(it.age_minutes),
                         p.get("images", ""), p.get("chars", ""), seg])
        L.append(table(["노출순", "구분", "작성자", "제목", "게시", "사진", "글자수", "글 끊은 위치(사진 사이 글자수)"], rows))
        clips = [i for i in r.items if i.extra.get("service") != "BLOG"]
        if clips:
            L.append("**같은 피드에 노출된 카페 글·영상/쇼츠 (참고)**")
            L.append("")
            for it in clips[:8]:
                L.append("- %s (%s)" % (link(it.title[:60], it.url.split("?")[0] if it.extra.get("service") == "CAFE" else it.url), it.press[:30]))
            L.append("")
    else:
        L.append("⚠ 수집 실패: %s\n" % (r.error if r else "실행 안 됨"))
        for n in (r.notes if r else []):
            L.append("- " + n)
        L.append("")

    # ② 네이버 랭킹
    r = res_by.get("naver_ranking")
    L.append("### ② 네이버 랭킹 뉴스")
    L.append("")
    if r and r.ok:
        an = r.analysis or {}
        arts = {a.get("orig_url"): a for a in an.get("articles", [])}
        pages: Dict[str, List[Item]] = {}
        for it in r.items:
            pages.setdefault(it.source, []).append(it)
        # 언론사 랭킹 교차 노출
        multi = sorted([g for g in ranked + excluded + off_topic if g.metrics.get("press_hits", 0) >= 2],
                       key=lambda g: (-g.metrics["press_hits"], g.metrics.get("press_best_rank") or 9))
        for name, its in pages.items():
            kind = its[0].extra.get("kind")
            pt = ((an.get("pages", {}).get(name, {}) or {}).get("title_patterns")) or {}
            if kind == "press_rank":
                L.append("**%s - 언론사별 '많이 본 뉴스' 상위 %d건 (%d개 언론사)**" % (name, max(i.rank or 0 for i in its), len({i.press for i in its})))
                L.append("")
                L.append("네이버는 이 화면에 조회수를 표시하지 않습니다. 대신 **같은 이슈가 여러 언론사 랭킹에 동시에 오른 정도**를 큰 이슈 신호로 씁니다.")
                L.append("")
                rows = []
                for g in multi[:12]:
                    rows.append([g.label[:46], g.metrics["press_hits"], g.metrics.get("press_best_rank"), g.category,
                                 "제외" if g.excluded_reason else ""])
                L.append(table(["이슈(대표 제목)", "랭킹에 오른 언론사 수", "최고 순위", "분류", "비고"], rows) if rows else "_여러 언론사에 동시에 오른 이슈가 없습니다._\n")
                continue
            L.append("**%s**" % name)
            L.append("")
            if pt:
                L.append("제목 패턴: 평균 %s자 · 따옴표 %s%% · 숫자 %s%% · 물음표 %s%% · 자주 나온 단어 %s" % (
                    pt.get("avg_length"), pt.get("quote_pct"), pt.get("number_pct"), pt.get("question_pct"),
                    ", ".join("%s(%d)" % tuple(w) for w in pt.get("common_words", [])[:6])))
                L.append("")
            rows = []
            for it in its[:10]:
                a = arts.get(it.url) or {}
                row = [it.rank, link(it.title, it.url), fmt_count(it.views) if it.views else "-"]
                if any(x.press for x in its):
                    row.append(it.press or "")
                rows.append(row + [a.get("chars", ""), a.get("images", "")])
            L.append(table(["순위", "제목", "조회수"] + (["언론사"] if any(x.press for x in its) else []) + ["본문(자)", "사진"], rows))
        L.append("- 참고: 홈판 노출에 성공한 글의 본문 분량은 **1,300~1,900자** 수준")
        L.append("")
    else:
        L.append("⚠ 수집 실패: %s\n" % (r.error if r else "실행 안 됨"))
        for n in (r.notes if r else []):
            L.append("- " + n)
        L.append("")

    # ③ 네이트
    r = res_by.get("nate")
    L.append("### ③ 네이트 실시간 이슈 (선점용)")
    L.append("")
    if r and r.ok:
        rows = []
        for it in [i for i in r.items if i.source == "네이트 실시간 이슈 키워드"]:
            g = _group_of(it, item_group)
            onn = ""
            if g:
                onn = "네이버 이미 노출" if (g.metrics.get("home_hit") or g.metrics.get("naver_best_rank")) else "🚀 선점 가능"
                if g.excluded_reason:
                    onn = "제외(%s)" % ("부정 이슈" if g.excluded_reason.startswith("부정") else "정치")
                elif g.id in off_ids:
                    onn = "주제 밖(%s)" % g.category
            chg = it.extra.get("change")
            chg_s = {"new": "NEW", "up": "▲%s" % (it.extra.get("delta") or ""), "down": "▼%s" % (it.extra.get("delta") or ""), "same": "-"}.get(chg, "")
            rows.append([it.rank, link(it.title, it.url), chg_s, g.category if g else "", onn])
        L.append(table(["순위", "이슈 키워드", "변동", "분류", "네이버 선점 여부(수집 데이터 기준)"], rows))
        hot = [i for i in r.items if i.source.startswith("네이트 실시간 급상승 관심뉴스")]
        for tab in ("시사", "연예"):
            sub = [i for i in hot if i.source.endswith("(%s)" % tab)]
            sub.sort(key=lambda i: i.rank or 99)
            if sub:
                L.append("**급상승 관심뉴스 - %s (상위 8)**" % tab)
                L.append("")
                for it in sub[:8]:
                    L.append("- %s. %s" % (it.rank, link(it.title, it.url)))
                L.append("")
        pann = [i for i in r.items if i.source == "네이트 판 Top랭킹"][:5]
        if pann:
            L.append("**판 Top랭킹 (참고: 커뮤니티 반응 제목)**")
            L.append("")
            for it in pann:
                L.append("- %s. %s (댓글 %s)" % (it.rank, link(it.title, it.url), it.extra.get("comments")))
            L.append("")
        L.append("- 주의: 부정적인 사건·이슈는 선별에서 제외 (제외 목록은 4번 참고). '선점 가능'은 수집한 네이버 랭킹/홈판 기준의 추정이며, 발행 전 네이버 블로그 검색으로 한 번 더 확인하세요.")
        L.append("")
    else:
        L.append("⚠ 수집 실패: %s\n" % (r.error if r else "실행 안 됨"))

    # ④ 구글 트렌드
    r = res_by.get("google_trends")
    L.append("### ④ 구글 트렌드 실시간 인기 (한국, 지난 %d시간)" % cfg["google_trends"]["hours"])
    L.append("")
    if r and r.ok:
        rows = []
        for it in sorted(r.items, key=lambda i: (-(i.growth_pct or 0), i.rank or 99)):
            flag = "🔥" if (it.growth_pct or 0) >= cfg["google_trends"]["instant_pct"] else ""
            rows.append([it.rank, link(it.title, it.url), fmt_count(it.volume) + "+", "%s%%" % format(it.growth_pct, ",") if it.growth_pct else "-",
                         fmt_ago(it.age_minutes) + (" ⚡" if it.extra.get("fresh") else ""), ", ".join(dict.fromkeys(it.extra.get("categories", []))) or it.category,
                         ", ".join((it.extra.get("related") or [])[:3]), flag])
        L.append(table(["순위", "키워드", "검색량", "증가율", "시작", "분류", "관련 검색어", "즉시"], rows))
        L.append("- 🔥 = 검색량 %s%% 이상 증가 → 그날 바로 소재로 작성 / ⚡ = 지난 %d시간 이내 시작 (기사보다 검색이 먼저 발생한 키워드)" % (
            format(cfg["google_trends"]["instant_pct"], ","), cfg["google_trends"]["fresh_hours"]))
        L.append("")
    else:
        L.append("⚠ 수집 실패: %s\n" % (r.error if r else "실행 안 됨"))
        for n in (r.notes if r else []):
            L.append("- " + n)
        L.append("")

    # ⑤ 다음/구글 뉴스
    L.append("### ⑤ 다음 뉴스 · 구글 뉴스 교차검증")
    L.append("")
    r = res_by.get("daum")
    if r and r.ok:
        fresh_min = cfg["daum"]["fresh_minutes"]
        tr = [i for i in r.items if i.source == "다음 실시간 트렌드"]
        if tr:
            L.append("**다음 실시간 트렌드**: " + " · ".join("%s위 %s" % (i.rank, i.title) for i in sorted(tr, key=lambda i: i.rank or 99)[:10]))
            L.append("")
        pages: Dict[str, List[Item]] = {}
        for it in r.items:
            if it.source != "다음 실시간 트렌드":
                pages.setdefault(it.source, []).append(it)
        for name, its in pages.items():
            fresh = [i for i in its if i.age_minutes is not None and i.age_minutes <= fresh_min]
            fresh.sort(key=lambda i: i.age_minutes)
            L.append("**%s** - %d분 이내 기사 %d건 (숫자가 작을수록 아직 다른 블로거가 덜 다룬 소재)" % (name, fresh_min, len(fresh)))
            L.append("")
            rows = []
            for it in fresh[:8]:
                g = _group_of(it, item_group)
                multi_n = len({i.url or i.title for i in g.items if i.channel == "daum"}) if g else 1
                rows.append([fmt_ago(it.age_minutes), link(it.title, it.url), it.press, "복수 기사 %d건" % multi_n if multi_n >= 3 else ""])
            L.append(table(["입력", "제목", "언론사", "트래픽 신호"], rows))
    else:
        L.append("⚠ 다음 뉴스 수집 실패: %s\n" % (r.error if r else "실행 안 됨"))
    r = res_by.get("google_news")
    if r and r.ok:
        L.append("**구글 뉴스 - 같은 사건을 여러 매체가 동시에 다루는 대형 이슈 (묶음 3건 이상)**")
        L.append("")
        rows = []
        for it in sorted([i for i in r.items if (i.cluster_size or 0) >= 3], key=lambda i: -(i.cluster_size or 0))[:15]:
            g = _group_of(it, item_group)
            rows.append([it.cluster_size, link(it.title, it.url), it.source.replace("구글 뉴스 ", ""), it.press, fmt_ago(it.age_minutes),
                         (g.category if g else "")])
        L.append(table(["묶인 기사", "대표 제목", "토픽", "매체", "발행", "분류"], rows))
        L.append("- 구글 뉴스는 동일 사건 기사를 한 묶음으로 보여주므로, 묶음 수가 클수록 여러 매체가 다루는 대형 사건입니다.")
        L.append("")
    else:
        L.append("⚠ 구글 뉴스 수집 실패: %s\n" % (r.error if r else "실행 안 됨"))

    # ⑥ 크리에이터 어드바이저
    r = res_by.get("creator_advisor")
    L.append("### ⑥ 네이버 크리에이터 어드바이저 (보조 참고용)")
    L.append("")
    if r and r.ok:
        L.append("_7~10일 전 글감이 섞여 트래픽이 끝물일 수 있어 메인 채널로 쓰지 않습니다._")
        L.append("")
        for it in r.items[:20]:
            L.append("- " + esc(it.title))
        L.append("")
    else:
        L.append("_%s_\n" % (r.error if r else "실행 안 됨"))

    # ---- 4. 제외된 이슈 / 주제 밖 화제
    L.append("## 4. 제외된 이슈 (부정적 사건 · 정치)")
    L.append("")
    rows = [[esc(g.label)[:50], g.score, g.category, ", ".join(CHANNEL_LABEL[c] for c in g.metrics.get("channels", [])), g.excluded_reason] for g in excluded[:30]]
    L.append(table(["소재", "점수", "분류", "채널", "제외 사유"], rows))

    L.append("## 5. 주제 밖이지만 화제인 이슈 (참고)")
    L.append("")
    L.append("_이번에 선택한 주제(%s)에 속하지 않아 TOP 에서 뺀 소재입니다. 다른 주제를 보고 싶으면 프로그램을 다시 실행해 원하는 카테고리를 선택하세요._" % ", ".join(cfg["blog"]["topics_include"]))
    L.append("")
    rows = [[esc(g.label)[:50], g.score, g.category, ", ".join(CHANNEL_LABEL[c] for c in g.metrics.get("channels", []))] for g in off_topic[:15]]
    L.append(table(["소재", "점수", "분류", "채널"], rows))

    L.append("---")
    L.append("_작성 기준: 사진 %d장 내외 · 본문 %d~%d자 · 부정적 이슈 제외. 자동 생성 리포트이며 발행 전 사실 확인은 직접 해 주세요._" % (
        cfg["blog"]["guidelines"]["photos"], cfg["blog"]["guidelines"]["min_chars"], cfg["blog"]["guidelines"]["max_chars"]))
    return "\n".join(L) + "\n"
