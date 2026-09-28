/**
 * 고위험 주제(세무·금융·법률·건강·부동산·정부지원) 감지.
 * 이 블로그는 1인 가구 지원금·청약, 프리랜서 종합소득세처럼 사람의 돈·권리에 영향을 주는 주제를 다루므로
 * 감지되면 출처 필수·예측성 표현 금지·고지 문구 자동 삽입을 적용합니다.
 * (자동 검사는 차단을 결정하지 않고, 사람이 읽을 수 있는 사유를 만들어 검수를 돕는 역할만 합니다.)
 */
export type RiskCategory = "TAX" | "INVEST" | "FINANCE" | "LEGAL" | "HEALTH" | "HOUSING" | "WELFARE";

/** 투자 주제 필수 고지 문구 — 렌더러가 자동 삽입하고, 점검 항목이 실제로 들어갔는지 확인합니다. */
export const INVEST_DISCLAIMER = "이 글은 정보 제공 목적이며 투자 권유가 아닙니다. 최종 판단과 책임은 본인에게 있습니다.";
/** 고지 문구가 표현만 조금 달라도 인정: "투자 권유가 아님" + "판단·책임은 본인(투자자)" 두 요소가 모두 있어야 함 */
export function hasInvestDisclaimer(text: string): boolean {
  const plain = text.replace(/<[^>]+>/g, " ");
  return /투자\s?(권유|권고)(가|를)?\s?(아닙|아니|아님|하지\s?않)/.test(plain) && /(책임|판단)[^.。]{0,20}(본인|투자자)/.test(plain);
}

const RULES: { cat: RiskCategory; label: string; re: RegExp; caseSensitive?: RegExp; disclaimer: string }[] = [
  {
    cat: "TAX",
    label: "세무",
    re: /(세금|종합소득세|종소세|부가세|부가가치세|원천징수|연말정산|세액|절세|홈택스|경비처리|사업자등록)/,
    disclaimer: "이 글은 일반적인 정보이며, 개인 상황에 따라 세액·신고 방법이 달라질 수 있으니 국세청(홈택스) 또는 세무 전문가에게 확인하세요.",
  },
  {
    cat: "INVEST",
    label: "투자·재테크",
    // 종목명 없이 실적·배당·공시만 언급해도 투자 주제로 봄. 단독 "실적"(업무 실적 등)은 제외하고 분기·발표와 결합된 경우만.
    re: /(주식|주가|종목|증시|코스피|코스닥|나스닥|배당|공모주|매수|매도|코인|가상자산|비트코인|펀드|etf|재테크|투자\s?(상품|방법|수익|종목|전략|포트폴리오)|실적\s?(발표|시즌|전망|공개)|어닝|([1-4]\s?분기|연간|반기|잠정|분기)\s?실적|공시(?!하듯|처럼)|dart|목표\s?주가|시가\s?총액|시총|상장\s?(예정|폐지|일)|ipo|자사주|주주\s?(총회|환원))/i,
    // 투자 지표 약어는 대문자일 때만 ("per 인원" 같은 일반 영어 오탐 방지)
    caseSensitive: /\b(PER|PBR|EPS|ROE)\b/,
    disclaimer: INVEST_DISCLAIMER,
  },
  {
    cat: "FINANCE",
    label: "금융상품",
    re: /(대출|금리|적금|예금|보험|신용점수)/,
    disclaimer: "이 글은 일반적인 정보이며 금융상품 가입 권유가 아닙니다. 조건은 금융사·상품마다 다르니 공식 안내를 확인하세요.",
  },
  {
    cat: "LEGAL",
    label: "법률",
    re: /(법률|소송|계약서|근로계약|저작권|개인정보보호법|위약금|손해배상|고소)/,
    disclaimer: "이 글은 일반적인 정보이며 법률 자문이 아닙니다. 구체적인 사안은 변호사 등 전문가와 상담하세요.",
  },
  {
    cat: "HEALTH",
    label: "건강·의료",
    re: /(건강검진|건강관리|질병|증상|치료|약물|병원|다이어트|영양제|수면장애|우울증)/,
    disclaimer: "이 글은 의학적 조언이 아닙니다. 건강 관련 결정은 의료 전문가와 상담하세요.",
  },
  {
    cat: "HOUSING",
    label: "부동산·주거",
    re: /(청약|전세|월세|보증금|임대차|부동산|주택담보)/,
    disclaimer: "청약·임대차 조건은 공고와 법령에 따라 달라지므로 반드시 공식 공고(청약홈 등)와 계약서를 확인하세요.",
  },
  {
    cat: "WELFARE",
    label: "정부지원",
    re: /(지원금|보조금|정부지원|수당|바우처|복지|국민취업지원|청년도약|장려금)/,
    disclaimer: "지원 대상·금액·신청 기간은 공고마다 달라지므로 반드시 정부24·복지로 등 공식 공고에서 확인하세요.",
  },
];

