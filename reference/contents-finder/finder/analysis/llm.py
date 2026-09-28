"""로컬 LLM(OpenAI 호환 API 서버: Ollama / LM Studio / mlx_lm.server / llama.cpp 등) 연동.
Qwen·Gemma 등 어떤 모델이든 쓸 수 있고, 서버가 꺼져 있으면 조용히 건너뛰고 규칙 기반 리포트만 만든다."""
from __future__ import annotations

import json
import re
import shlex
import subprocess
import time
from typing import Any, Dict, List, Optional

import requests

from ..util import fmt_ago, fmt_count
from .crossref import Group
from .scoring import CHANNEL_LABEL

SYSTEM = (
    "당신은 한국어 네이버 블로그 콘텐츠 기획자입니다. 주어진 '실제 수집 데이터'만 근거로 삼고, 데이터에 없는 사실은 지어내지 않습니다. "
    "부정적·선정적·추측성 표현, 특정인 비하, 사건사고 자극 표현은 쓰지 않습니다. 반드시 JSON 한 개만 출력합니다."
)


class LocalLLM:
    def __init__(self, cfg: Dict[str, Any], log):
        self.c = cfg["llm"]
        self.blog = cfg["blog"]
        self.log = log
        self.base = self.c["base_url"].rstrip("/")
        self.headers = {"Content-Type": "application/json"}
        if self.c.get("api_key"):
            self.headers["Authorization"] = "Bearer " + self.c["api_key"]
        self._model: Optional[str] = None

    # -------------------------------------------------------------- 모델별 호환 처리
    def model_name(self) -> str:
        """config 의 model 이 비어 있거나 'default' 이면 서버가 알려주는 첫 모델명을 사용 (Ollama/LM Studio 는 실제 이름이 필요)."""
        if self._model:
            return self._model
        name = (self.c.get("model") or "").strip()
        if not name or name == "default":
            try:
                r = requests.get(self.base + "/models", headers=self.headers, timeout=6)
                data = r.json().get("data") or []
                if data:
                    name = data[0].get("id") or name
            except Exception:
                pass
        self._model = name or "default"
        return self._model

    def _flag(self, key: str, pattern: str) -> bool:
        """config 값이 true/false 면 그대로, 'auto'(기본)면 모델명이 pattern 에 맞을 때만 켠다."""
        v = self.c.get(key, "auto")
        if isinstance(v, bool):
            return v
        return bool(re.search(pattern, self.model_name(), flags=re.I))

    # -------------------------------------------------------------- 서버 상태
    def available(self) -> bool:
        try:
            r = requests.get(self.base + "/models", headers=self.headers, timeout=4)
            return r.status_code < 500
        except Exception:
            return False

    def ensure_running(self) -> bool:
        if self.available():
            return True
        cmd = (self.c.get("autostart_cmd") or "").strip()
        if not cmd:
            return False
        self.log.info("로컬 LLM 서버 자동 시작: %s", cmd)
        try:
            subprocess.Popen(shlex.split(cmd), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        except Exception as e:
            self.log.warning("자동 시작 실패: %s", e)
            return False
        for _ in range(45):           # 최대 ~90초 대기 (모델 로딩)
            time.sleep(2)
            if self.available():
                return True
        return False

    # -------------------------------------------------------------- 호출
    def _native_ollama(self) -> bool:
        """Ollama 는 전용 API(/api/chat)에서 think:false 로 '생각 과정'을 확실히 끌 수 있어 그쪽을 우선 사용한다."""
        api = str(self.c.get("api", "auto")).lower()
        if api == "ollama":
            return True
        if api == "openai":
            return False
        return ":11434" in self.base

    def _build_messages(self, user: str) -> List[Dict[str, str]]:
        if self._flag("no_think", r"qwen"):            # Qwen3 계열: '/no_think' 로 생각(thinking) 출력 끄기
            user = user + "\n/no_think"
        if self._flag("merge_system", r"gemma"):       # Gemma 등 system 역할을 지원하지 않는 템플릿: 지시문을 사용자 메시지에 합침
            return [{"role": "user", "content": SYSTEM + "\n\n" + user}]
        return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]

    def _request(self, messages: List[Dict[str, str]], max_tokens: int) -> Dict[str, Any]:
        timeout = int(self.c.get("timeout_sec", 240))
        if self._native_ollama():
            url = self.base.rsplit("/v1", 1)[0] + "/api/chat"
            body: Dict[str, Any] = {"model": self.model_name(), "messages": messages, "stream": False, "think": False,
                                    "options": {"temperature": 0.6, "num_predict": max_tokens}}
            r = requests.post(url, headers=self.headers, data=json.dumps(body), timeout=timeout)
            if r.status_code == 400 and "think" in r.text.lower():      # 생각 기능이 없는 모델은 think 항목 없이 재시도
                body.pop("think", None)
                r = requests.post(url, headers=self.headers, data=json.dumps(body), timeout=timeout)
            r.raise_for_status()
            m = r.json().get("message") or {}
            return {"content": m.get("content") or "", "thinking": m.get("thinking") or "", "finish": r.json().get("done_reason")}
        body = {"model": self.model_name(), "messages": messages, "max_tokens": max_tokens, "temperature": 0.6,
                "reasoning_effort": "none", "chat_template_kwargs": {"enable_thinking": False}}
        r = requests.post(self.base + "/chat/completions", headers=self.headers, data=json.dumps(body), timeout=timeout)
        r.raise_for_status()
        ch = r.json()["choices"][0]
        m = ch.get("message") or {}
        return {"content": m.get("content") or "", "thinking": m.get("reasoning") or m.get("reasoning_content") or "",
                "finish": ch.get("finish_reason")}

    def _chat(self, user: str) -> str:
        messages = self._build_messages(user)
        max_tokens = int(self.c.get("max_tokens", 900))
        out = self._request(messages, max_tokens)
        if not out["content"].strip():
            # 내용이 비어 있으면 대개 '생각 과정'이 토큰을 다 써버린 경우 → 토큰을 늘려 한 번 더 시도
            self.log.warning("LLM 응답이 비어 있음(종료사유=%s, 생각과정 %d자) → 토큰 %d 로 재시도", out["finish"], len(out["thinking"]), max_tokens * 3)
            out = self._request(messages, max_tokens * 3)
        txt = re.sub(r"<think>.*?</think>", "", out["content"], flags=re.S).strip()
        if not txt:
            self.log.warning("LLM 응답이 끝까지 비어 있음(종료사유=%s, 생각과정 %d자)", out["finish"], len(out["thinking"]))
        return txt

    @staticmethod
    def _parse_json(txt: str) -> Optional[Dict[str, Any]]:
        m = re.search(r"\{.*\}", txt, flags=re.S)
        if not m:
            return None
        try:
            return json.loads(m.group(0))
        except Exception:
            return None

    def _evidence(self, g: Group) -> str:
        lines = []
        for it in g.items[:8]:
            bits = [CHANNEL_LABEL.get(it.channel, it.channel), it.source, it.title]
            extra = []
            if it.growth_pct:
                extra.append("검색량 %s%%↑" % format(it.growth_pct, ","))
            if it.views:
                extra.append("조회수 %s" % fmt_count(it.views))
            if it.age_minutes is not None:
                extra.append(fmt_ago(it.age_minutes))
            if it.cluster_size and it.cluster_size > 1:
                extra.append("같은 사건 기사 %d건" % it.cluster_size)
            lines.append("- " + " / ".join(bits) + ((" (%s)" % ", ".join(extra)) if extra else ""))
        return "\n".join(lines)

    def suggest(self, g: Group) -> Optional[Dict[str, Any]]:
        gl = self.blog["guidelines"]
        user = (
            "다음은 오늘 여러 채널에서 교차 확인된 블로그 소재 후보입니다.\n"
            "소재: %s\n분류: %s\n점수 근거: %s\n수집 근거:\n%s\n\n"
            "네이버 블로그(주제: %s)에 올릴 글을 기획하세요. 조건: 사진 %d장 기준(사진 위주 구성), 본문 %d~%d자, "
            "제목은 핵심 키워드를 앞쪽에 두고 25~40자, 과장·낚시·부정적 표현 금지.\n"
            "JSON 형식으로만 답하세요: {\"titles\": [\"제목1\",\"제목2\",\"제목3\"], \"angle\": \"차별화 관점 한 줄\", "
            "\"outline\": [\"도입(사진1)\", \"...\", \"마무리\"], \"caution\": \"작성 시 주의점 한 줄\"}"
        ) % (g.label, g.category, "; ".join(g.reasons[:4]), self._evidence(g), ", ".join(self.blog["topics_include"]),
             gl["photos"], gl["min_chars"], gl["max_chars"])
        try:
            txt = self._chat(user)
        except Exception as e:
            self.log.warning("LLM 호출 실패(%s): %s", g.label, str(e).splitlines()[0])
            return None
        data = self._parse_json(txt)
        if not data:
            return {"raw": txt[:600]}
        return data
