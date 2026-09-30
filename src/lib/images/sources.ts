import { env } from "../env";
import { generateImageWithGemini } from "../llm";
import { FONT_LINK, FONT_STACK, renderHtmlToPng, withPage } from "../browser";
import { escapeHtml } from "../util";

export type ImageResult = { buf: Buffer; ext: string; credit?: string; width?: number; height?: number };

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`이미지 다운로드 실패 ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Gemini 이미지 생성 — 블로그 삽화용. 글자는 넣지 않도록 지시합니다. */
export async function aiImage(prompt: string, aspect = "16:9"): Promise<ImageResult | null> {
  const buf = await generateImageWithGemini(
    `${prompt}. Clean modern blog illustration, soft lighting, high quality. Do not render any text, letters, logos or watermarks.`,
    aspect,
  );
  return buf ? { buf, ext: "png", credit: "AI 생성 이미지" } : null;
}

export async function unsplashImage(query: string): Promise<ImageResult | null> {
  if (!env.unsplashKey) return null;
  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape&content_filter=high`,
    { headers: { Authorization: `Client-ID ${env.unsplashKey}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { results: { urls: { regular: string }; user: { name: string }; links: { download_location: string } }[] };
  const pick = data.results[Math.floor(Math.random() * Math.min(3, data.results.length))];
  if (!pick) return null;
  // Unsplash API 가이드라인: 다운로드 시 download_location 호출
  fetch(`${pick.links.download_location}&client_id=${env.unsplashKey}`).catch(() => undefined);
  return { buf: await download(pick.urls.regular), ext: "jpg", credit: `Photo by ${pick.user.name} on Unsplash` };
}

export async function pexelsImage(query: string): Promise<ImageResult | null> {
  if (!env.pexelsKey) return null;
  const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`, {
    headers: { Authorization: env.pexelsKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { photos: { src: { large: string }; photographer: string }[] };
  const pick = data.photos[Math.floor(Math.random() * Math.min(3, data.photos.length))];
  if (!pick) return null;
  return { buf: await download(pick.src.large), ext: "jpg", credit: `Photo by ${pick.photographer} on Pexels` };
}

/** 공식 사이트 화면 캡처 — AI 도구 사용법 글에서 가장 신뢰도 높은 이미지 */
export async function screenshotImage(url: string): Promise<ImageResult | null> {
  if (!/^https?:\/\//.test(url)) return null;
  const buf = await withPage(
    async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForTimeout(2500);
      // 쿠키 배너 등 가림막 닫기 시도
      for (const label of ["Accept all", "모두 수락", "동의", "Accept", "Got it"]) {
        await page.getByRole("button", { name: label }).first().click({ timeout: 800 }).catch(() => undefined);
      }
      return page.screenshot({ type: "png" });
    },
    { width: 1280, height: 800 },
  );
  return { buf, ext: "png", credit: `${new URL(url).hostname} 화면 캡처` };
}

const PALETTES = [
  ["#1e3a8a", "#7c3aed"],
  ["#0f766e", "#2563eb"],
  ["#9333ea", "#db2777"],
  ["#0369a1", "#14b8a6"],
  ["#4338ca", "#0ea5e9"],
];

/** 모든 소스가 실패하거나 데모 모드일 때: 브랜드 컬러 일러스트 카드 */
export async function templateImage(label: string, sub = "", width = 1200, height = 675, seed = 0): Promise<ImageResult> {
  const [a, b] = PALETTES[Math.abs(seed) % PALETTES.length];
  const html = `<!doctype html><html><head><meta charset="utf-8">${FONT_LINK}<style>
  body{margin:0;width:${width}px;height:${height}px;font-family:${FONT_STACK};}
  .c{width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;color:#fff;
     background:radial-gradient(circle at 20% 20%,rgba(255,255,255,.18),transparent 40%),linear-gradient(135deg,${a},${b});text-align:center;}
  .l{font-size:${Math.round(width / 18)}px;font-weight:900;letter-spacing:-1px;padding:0 60px;line-height:1.25;word-break:keep-all;}
  .s{margin-top:18px;font-size:${Math.round(width / 40)}px;opacity:.9;padding:0 80px;word-break:keep-all;}
  .dots{position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.12) 1.5px,transparent 1.5px);background-size:28px 28px;}
  </style></head><body><div class="c"><div class="dots"></div><div class="l">${escapeHtml(label)}</div>${sub ? `<div class="s">${escapeHtml(sub)}</div>` : ""}</div></body></html>`;
  return { buf: await renderHtmlToPng(html, width, height), ext: "png", credit: "", width, height };
}

/** 대표 썸네일: 배경(AI 이미지 또는 그라디언트) + 큰 제목 + 브랜드 */
export async function thumbnailImage(opts: {
  headline: string;
  sub: string;
  background?: Buffer | null;
  width?: number;
  height?: number;
  seed?: number;
}): Promise<ImageResult> {
  const width = opts.width ?? 1200;
  const height = opts.height ?? 675;
  const [a, b] = PALETTES[Math.abs(opts.seed ?? 0) % PALETTES.length];
  const bg = opts.background ? `url(data:image/png;base64,${opts.background.toString("base64")}) center/cover` : `linear-gradient(135deg,${a},${b})`;
  const html = `<!doctype html><html><head><meta charset="utf-8">${FONT_LINK}<style>
  body{margin:0;width:${width}px;height:${height}px;font-family:${FONT_STACK};}
  .c{position:relative;width:100%;height:100%;background:${bg};}
  .o{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.55));}
  .t{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;color:#fff;padding:0 70px;}
  .h{font-size:${Math.round(width / 12)}px;font-weight:900;line-height:1.15;letter-spacing:-2px;word-break:keep-all;text-shadow:0 4px 18px rgba(0,0,0,.35);}
  .s{display:inline-block;margin-top:24px;font-size:${Math.round(width / 32)}px;font-weight:700;background:#facc15;color:#111;padding:8px 22px;border-radius:999px;}
  </style></head><body><div class="c"><div class="o"></div><div class="t"><div class="h">${escapeHtml(opts.headline)}</div><div class="s">${escapeHtml(opts.sub)}</div></div></div></body></html>`;
  return { buf: await renderHtmlToPng(html, width, height), ext: "png", width, height };
}
