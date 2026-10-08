import { withPage } from "../browser";

/**
 * 공식 페이지 원문 직접 읽기 — Claude 의 웹 읽기 도구(WebFetch)가 403 으로 막히는 공식 페이지가 많아
 * (2026-10-08: help.openai.com·chatgpt.com/pricing 은 Claude 에게 403, 스튜디오 브라우저로는 200)
 * 스튜디오 브라우저(Playwright)로 먼저 읽어 그 본문을 Claude 에게 넘깁니다. 사실 확인이 '확인 필요'로 남는 가장 큰 원인을 줄임.
 * 개인 블로그·집계·위키류는 근거로 쓰지 않으므로 읽지 않습니다.
 */
const NOT_OFFICIAL = /(blog\.naver\.com|m\.blog\.naver\.com|cafe\.naver\.com|tistory\.com|brunch\.co\.kr|velog\.io|medium\.com|wikidocs\.net|namu\.wiki|wikipedia\.org|blogspot\.com|youtube\.com|reddit\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|threads\.net)/i;

export type OfficialPage = { url: string; text: string };

/** 읽을 만한(공식일 가능성이 있는) 주소만, 중복 없이 */
export function officialCandidates(urls: string[], max = 6): string[] {
  const out: string[] = [];
  for (const u of urls) {
    if (!/^https?:\/\//.test(u) || NOT_OFFICIAL.test(u)) continue;
    const key = u.replace(/[#?].*$/, "").replace(/\/$/, "");
    if (out.some((o) => o.replace(/[#?].*$/, "").replace(/\/$/, "") === key)) continue;
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

/** 브라우저로 열어 본문 텍스트(앞부분)를 가져옴 — 열리지 않은 페이지는 빼고 돌려줌 */
export async function readOfficialPages(urls: string[], opts: { max?: number; chars?: number } = {}): Promise<OfficialPage[]> {
  const pages: OfficialPage[] = [];
  for (const url of officialCandidates(urls, opts.max ?? 6)) {
    const text = await withPage(
      async (page) => {
        const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        if (!res || res.status() >= 400) return "";
        await page.waitForTimeout(2000);
        return ((await page.evaluate("document.body ? document.body.innerText : ''")) as string).replace(/\s+/g, " ").trim();
      },
      { width: 1280, height: 1600 },
    ).catch(() => "");
    if (text.length > 300) pages.push({ url, text: text.slice(0, opts.chars ?? 6000) });
  }
  return pages;
}

/** 프롬프트에 넣을 블록 */
export function officialPagesBlock(pages: OfficialPage[] | undefined | null): string {
  if (!pages?.length) return "";
  return `\n[공식 페이지 원문 — 스튜디오 브라우저로 직접 읽은 본문. WebFetch 가 403·차단이어도 이 원문으로 확인하세요]\n${pages.map((p) => `■ ${p.url}\n${p.text}`).join("\n\n")}\n`;
}