/** 예측·보장·매매 추천 표현 (고위험 주제에서 금지) */
export const PREDICTIVE_RE =
  /(오를 것|오를 전망|오를 가능성이 높|상승할 것|급등할|떨어질 것|하락할 것|반드시 오|확실히 (벌|받|오르)|무조건 (받|벌|오르|승인)|수익 보장|100% (환급|승인|보장)|지금이 (매수|매도|살) ?(시점|타이밍|때|기회)|매수 (타이밍|적기)|사야 할 때|추천 종목|매수하세요|매도하세요)/;

/** "지금 사야 하나요?" 류 매매 판단 질문 */
export const BUY_SELL_QUESTION_RE = /(사야 ?(하나요|할까요|되나요)|살까요|사도 (될까요|되나요)|매수해도|매수할까요|팔아야|팔까요|매도해야|매도할까요|지금 들어가도|손절해야)/;
/** 매매를 대신 판단해 주는 답변 표현 */
export const TRADE_ADVICE_RE = /(사세요|매수하세요|매수를 추천|파세요|매도하세요|매도를 추천|지금 사는 (게|것이) (좋|낫)|지금이 기회|들어가셔도 (좋|됩)|추천합니다)/;

/** FAQ 중 매매 판단 질문에 매매를 권유하는 답이 달린 항목 */
export function tradeAdviceFaqs(faq: { q: string; a: string }[]) {
  return faq.filter((f) => BUY_SELL_QUESTION_RE.test(f.q) && TRADE_ADVICE_RE.test(f.a));
}

export type RiskResult = { categories: RiskCategory[]; labels: string[]; disclaimers: string[] };

/** 원고의 주제 신호(키워드·제목·소제목)로만 판단 — 본문의 스쳐 가는 단어로 오탐하지 않도록 */
export function manuscriptRiskText(m: { focusKeyword: string; title: string; sections: { heading: string }[] }) {
  return [m.focusKeyword, m.title, ...m.sections.map((s) => s.heading)].join(" ");
}

export function detectRisk(text: string): RiskResult | null {
  const hits = RULES.filter((r) => r.re.test(text) || r.caseSensitive?.test(text));
  if (!hits.length) return null;
  return { categories: hits.map((h) => h.cat), labels: hits.map((h) => h.label), disclaimers: hits.map((h) => h.disclaimer) };
}

export function riskPromptRules(risk: RiskResult | null): string {
  if (!risk) return "";
  return `
[고위험 주제 규칙 — 감지: ${risk.labels.join(", ")}]
- 금액·요건·기한·세율 등 핵심 주장마다 공식 출처(정부·기관·공식 문서)를 sources 에 기록하세요. 출처가 없으면 쓰지 말고 reviewChecklist 에 남기세요.
- "오를 것이다", "무조건 받는다", "수익 보장" 같은 예측·보장 표현을 쓰지 마세요. 확인된 사실과 판단에 필요한 재료만 제공하세요.
- 개인 상황에 따라 달라질 수 있다는 점을 본문에 밝히세요. (고지 문구는 시스템이 자동으로 붙입니다)${
    risk.categories.includes("INVEST")
      ? `
- [투자·재테크] 본문 결론부에 "${INVEST_DISCLAIMER}" 문장을 그대로 넣으세요.
- [투자·재테크] "오를 것이다", "지금이 매수 시점이다", "추천 종목" 같은 예측·추천을 쓰지 말고, 실적·공시·공식 발표 등 확인된 사실만 전달하세요.
- [투자·재테크] "지금 사야 하나요?" 같은 FAQ 에는 매수·매도를 대신 판단하지 말고 "확인된 사실 + 앞으로 지켜볼 지표(실적 발표일, 공시, 금리 등)"만 답하세요.`
      : ""
  }`;
}
