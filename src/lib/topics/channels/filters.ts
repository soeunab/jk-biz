/**
 * 네이버 블로그 32개 카테고리 분류 + 부정/정치 이슈 필터 (원본: reference/contents-finder/finder/analysis/filters.py)
 * 목록·키워드는 원본 파이썬 사전을 그대로 옮겼습니다 (순서도 동일 — 동점일 때 먼저 나온 카테고리가 이깁니다).
 */

/** 네이버 블로그 공식 카테고리 체계 */
export const CATEGORY_LIST: string[] = ["문학·책", "영화", "미술·디자인", "공연·전시", "음악", "드라마", "스타·연예인", "만화·애니", "방송", "일상·생각", "육아·결혼", "반려동물", "좋은글·이미지", "패션·미용", "인테리어·DIY", "요리·레시피", "상품리뷰", "원예·재배", "게임", "스포츠", "사진", "자동차", "취미", "국내여행", "세계여행", "맛집", "IT·컴퓨터", "사회·정치", "건강·의학", "비즈니스·경제", "어학·외국어", "교육·학문"];
/** 카테고리로 거르지 않고 전체 후보를 봄 */
export const NO_RESTRICTION = "주제 선택 보류";
export const UNCLASSIFIED = "미분류";

/** 원 채널이 카테고리를 안 주는 항목의 키워드 기반 분류용 */
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "문학·책": ["소설", "시집", "수필", "문학", "작가", "출간", "신간", "서점", "독서", "베스트셀러", "에세이", "시인", "전자책", "북클럽", "책 추천", "완독", "출판사"],
  "영화": ["영화", "개봉", "박스오피스", "시사회", "감독", "주연", "영화관", "CGV", "롯데시네마", "메가박스", "다큐멘터리", "영화제", "칸영화제", "오스카", "관객수"],
  "미술·디자인": ["전시회", "미술관", "화가", "작품", "갤러리", "디자인", "일러스트", "그림", "조각", "아트페어", "비엔날레", "아트토이", "캘리그라피"],
  "공연·전시": ["공연", "뮤지컬", "연극", "전시", "무대", "오페라", "발레", "티켓팅", "공연장", "예매", "내한공연"],
  "음악": ["음악", "가수", "앨범", "음원", "콘서트", "작곡", "밴드", "오케스트라", "힙합", "발라드", "케이팝", "빌보드", "멜론차트", "신곡", "컴백 무대"],
  "드라마": ["드라마", "방영", "본방송", "시청률", "넷플릭스 드라마", "티빙", "웨이브", "종영", "첫방", "결방", "극본", "연출", "회차"],
  "스타·연예인": ["배우", "아이돌", "열애", "결혼설", "이혼", "컴백", "데뷔", "소속사", "팬미팅", "화보", "연예인", "스타", "근황"],
  "만화·애니": ["웹툰", "만화", "애니메이션", "애니", "네이버웹툰", "카카오웹툰", "코스프레", "일본 애니", "지브리", "연재", "정식발매"],
  "방송": ["예능", "방송", "출연", "MC", "유퀴즈", "무한도전", "런닝맨", "나혼자산다", "케이블", "공개방송", "라디오", "제작발표회"],
  "일상·생각": ["일상", "생각", "오늘", "하루", "일기", "단상", "소소한", "에피소드", "경험담", "느낀점"],
  "육아·결혼": ["육아", "결혼", "출산", "임신", "신혼", "아기", "돌잔치", "유치원", "어린이집", "부부", "웨딩", "혼인", "산후조리", "육아휴직"],
  "반려동물": ["반려동물", "강아지", "고양이", "펫", "동물병원", "산책", "사료", "입양", "유기동물", "펫샵"],
  "좋은글·이미지": ["좋은글", "명언", "글귀", "위로", "힐링", "동기부여", "감성글", "응원글"],
  "패션·미용": ["패션", "코디", "화장품", "메이크업", "스킨케어", "뷰티", "헤어", "네일", "향수", "브랜드"],
  "인테리어·DIY": ["인테리어", "셀프인테리어", "가구", "소품", "리모델링", "집꾸미기", "원룸 인테리어", "DIY", "수납", "가전"],
  "요리·레시피": ["레시피", "요리", "집밥", "반찬", "베이킹", "에어프라이어", "자취요리", "간단요리", "밀키트", "다이어트 식단", "식음료"],
  "상품리뷰": ["리뷰", "사용기", "언박싱", "구매후기", "가성비", "신제품 후기", "추천템"],
  "원예·재배": ["식물", "화분", "가드닝", "텃밭", "다육이", "분갈이", "원예", "재배", "씨앗"],
  "게임": ["게임", "출시", "업데이트", "패치", "콘솔", "PC게임", "모바일게임", "롤", "배틀그라운드", "스팀", "닌텐도", "플레이스테이션"],
  "스포츠": ["축구", "야구", "농구", "배구", "골프", "올림픽", "아시안게임", "프리미어리그", "손흥민", "이강인", "월드컵", "UFC", "감독", "선수"],
  "사진": ["사진", "촬영", "카메라", "렌즈", "출사", "사진전", "스냅"],
  "자동차": ["자동차", "신차", "전기차", "시승기", "연비", "테슬라", "현대차", "기아", "제네시스"],
  "취미": ["취미", "원데이클래스", "동호회", "만들기", "공예"],
  "국내여행": ["국내여행", "여행지", "제주도", "부산", "강원도", "경주", "전주", "여행 코스", "당일치기", "호캉스"],
  "세계여행": ["해외여행", "유럽여행", "일본여행", "여행기", "항공권", "환승", "여행 브이로그", "배낭여행"],
  "맛집": ["맛집", "식당", "카페", "디저트", "웨이팅", "브런치", "맛집 추천"],
  "IT·컴퓨터": ["AI", "인공지능", "챗GPT", "삼성", "애플", "아이폰", "갤럭시", "앱", "구글", "유튜브", "우주", "로켓", "양자", "반도체", "배터리", "과학", "연구", "스마트폰", "테슬라", "로봇", "자율주행", "전기차", "메타", "엔비디아", "칩", "클라우드", "보안", "해킹", "소프트웨어", "OS", "업데이트", "출시", "신제품", "노트북", "컴퓨터", "코딩", "개발자"],
  "사회·정치": ["대통령", "국회", "의원", "여당", "야당", "총선", "대선", "탄핵", "정부", "장관", "교육", "학교", "복지", "노동", "지하철", "교통", "청년", "저출산", "의료", "병원", "수능", "입시", "돌봄", "주거", "고용", "취업", "실업", "제도", "법안", "시행", "판결", "시위"],
  "건강·의학": ["건강", "질병", "병원", "치료", "의학", "약", "백신", "다이어트", "운동", "영양제", "검진", "증상", "질환"],
  "비즈니스·경제": ["금리", "환율", "주식", "코스피", "코스닥", "증시", "부동산", "전세", "월세", "아파트", "청약", "월급", "연봉", "세금", "연말정산", "대출", "예금", "적금", "물가", "ETF", "연금", "재테크", "투자", "배당", "채권", "국채", "유가", "무역", "수출", "관세", "은행", "보험", "카드", "소비", "창업", "자영업", "최저임금", "가계부", "지원금", "환급", "절세", "저축", "기업", "실적", "매출"],
  "어학·외국어": ["영어", "일본어", "중국어", "토익", "오픽", "어학연수", "외국어 공부", "회화", "문법"],
  "교육·학문": ["교육", "입시", "수능", "대학", "학교", "논문", "연구", "학원", "자격증", "공부법", "학점"],
};

