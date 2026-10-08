import { Marked, type Tokens } from "marked";
import { affiliateDisclosures, PROGRAM_LINK_LABEL, type Brand } from "../brand";
import { escapeHtml } from "../util";
import { adPlan } from "./adPlan";
import { PLACEHOLDER_RE, stripPlaceholders, type Manuscript } from "./types";

export type RenderImage = { slot: string; src: string; localPath?: string; alt: string; caption?: string; credit?: string; width?: number | null; height?: number | null };
export type RenderProduct = { id: string; name: string; url: string; program: string; price?: number | null };

export type RenderOptions = {
  brand: Brand;
  images: RenderImage[];
  products?: RenderProduct[];
  /** 블로거 계정 설정: 애드센스 인아티클 광고 */
  adsense?: { client?: string; slot?: string };
  canonicalUrl?: string;
  publishedAt?: Date;
  /** 경험 자리표시: 검수 미리보기에서는 강조, 발행본에서는 제거 (기본: 제거) */
  placeholders?: "highlight" | "strip";
  /** 고위험 주제 고지 문구 (risk.ts) */
  riskDisclaimers?: string[];
  /** 크로스플랫폼 재발행 원본 (url 은 원본이 발행된 뒤에만 있음) */
  sourceLink?: { title: string; url?: string };
};

const SOURCE_TOKEN = "{{원본링크}}";

