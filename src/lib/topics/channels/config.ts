/**
 * 실시간 채널 발굴 설정 — 원본 reference/contents-finder/config.yaml 의 값을 그대로 옮겼습니다.
 * 점수 가중치·필터 단어·수집 페이지를 바꾸려면 여기만 고치면 됩니다.
 */
import { CATEGORY_LIST, NO_RESTRICTION } from "./filters";

export const DEFAULT_CHANNEL_CONFIG = {
  naverHome: { url: "https://m.naver.com/", scrollTimes: 20 },
  naverRanking: {
    /** 뉴스 랭킹(종합)은 언론사별 상위 5건 — 몇 위까지 가져올지 */
    pressRankMax: 5,
    /** 섹션 '최신 기사' 목록까지 후보에 넣을지 (기본 꺼짐: 헤드라인만) */
    includeLatest: false,
    /** type: entertain = 조회수가 표시되는 엔터 랭킹 / press = 언론사별 랭킹(종합) / section = 섹션 헤드라인 */
    pages: [
      { name: "엔터 많이 본 뉴스", type: "entertain", url: "https://entertain.naver.com/ranking", category: "" },
      { name: "뉴스 랭킹(종합)", type: "press", url: "https://news.naver.com/main/ranking/popularDay.naver", category: "" },
      { name: "경제 섹션", type: "section", url: "https://news.naver.com/section/101", category: "비즈니스·경제" },
      { name: "IT/과학 섹션", type: "section", url: "https://news.naver.com/section/105", category: "IT·컴퓨터" },
      { name: "사회 섹션", type: "section", url: "https://news.naver.com/section/102", category: "사회·정치" },
      { name: "생활/문화 섹션", type: "section", url: "https://news.naver.com/section/103", category: "" },
    ] as { name: string; type: "entertain" | "press" | "section"; url: string; category: string }[],
  },
  nate: { keywordUrl: "https://www.nate.com/", pannUrl: "https://pann.nate.com/" },
  googleTrends: {
    hours: 24,
    /** 이 시간 이내에 시작된 키워드는 '초신선' */
    freshHours: 4,
    /** 검색량 증가율이 이 값 이상이면 '당일 즉시 소재' */
    instantPct: 1000,
    /** 구글 트렌드 카테고리 ID → 네이버 블로그 카테고리 ("" = 기사별 키워드 분류에 맡김) */
    categories: {
      "3": "비즈니스·경제",
      "15": "IT·컴퓨터",
      "18": "IT·컴퓨터",
      "6": "게임",
      "10": "사회·정치",
      "9": "교육·학문",
      "20": "사회·정치",
      "7": "건강·의학",
      "5": "",
      "19": "",
      "2": "패션·미용",
      "16": "상품리뷰",
      "13": "반려동물",
      "4": "",
      "14": "사회·정치",
      "17": "스포츠",
    } as Record<string, string>,
  },
  daum: {
    pages: [
      { name: "다음 홈(이 시각 주요뉴스)", url: "https://news.daum.net/", category: "" },
      { name: "다음 경제", url: "https://news.daum.net/economy", category: "비즈니스·경제" },
      { name: "다음 IT/과학", url: "https://news.daum.net/tech", category: "IT·컴퓨터" },
      { name: "다음 사회", url: "https://news.daum.net/society", category: "사회·정치" },
      { name: "다음 생활", url: "https://news.daum.net/life", category: "" },
      { name: "다음 문화", url: "https://news.daum.net/culture", category: "" },
    ],
    /** 다음 홈 '실시간 트렌드' 키워드도 수집 */
    trendKeywords: true,
  },
  googleNews: {
    perTopic: 40,
    topics: [
      { label: "비즈니스", id: "CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtdHZHZ0pMVWlnQVAB", category: "비즈니스·경제" },
      { label: "과학/기술", id: "CAAqKAgKIiJDQkFTRXdvSkwyMHZNR1ptZHpWbUVnSnJieG9DUzFJb0FBUAE", category: "IT·컴퓨터" },
      { label: "엔터테인먼트", id: "CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtdHZHZ0pMVWlnQVAB", category: "" },
      { label: "건강", id: "CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtdHZLQUFQAQ", category: "건강·의학" },
      { label: "대한민국", id: "CAAqIQgKIhtDQkFTRGdvSUwyMHZNRFp4WkRNU0FtdHZLQUFQAQ", category: "" },
    ],
  },
  filters: {
    excludePolitics: true,
    /** 하드 필터: 부정적 사건·사고 — 추천에서 제외 */
    negativeHard: ["사망", "숨져", "숨진", "별세", "타계", "사고", "참사", "폭행", "살인", "살해", "성추행", "성폭행", "성범죄", "자살", "극단적", "화재", "붕괴", "추락", "폭발", "학대", "마약", "구속", "체포", "기소", "재판", "실종", "시신", "전쟁", "테러", "지진", "확진", "감염", "비상사태", "갑질", "사기", "횡령", "음주운전", "뺑소니", "故", "추모", "부고", "피해자", "해고", "참변", "급발진", "돌진", "징계", "파면", "집단폭행", "숨지"],
    /** 소프트 필터: 감점만 */
    negativeSoft: ["논란", "폭로", "저격", "의혹", "루머", "불화", "이혼", "파경", "열애설", "결별", "탈세", "적발", "소송", "고소", "파업", "위반", "불법", "고발", "경고", "주의보"],
    /** 소재 묶음에서 빼는 너무 일반적인 키워드 (방송사·포털 이름) */
    ignoreKeywords: ["kbs", "mbc", "sbs", "jtbc", "ytn", "tvn", "google", "구글", "instagram", "인스타그램", "youtube", "유튜브", "naver", "네이버", "kakao", "카카오", "facebook", "조선일보", "중앙일보", "동아일보", "한겨레", "연합뉴스", "sxmb"],
    politics: ["대통령", "국회", "의원", "여당", "야당", "탄핵", "검찰", "특검", "정당", "총선", "대선", "국정감사", "국민의힘", "민주당", "청와대", "대통령실", "장관", "총리", "백악관", "트럼프", "중간선거", "선거", "이재명", "윤석열", "지지율", "한동훈", "국무회의"],
  },
  /** 점수 가중치 (0~100 상한) */
  scoring: {
    perChannel: 10,
    trend1000: 25,
    trend500: 15,
    trend200: 8,
    trend100: 4,
    fresh30: 15,
    fresh60: 12,
    fresh180: 8,
    fresh360: 4,
    naverRankTop3: 15,
    naverRankTop10: 10,
    naverRankOther: 5,
    naverViews50k: 8,
    naverViews30k: 5,
    naverHome: 12,
    naverPress5: 10,
    naverPress3: 7,
    naverPress2: 4,
    naverHeadline: 4,
    nateTop5: 10,
    nateOther: 6,
    gnewsCluster5: 5,
    gnewsCluster3: 2,
    daumMulti3: 6,
    offTopicPenalty: -15,
    softNegativePenalty: -15,
  },
};

export type ChannelConfig = typeof DEFAULT_CHANNEL_CONFIG;
export type Weights = ChannelConfig["scoring"];

/** 발굴 대상 카테고리 선택지 (32개 + 보류) */
export const CATEGORY_CHOICES = [...CATEGORY_LIST, NO_RESTRICTION];