const FALSE_POS = /사고력|사고방식|사고 방식|사고싶|사고 싶|사고팔|사고 팔|사고\s*나면/g;

export function findMatches(text: string, words: Iterable<string>): string[] {
  const t = (text ?? "").replace(FALSE_POS, " ");
  const hits: string[] = [];
  for (const w of words) if (w && t.includes(w)) hits.push(w);
  return hits;
}

/** 부정 키워드가 들어 있지만 실제로는 부정적이지 않은 표현 ('폭발적 인기', '사고방식' 등) */
const BENIGN = ["폭발적", "사고방식", "사고력", "사고 싶", "사고팔", "사고 파", "기소유예"];

export type FilterWords = { negativeHard: string[]; negativeSoft: string[]; politics: string[] };
export type Flags = { hard: string[]; soft: string[]; politics: string[] };

export function flagText(text: string, f: FilterWords): Flags {
  let cleanText = text;
  for (const b of BENIGN) cleanText = cleanText.split(b).join(" ");
  return {
    hard: findMatches(cleanText, f.negativeHard),
    soft: findMatches(text, f.negativeSoft),
    politics: findMatches(text, f.politics),
  };
}

/** 키워드 점수로 분류 — 가장 많이 맞은 카테고리, 동점이면 목록에서 먼저 나온 것, 하나도 없으면 '미분류' */
export function classifyText(text: string): string {
  let best = UNCLASSIFIED;
  let bestScore = 0;
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    const n = words.filter((w) => text.includes(w)).length;
    if (n > bestScore) {
      best = cat;
      bestScore = n;
    }
  }
  return best;
}