function sourceAnchor(o: RenderOptions) {
  const s = o.sourceLink!;
  return s.url ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>` : `“${escapeHtml(s.title)}”`;
}

/** 본문에 원본 링크 자리({{원본링크}})가 있으면 링크로 바꾸고, 없으면 false 를 돌려 자동 삽입하게 합니다. */
function applySourceLink(html: string, o: RenderOptions) {
  if (!o.sourceLink) return html.replaceAll(SOURCE_TOKEN, "");
  return html.replaceAll(SOURCE_TOKEN, sourceAnchor(o));
}

function manuscriptHasSourceToken(m: Manuscript) {
  return JSON.stringify(m).includes(SOURCE_TOKEN);
}

/** 본문에서 원본을 언급하지 않았을 때 결론 앞에 넣는 자연스러운 백링크 문장 */
function sourceLinkParagraph(o: RenderOptions) {
  return `<p>📎 이 주제를 다른 관점에서 정리한 글도 있어요: ${sourceAnchor(o)}</p>`;
}

/** 자리표시만 있는 문단 (네이버용 본문 스타일 span 포함) */
const PLACEHOLDER_PARAGRAPH_RE = new RegExp(`<p>(?:<span[^>]*>)?\\s*(?:${PLACEHOLDER_RE.source}\\s*)+(?:</span>)?</p>`, "g");

/** 자리표시 처리 — 발행본에 "[경험 추가…]" 문구가 새어 나가지 않게 합니다. */
export function applyPlaceholders(html: string, mode: "highlight" | "strip" = "strip") {
  if (mode === "highlight") {
    return html.replace(PLACEHOLDER_RE, (m) => `<mark style="background:#fef08a;padding:2px 4px;border-radius:4px;">✍️ ${m}</mark>`);
  }
  return html.replace(PLACEHOLDER_PARAGRAPH_RE, "").replace(PLACEHOLDER_RE, "");
}

/** 링크·이미지 주소로 허용하는 형식: http(s)·mailto·문서 안 앵커(#)·상대 경로 */
export function isSafeHref(href: string | null | undefined): boolean {
  const h = (href ?? "").trim();
  if (!h) return false;
  if (/^(https?:|mailto:)/i.test(h)) return true;
  if (h.startsWith("#")) return true;
  // 상대 경로 — 스킴(javascript:, data:, vbscript: 등)이 없어야 함. 제어 문자·공백으로 스킴을 숨기는 경우도 막음
  return !/^[\s\u0000-\u001f]*[a-z][a-z0-9+.-]*:/i.test(h) && !h.startsWith("//") && !/[\u0000-\u001f]/.test(h);
}

/** 원고 마크다운에 섞여도 그대로 둘 단순 서식 태그 (속성 없는 것만) */
const ALLOWED_INLINE_HTML = /^<\/?(br|b|strong|em|i|u|sup|sub|mark)\s*\/?>$/i;

/**
 * 원고 전용 마크다운 변환기 — AI 답변·수동 붙여넣기에 섞인 HTML(스크립트·이벤트 속성)은 글자로 보이게 하고,
 * 링크·이미지는 안전한 주소만 남깁니다. (렌더러가 직접 만드는 jw-post 표·이미지·광고 마크업과는 별개)
 */
const manuscriptMarked = new Marked({
  async: false,
  gfm: true,
  breaks: true,
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      const raw = token.text ?? token.raw;
      return ALLOWED_INLINE_HTML.test(raw.trim()) ? raw.trim() : escapeHtml(raw);
    },
    link(token: Tokens.Link) {
      if (isSafeHref(token.href)) return false;
      return this.parser.parseInline(token.tokens);
    },
    image(token: Tokens.Image) {
      if (isSafeHref(token.href)) return false;
      return escapeHtml(token.text);
    },
  },
});

const md = (s: string) => manuscriptMarked.parse(s) as string;

/** 블로거 편집기 '아주 크게'(가로 640)와 같은 표시 폭 */
export const BLOGGER_XL_WIDTH = 640;

/**
 * 블로거 편집기가 '아주 크게 + 가운데'로 넣는 것과 같은 형식 (직접 올린 글의 이미지와 동일 구조).
 * 편집 화면에서 크기·정렬이 그대로 인식되고, 대체 텍스트(alt)·제목 텍스트(title)가 이미지 속성에 들어갑니다.
 * 캡션·출처가 있으면 블로거의 캡션 표(tr-caption-container) 형식.
 */
export function bloggerImage(img: RenderImage | undefined): string {
  if (!img?.src) return "";
  const src = escapeHtml(img.src);
  const alt = escapeHtml(img.alt);
  const title = escapeHtml(img.caption || img.alt);
  const dims =
    img.width && img.height
      ? ` data-original-height="${img.height}" data-original-width="${img.width}" height="${Math.round((BLOGGER_XL_WIDTH * img.height) / img.width)}"`
      : "";
  const tag = `<img alt="${alt}" border="0"${dims} src="${src}" title="${title}" width="${BLOGGER_XL_WIDTH}" />`;
  const caption = [img.caption, img.credit ? `(${img.credit})` : ""].filter(Boolean).join(" ");
  if (!caption)
    return `<div class="separator" style="clear: both; text-align: center;"><a href="${src}" style="margin-left: 1em; margin-right: 1em;">${tag}</a></div>`;
  return `<table align="center" cellpadding="0" cellspacing="0" class="tr-caption-container" style="margin-left: auto; margin-right: auto;"><tbody><tr><td style="text-align: center;"><a href="${src}" style="margin-left: auto; margin-right: auto;">${tag}</a></td></tr><tr><td class="tr-caption" style="text-align: center;">${escapeHtml(caption)}</td></tr></tbody></table>`;
}

// ---------------------------------------------------------------- 구글 블로거 (jw-post 디자인)
// 블로거 테마(jettheme)에 넣어 둔 '지원포유 글 디자인(jw-post) v3' CSS 클래스로만 꾸밉니다 — 색·여백을 원고에 직접 쓰지 않아
// 테마의 다크 모드·모바일 규칙이 그대로 적용되고, 디자인을 바꿀 땐 테마 CSS 만 고치면 됩니다.
// 네이버 원고(renderNaverSegments)는 이 형식을 쓰지 않습니다.

/** 네이버용 표 — 네이버 에디터는 외부 CSS 가 없어 인라인 스타일 그대로 (블로거 jw-post 와 별개) */
function naverTableHtml(t: { headers: string[]; rows: string[][] }) {
  const th = t.headers.map((h) => `<th style="border:1px solid #e5e7eb;padding:8px 10px;background:#f3f4f6;">${escapeHtml(h)}</th>`).join("");
  const rows = t.rows
    .map((r) => `<tr>${r.map((c) => `<td style="border:1px solid #e5e7eb;padding:8px 10px;">${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<div style="overflow-x:auto;margin:16px 0;"><table style="border-collapse:collapse;width:100%;font-size:15px;"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function tableHtml(t: { headers: string[]; rows: string[][] }) {
  const th = t.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const rows = t.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("");
  return `<table class="jw-table"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
}

/** 마크다운 본문 → jw-post 클래스 (목록·표·본문 링크) */
function jwMd(s: string): string {
  return md(s)
    .replace(/<ul>/g, '<ul class="jw-list">')
    .replace(/<table>/g, '<table class="jw-table">')
    .replace(/<a href=/g, '<a class="jw-ilink" href=');
}

function productBox(prod: RenderProduct, sentence: string, anchor: string) {
  return `<div class="jw-note"><p>${escapeHtml(sentence)}</p><p><a class="jw-ilink" href="${escapeHtml(prod.url)}" target="_blank" rel="sponsored noopener">👉 ${escapeHtml(anchor || prod.name)}${prod.price ? ` (${prod.price.toLocaleString("ko-KR")}원)` : ""}</a> <small>(${escapeHtml(linkLabel(prod))})</small></p></div>`;
}

/** 링크 옆 표시 — 독자가 광고 링크임을 바로 알 수 있게 */
function linkLabel(prod: RenderProduct) {
  return PROGRAM_LINK_LABEL[prod.program] ?? "제휴 링크";
}

/** 글에 실제로 쓰인 상품의 프로그램별 고지 문구 */
function usedDisclosures(m: Manuscript, products: Map<string, RenderProduct>, o: RenderOptions) {
  const programs = m.affiliate.map((a) => products.get(a.productId)?.program).filter((p): p is string => !!p);
  return programs.length ? affiliateDisclosures(programs, o.brand.disclosure.affiliate) : [];
}

function adsenseUnit(ad?: RenderOptions["adsense"]) {
  if (!ad?.client || !ad.slot) return "";
  return `<ins class="adsbygoogle" style="display:block;text-align:center;" data-ad-layout="in-article" data-ad-format="fluid" data-ad-client="${escapeHtml(ad.client)}" data-ad-slot="${escapeHtml(ad.slot)}"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});</script>`;
}

const anchorId = (i: number) => `sec-${i + 1}`;

/**
 * 구글 블로거용 HTML — jw-post 디자인 + 구조화 데이터(Article/FAQPage) + 애드센스 인아티클 슬롯.
 * 목차는 테마의 자동 목차(autoTOC, 위치 = noscript 태그)가 만들도록 &lt;noscript&gt; 자리만 둡니다.
 */
export function renderBlogger(m: Manuscript, o: RenderOptions): string {
  const img = (slot: string) => o.images.find((i) => i.slot === slot);
  const products = new Map((o.products ?? []).map((p) => [p.id, p]));
  const hasAffiliate = m.affiliate.some((a) => products.has(a.productId));
  // 광고 위치는 adPlan 규칙(첫 화면 제외·글 길이별 개수·상품 박스와 거리 두기)으로
  const adAfter = new Set(adPlan(m, m.affiliate.filter((a) => products.has(a.productId)).map((a) => a.afterSection)));
  const out: string[] = [];

  if (hasAffiliate) out.push(`<p class="jw-legend">${usedDisclosures(m, products, o).map((d) => `※ ${escapeHtml(d)}`).join("<br/>")}</p>`);
  out.push(bloggerImage(img("thumbnail")));
  out.push(`<p class="jw-lead">${escapeHtml(m.directAnswer)}</p>`);
  out.push(jwMd(m.intro));
  out.push(`<div class="jw-summary"><p class="jw-title">먼저 결론만</p><ul>${m.tldr.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul></div>`);
  if (o.riskDisclaimers?.length) out.push(`<div class="jw-todo">${o.riskDisclaimers.map((d) => `<p>⚠️ ${escapeHtml(d)}</p>`).join("")}</div>`);
  out.push("<noscript></noscript>"); // 테마 자동 목차 위치

  m.sections.forEach((s, i) => {
    const h = s.level === 3 ? 3 : 2;
    out.push(`<h${h} id="${anchorId(i)}">${escapeHtml(s.heading)}</h${h}>`);
    if (s.image) out.push(bloggerImage(img(s.image.slot)));
    out.push(jwMd(s.body));
    if (s.table) out.push(tableHtml(s.table));
    if (s.tip) out.push(`<div class="jw-note"><p>💡 <strong>꿀팁</strong> ${escapeHtml(s.tip)}</p></div>`);
    for (const a of m.affiliate.filter((a) => a.afterSection === i + 1)) {
      const prod = products.get(a.productId);
      if (prod) out.push(productBox(prod, a.sentence, a.anchorText));
    }
    if (adAfter.has(i)) out.push(adsenseUnit(o.adsense));
  });

  if (o.sourceLink && !manuscriptHasSourceToken(m)) out.push(sourceLinkParagraph(o));
  out.push(`<h2 id="faq">자주 묻는 질문</h2>`);
  out.push(`<div class="jw-faq">${m.faq.map((f) => `<p class="jw-q">Q. ${escapeHtml(f.q)}</p><p class="jw-a">${escapeHtml(f.a)}</p>`).join("")}</div>`);
  out.push(`<h2>마무리</h2>`, jwMd(m.conclusion), `<p class="jw-closing"><strong>${escapeHtml(m.cta)}</strong></p>`);

  if (m.sources.length) {
    out.push(
      `<div class="jw-note"><p><strong>참고 자료</strong></p><ul class="jw-list">${m.sources
        .map((s) => `<li><a class="jw-ilink" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a></li>`)
        .join("")}</ul></div>`,
    );
  }
  const date = (o.publishedAt ?? new Date()).toISOString().slice(0, 10);
  out.push(
    `<p class="jw-meta"><span>작성·검수: ${escapeHtml(o.brand.authorName)}</span><span>최종 업데이트: ${date}</span></p>`,
    `<p class="jw-legend">${escapeHtml(o.brand.authorBio)}<br/>${escapeHtml(o.brand.disclosure.ai)}</p>`,
  );
  const body = applySourceLink(applyPlaceholders(out.filter(Boolean).join("\n"), o.placeholders), o);
  return `<div class="jw-post">\n${body}\n</div>\n${jsonLd(m, o, date)}`;
}

function jsonLd(m: Manuscript, o: RenderOptions, date: string) {
  const thumb = o.images.find((i) => i.slot === "thumbnail");
  // 구조화 데이터는 화면에 안 보여도 검색엔진·AI 답변에 그대로 쓰이므로 자리표시를 항상 지움
  const t = stripPlaceholders;
  const graph = [
    {
      "@type": "BlogPosting",
      headline: t(m.title),
      description: t(m.metaDescription),
      keywords: [m.focusKeyword, ...m.relatedKeywords].map(t).filter(Boolean).join(", "),
      datePublished: date,
      dateModified: date,
      author: { "@type": "Organization", name: o.brand.authorName },
      publisher: { "@type": "Organization", name: o.brand.name },
      ...(thumb && /^https?:/.test(thumb.src) ? { image: thumb.src } : {}),
      ...(o.canonicalUrl ? { mainEntityOfPage: o.canonicalUrl } : {}),
    },
    {
      "@type": "FAQPage",
      mainEntity: m.faq.map((f) => ({ "@type": "Question", name: t(f.q), acceptedAnswer: { "@type": "Answer", text: t(f.a) } })),
    },
  ];
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

export type NaverSegment =
  | { type: "html"; html: string }
  | { type: "image"; localPath: string; src: string; caption: string; credit?: string }
  | { type: "heading"; text: string }
  /** 네이버 구분선 컴포넌트(가장 긴 "구분선 2") — 모든 소제목 바로 위에 넣어 섹션을 나눔 */
  | { type: "divider" };

// 네이버는 폰트 크기·색을 인라인 style 그대로 두지 않고 자체 클래스(se-fs-fsNN)로 바꿔치기하는데,
// span 에 명시적으로 안 넣으면 빈 값(se-fs-)이 되어 블로그 스킨 기본값에 따라 검정·회색이 뒤섞입니다.
// 그래서 모든 문단에 크기·색을 명시적으로 넣어 통일합니다 — 본문 16px 검정, 소제목 24px, 캡션·고지문 13px 회색.
const NAVER_BODY_STYLE = "font-size:16px;color:#000000;";
const NAVER_HEADING_STYLE = "font-size:24px;color:#000000;";
// 네이버 글자 크기는 프리셋(11/13/15/16/19/24/28/34/38)만 있어 18 대신 가장 가까운 19 사용
const NAVER_SUBHEADING_STYLE = "font-size:19px;color:#000000;";
const NAVER_MUTED_STYLE = "font-size:13px;color:#888888;";

/** marked() 가 만든 <p>/<li> 안쪽에 본문 스타일을 입힘 (네이버는 span 의 인라인 style 만 크기·색으로 인식) */
function naverBodyStyled(html: string): string {
  return html
    .replace(/<p>/g, `<p><span style="${NAVER_BODY_STYLE}">`)
    .replace(/<\/p>/g, `</span></p>`)
    .replace(/<li>/g, `<li><span style="${NAVER_BODY_STYLE}">`)
    .replace(/<\/li>/g, `</span></li>`);
}

/**
 * 네이버 스마트에디터 ONE 용 세그먼트.
 * 텍스트 블록은 HTML 붙여넣기, 이미지는 사진 업로드 버튼으로 순서대로 넣습니다.
 * (네이버는 스크립트·외부 스타일을 제거하므로 단순한 태그만 사용)
 */
export function renderNaverSegments(m: Manuscript, o: RenderOptions): NaverSegment[] {
  const segs: NaverSegment[] = [];
  const products = new Map((o.products ?? []).map((p) => [p.id, p]));
  let buf: string[] = [];
  const flush = () => {
    const html = applySourceLink(applyPlaceholders(buf.join(""), o.placeholders), o);
    if (html.trim()) segs.push({ type: "html", html });
    buf = [];
  };
  // 소제목·사진 설명은 HTML 붙여넣기가 아니라 에디터에 직접 입력되므로 자리표시를 여기서 따로 처리
  const plain = (s: string) => (o.placeholders === "highlight" ? s : stripPlaceholders(s));
  const pushImage = (slot: string) => {
    const im = o.images.find((i) => i.slot === slot);
    if (!im?.localPath) return;
    flush();
    segs.push({ type: "image", localPath: im.localPath, src: im.src, caption: plain(im.caption ?? im.alt), credit: im.credit });
  };
  // 네이버 스마트에디터의 실제 "소제목" 서식(레벨 2)으로 넣을 제목 — HTML 붙여넣기는 <h2> 를 인식하지 못해 굵은 글씨로만 남기 때문에 따로 처리
  const pushDivider = () => {
    flush();
    segs.push({ type: "divider" });
  };
  // 모든 소제목 바로 위에 가장 긴 구분선 (사용자 지정 양식)
  const pushHeading = (text: string) => {
    pushDivider();
    segs.push({ type: "heading", text: plain(text) });
  };
  const simpleMd = (s: string) =>
    naverBodyStyled(
      md(s)
        .replace(/<blockquote>/g, "<blockquote><p>")
        .replace(/<\/blockquote>/g, "</p></blockquote>"),
    );
  /** 본문 스타일(16px 검정)을 입힌 굵은 글씨 한 줄 */
  const bp = (inner: string) => `<p><span style="${NAVER_BODY_STYLE}"><b>${inner}</b></span></p>`;
  /** 본문 스타일(16px 검정)을 입힌 일반 문단 */
  const p = (inner: string) => `<p><span style="${NAVER_BODY_STYLE}">${inner}</span></p>`;
  /** 캡션·고지문 스타일(13px 회색) */
  const muted = (inner: string) => `<p><span style="${NAVER_MUTED_STYLE}">${inner}</span></p>`;

  // 대가성 고지는 회색 작은 글씨가 아니라 본문 크기로 — 독자가 놓치지 않게 (공정위 심사지침: 명확하게 표시)
  for (const d of usedDisclosures(m, products, o)) buf.push(bp(`※ ${escapeHtml(d)}`));
  pushImage("thumbnail");
  buf.push(bp(escapeHtml(m.directAnswer)), `<p><br></p>`);
  buf.push(bp("📌 핵심 요약"), m.tldr.map((t) => p(`✔ ${escapeHtml(t)}`)).join(""));
  if (o.riskDisclaimers?.length) buf.push(o.riskDisclaimers.map((d) => bp(`⚠️ ${escapeHtml(d)}`)).join(""));
  buf.push(simpleMd(m.intro));

  m.sections.forEach((s, i) => {
    buf.push(`<p><br></p>`);
    if (s.level === 3) buf.push(`<p><span style="${NAVER_SUBHEADING_STYLE}"><b>${escapeHtml(s.heading)}</b></span></p>`);
    else pushHeading(s.heading);
    if (s.image) pushImage(s.image.slot);
    buf.push(simpleMd(s.body));
    // 표는 네이버용 인라인 스타일 표, 표 안 글자 크기·색도 본문과 통일 (font-size 는 네이버가 셀 글자에 그대로 상속시킴)
    if (s.table) buf.push(naverTableHtml(s.table).replace('font-size:15px;">', `font-size:16px;color:#000000;">`));
    if (s.tip) buf.push(p(`💡 <b>꿀팁</b> ${escapeHtml(s.tip)}`));
    for (const a of m.affiliate.filter((a) => a.afterSection === i + 1)) {
      const prod = products.get(a.productId);
      if (prod) buf.push(p(escapeHtml(a.sentence)), p(`<a href="${escapeHtml(prod.url)}">👉 ${escapeHtml(a.anchorText || prod.name)}</a> (${escapeHtml(linkLabel(prod))})`));
    }
  });

  if (o.sourceLink && !manuscriptHasSourceToken(m)) buf.push(naverBodyStyled(sourceLinkParagraph(o)));
  pushHeading("자주 묻는 질문");
  for (const f of m.faq) buf.push(bp(`Q. ${escapeHtml(f.q)}`), p(`A. ${escapeHtml(f.a)}`), `<p><br></p>`);
  buf.push(simpleMd(m.conclusion), bp(escapeHtml(m.cta)));
  // 출처 링크는 네이버에서도 문제되지 않음 (같은 링크 반복 게재만 피하면 됨) — 신뢰도·GEO 를 위해 노출
  if (m.sources.length) {
    buf.push(`<p><br></p>`, bp("참고 자료"), m.sources.map((s) => p(`· <a href="${escapeHtml(s.url)}">${escapeHtml(s.title)}</a>`)).join(""));
  }
  buf.push(muted(escapeHtml(o.brand.disclosure.ai)));
  flush();
  return segs;
}

/** 대시보드 미리보기용 네이버 HTML (세그먼트를 이어 붙임) */
export function renderNaverPreview(segs: NaverSegment[]): string {
  return segs
    .map((s) => {
      if (s.type === "html") return s.html;
      if (s.type === "heading") return `<h2>${escapeHtml(s.text)}</h2>`;
      if (s.type === "divider") return `<hr style="margin:28px 0;border:0;border-top:1px solid #e5e7eb;" />`;
      return `<figure style="margin:20px 0;text-align:center;"><img src="${escapeHtml(s.src)}" style="max-width:100%;border-radius:8px;" /><figcaption style="font-size:13px;color:#888;">${escapeHtml(s.caption)}</figcaption></figure>`;
    })
    .join("\n");
}

/** 원고 전체 텍스트 (SEO 분석·유사도 비교용) */
export function manuscriptText(m: Manuscript): string {
  return [
    m.title,
    m.directAnswer,
    m.tldr.join(" "),
    m.intro,
    ...m.sections.flatMap((s) => [s.heading, s.body, s.tip, s.table ? s.table.rows.flat().join(" ") : ""]),
    ...m.faq.flatMap((f) => [f.q, f.a]),
    m.conclusion,
  ]
    .join("\n")
    .replace(/[*#>]/g, "");
}
