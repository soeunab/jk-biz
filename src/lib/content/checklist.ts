/**
 * 사람 검수 체크리스트·AI 확인 필요 목록 정리 — 사람이 원고에서 실제로 해야 할 일만 남깁니다.
 * 2026-10-08 사용자 지적: 검수까지 했는데 '사람 확인 필요'·체크리스트가 10개나 남음 → 실제로 할 일은 2~3개였음.
 * 빼는 것:
 *  - 원고에 쓰지 않은 내용("본문에 쓰지 않음", "그대로 두세요")·이미 적절히 유보한 내용 — 할 일이 없음
 *  - [경험 추가] 자리표시 — '승인 전 확인 사항'에 이미 개수로 나옴(중복)
 *  - 클립 추가 같은 제안 — 확인 항목이 아니라 팁(화면에 따로 표시)
 *  - 내부 링크 확인 — 프로그램이 직접 확인(linksOk 면 뺌, 깨진 링크는 따로 표시)
 *  - 스크린샷 교체 — 원고에 화면 캡처 이미지가 없으면 뺌
 */
const NOTHING_TO_DO = /(본문에\s*(쓰지|넣지|포함하지)\s*않|쓰지\s*않았으니|그대로\s*두세요|적절히\s*유보|이미\s*유보|원고에\s*(없|쓰지\s*않))/;
const PLACEHOLDER = /\[경험 추가|경험 자리표시|자리표시\s*\d*\s*(곳|개)/;
const TIP = /클립\(숏폼\)|클립 추가/;
const LINK = /내부\s*링크|내부링크/;
const SCREENSHOT = /스크린샷|화면 캡처|캡처 이미지/;

export function actionableItems(items: string[], ctx: { linksOk?: boolean; hasScreenshots?: boolean } = {}): string[] {
  const seen = new Set<string>();
  return items.filter((c) => {
    if (NOTHING_TO_DO.test(c) || PLACEHOLDER.test(c) || TIP.test(c)) return false;
    if (ctx.linksOk && LINK.test(c)) return false;
    if (ctx.hasScreenshots === false && SCREENSHOT.test(c)) return false;
    const key = c.replace(/\s*\((추가 조사|사람이 직접 처리):.*$/s, "").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 원고 본문의 링크 중 내 블로그 글로 가는 것 (네이버 blog.naver.com/{id}/…, 계정 주소로 시작) */
export function internalLinksOf(text: string, blogPrefixes: string[]): string[] {
  const urls = [...text.matchAll(/https?:\/\/[^\s)"'<>\]]+/g)].map((m) => m[0].replace(/[.,]+$/, ""));
  return [...new Set(urls.filter((u) => blogPrefixes.some((p) => p && u.toLowerCase().startsWith(p.toLowerCase()))))];
}

/** 링크가 열리는지 (네이버 글은 PostView 로) — 깨진 것만 돌려줌 */
export async function brokenLinks(urls: string[]): Promise<string[]> {
  const broken: string[] = [];
  for (const u of urls) {
    const naver = u.match(/blog\.naver\.com\/([^/?#]+)\/(\d+)/);
    const target = naver ? `https://blog.naver.com/PostView.naver?blogId=${naver[1]}&logNo=${naver[2]}` : u;
    try {
      const res = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000), redirect: "follow" });
      const body = res.ok ? await res.text() : "";
      // 네이버는 없는 글도 200 으로 안내 페이지를 줌 — 본문 영역이 없으면 깨진 것으로 봄
      if (!res.ok || (naver && !/se-main-container|se_component_wrap|post-view/.test(body))) broken.push(u);
    } catch {
      broken.push(u);
    }
  }
  return broken;
}