/** 원 채널이 붙여 준 카테고리 투표를 우선 (동점이면 먼저 나온 투표), 없으면 키워드 분류 */
export function resolveCategory(votes: string[], text: string): string {
  const counts = new Map<string, number>();
  for (const v of votes) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (!counts.size) return classifyText(text);
  let top = "";
  let n = 0;
  for (const [v, c] of counts) if (c > n) [top, n] = [v, c];
  return top;
}

// ---------------------------------------------------------------- 개선된 분류 (원본과 다름 — config.tuning.weightedClassify)
// 원본 분류의 문제: 32개 중 4개만 원 채널이 카테고리를 알려 주고 나머지는 키워드 개수로 정하는데,
//  ① '출시·업데이트·연구·감독·스타' 같은 여러 분야 공통어가 1점씩 들어가 엉뚱한 분류가 나오고 ('스타벅스' → 스타·연예인)
//  ② 동점이면 목록 앞쪽이 이겨 'IT·컴퓨터'(뒤쪽)가 '게임'(앞쪽)에 밀리고
//  ③ 'AI'·'출시' 정도만 있는 IT 기사, '영업이익·상장' 같은 경제 기사 핵심어가 목록에 없었습니다.
// 그래서 공통어는 0.4점, 분야 핵심어를 보강하고, 동점·약한 근거는 '애매함'으로 표시해 AI 재분류(discover.ts)에 넘깁니다.

/** 원본 목록에 더하는 분야 핵심어 */
export const EXTRA_CATEGORY_KEYWORDS: Record<string, string[]> = {
  "IT·컴퓨터": ["클로드", "Claude", "제미나이", "Gemini", "오픈AI", "OpenAI", "앤트로픽", "Anthropic", "LLM", "생성형", "GPT", "ChatGPT", "딥시크", "코파일럿", "챗봇", "퍼플렉시티", "그록", "미드저니", "에이전트", "데이터센터", "HBM", "파운드리", "GPU", "오픈소스", "마이크로소프트", "온디바이스", "하이퍼클로바", "빅테크", "플랫폼"],
  "비즈니스·경제": ["영업이익", "상장", "IPO", "기업가치", "시가총액", "시총", "인수", "합병", "공모주", "증권", "금융", "가상자산", "비트코인", "원달러", "GDP", "소상공인", "부가세", "종부세", "양도세", "주담대", "DSR", "적자", "흑자", "유상증자", "주가", "목표가", "펀드", "파킹통장", "CMA", "ISA", "기준금리", "달러", "엔화", "수수료", "신용점수", "보조금", "바우처", "근로장려금", "몸값", "경기침체"],
  "세계여행": ["해외", "비자", "입국", "출국", "면세", "환전", "이심", "eSIM", "로밍", "여권", "직항", "베트남", "태국", "다낭", "하와이", "괌", "유럽", "오사카", "도쿄", "후쿠오카"],
  "국내여행": ["여행", "축제", "단풍", "휴양림", "캠핑", "글램핑", "둘레길", "케이블카", "리조트", "펜션", "가볼만한곳", "나들이"],
  "맛집": ["빵집", "오마카세", "미쉐린", "노포", "팝업"],
  "요리·레시피": ["만드는 법", "황금레시피"],
  "건강·의학": ["독감", "코로나", "감기", "수면", "혈압", "당뇨", "비만", "위고비", "탈모", "치매", "건강검진", "예방접종"],
  "패션·미용": ["올리브영", "선크림", "쿠션"],
  "게임": ["e스포츠", "LCK", "롤드컵", "넥슨", "엔씨소프트", "크래프톤", "넷마블", "닌텐도 스위치"],
  "스포츠": ["경기", "리그", "득점", "홈런", "KBO", "K리그", "대표팀", "MLB", "NBA"],
  "자동차": ["SUV", "하이브리드", "충전소", "완성차", "모빌리티", "수입차"],
  "육아·결혼": ["부모급여", "아동수당", "출산율"],
  "반려동물": ["반려견", "반려묘", "펫푸드"],
  "공연·전시": ["페스티벌", "전시회"],
  "음악": ["뮤직비디오", "음방"],
  "드라마": ["OTT", "디즈니플러스", "쿠팡플레이"],
  "영화": ["극장", "개봉작"],
  "문학·책": ["노벨문학상", "만해문학상"],
  "교육·학문": ["모의고사", "내신", "대입"],
};

/** 여러 분야에 두루 나오는 말 — 0.4점만 */
export const GENERIC_CATEGORY_WORDS = new Set([
  "출시", "업데이트", "연구", "감독", "선수", "브랜드", "스타", "약", "오늘", "하루", "생각", "일상", "작품", "그림", "디자인", "카드", "소비",
  "보험", "운동", "교육", "학교", "병원", "앱", "칩", "메타", "보안", "리뷰", "사진", "방송", "출연", "전시", "무대", "삼성", "애플", "구글",
  "유튜브", "과학", "가전", "산책", "입양", "시행", "제도", "정부", "청년", "의료", "배터리", "전기차", "테슬라", "예매", "컴백", "근황",
  "식음료", "소품", "재배", "기아", "기업", "플랫폼", "에이전트", "해외", "여행", "경기", "팝업", "베트남", "태국", "유럽", "달러", "수수료",
  "연휴", "축제", "카페", "식당", "MC", "OS", "롤", "펫", "공연", "음악", "영화", "드라마",
]);

const LATIN = /^[A-Za-z0-9 .+-]+$/;
const wordRe = new Map<string, RegExp>();
/** 영문 낱말은 앞뒤가 영문이 아닐 때만 ('OS' 가 'costco' 에, 'AI' 가 'OpenAI' 의 일부로 잡히지 않게) */
export function hasWord(text: string, w: string): boolean {
  if (!LATIN.test(w)) return text.includes(w);
  let re = wordRe.get(w);
  if (!re) wordRe.set(w, (re = new RegExp(`(?<![A-Za-z])${w.replace(/[.+-]/g, "\\$&")}(?![A-Za-z])`, "i")));
  return re.test(text);
}

const WEIGHTED: [string, [string, number][]][] = CATEGORY_LIST.map((cat) => {
  const words = [...new Set([...(CATEGORY_KEYWORDS[cat] ?? []), ...(EXTRA_CATEGORY_KEYWORDS[cat] ?? [])])];
  return [cat, words.map((w) => [w, GENERIC_CATEGORY_WORDS.has(w) ? 0.4 : 1] as [string, number])];
});

export type CategoryGuess = { category: string; score: number; runnerUp: string; ambiguous: boolean };

/** 카테고리별 가중 점수 (분야 핵심어 1점, 공통어 0.4점) */
export function categoryScores(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [cat, words] of WEIGHTED) {
    let s = 0;
    for (const [w, wt] of words) if (hasWord(text, w)) s += wt;
    if (s > 0) out.set(cat, Math.round(s * 10) / 10);
  }
  return out;
}

/**
 * 가중 키워드 분류. 1위·2위가 동점이면 ambiguous — AI 재분류 대상.
 * 하나도 안 맞거나 공통어뿐(1점 미만)이면 미분류(ambiguous).
 */
export function classifyWeighted(text: string, among?: string[]): CategoryGuess {
  const ranked = [...categoryScores(text)].filter(([c]) => !among || among.includes(c)).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { category: among?.[0] ?? UNCLASSIFIED, score: 0, runnerUp: "", ambiguous: !among };
  const [[cat, s], second] = [ranked[0], ranked[1]];
  // 공통어만 맞았으면(1점 미만) 추측하지 않고 미분류 — '스타벅스'가 '스타' 때문에 연예인이 되던 문제
  if (s < 1 && !among) return { category: UNCLASSIFIED, score: s, runnerUp: cat, ambiguous: true };
  return { category: cat, score: s, runnerUp: second?.[0] ?? "", ambiguous: s < 1 || (!!second && second[1] === s) };
}

/**
 * 원 채널 투표 우선 — 투표 1위가 동점이면 키워드 점수로 가림.
 * 투표가 없으면 기사 제목별로 분류해 다수결 (합친 글에서 단어 하나가 분류를 정하지 않도록 — '최태원' 소송 기사 3건 + IPO 기사 1건이
 * 경제로 가던 문제). 지지하는 기사가 절반 미만이면 ambiguous.
 */
export function resolveCategoryWeighted(votes: string[], text: string, titles: string[] = []): CategoryGuess {
  const counts = new Map<string, number>();
  for (const v of votes) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (!counts.size) {
    const whole = classifyWeighted(text);
    if (titles.length < 2) return whole;
    const per = new Map<string, number>();
    for (const t of titles) {
      const c = classifyWeighted(t).category;
      if (c !== UNCLASSIFIED) per.set(c, (per.get(c) ?? 0) + 1);
    }
    if (!per.size) return { ...whole, ambiguous: true };
    const top = Math.max(...per.values());
    const tied = [...per].filter(([, n]) => n === top).map(([c]) => c);
    const pick = tied.length === 1 ? tied[0] : classifyWeighted(text, tied).category;
    return { category: pick, score: whole.score, runnerUp: whole.runnerUp, ambiguous: whole.ambiguous || tied.length > 1 || top * 2 < titles.length };
  }
  const max = Math.max(...counts.values());
  const tied = [...counts].filter(([, c]) => c === max).map(([v]) => v);
  if (tied.length === 1) return { category: tied[0], score: max, runnerUp: "", ambiguous: false };
  const kw = classifyWeighted(text, tied);
  return { ...kw, ambiguous: kw.score === 0 || kw.ambiguous };
}

/** 수집 페이지의 카테고리 지정값 — '국내여행,세계여행' 처럼 여러 개면 제목 키워드로 그중 하나 (못 가르면 첫 번째) */
export function pickCategory(title: string, spec: string): string {
  const opts = spec.split(",").map((s) => s.trim()).filter(Boolean);
  if (opts.length <= 1) return opts[0] ?? "";
  return classifyWeighted(title, opts).category;
}
