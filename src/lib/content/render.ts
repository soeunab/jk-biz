import { marked } from "marked";
import type { Brand } from "../brand";
import { escapeHtml } from "../util";
import { PLACEHOLDER_RE, type Manuscript } from "./types";

export type RenderImage = { slot: string; src: string; localPath?: string; alt: string; caption?: string; credit?: string };
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

/** 자리표시 처리 — 발행본에 "[경험 추가…]" 문구가 새어 나가지 않게 합니다. */
export function applyPlaceholders(html: string, mode: "highlight" | "strip" = "strip") {
  if (mode === "highlight") {
    return html.replace(PLACEHOLDER_RE, (m) => `<mark style="background:#fef08a;padding:2px 4px;border-radius:4px;">✍️ ${m}</mark>`);
  }
  return html.replace(/<p>\s*\[경험 추가:[^\]]*\]\s*<\/p>/g, "").replace(PLACEHOLDER_RE, "");
}

function riskBox(o: RenderOptions) {
  if (!o.riskDisclaimers?.length) return "";
  return `<div style="border:1px solid #fecaca;background:#fef2f2;border-radius:10px;padding:10px 14px;margin:16px 0;font-size:14px;color:#7f1d1d;">${o.riskDisclaimers
    .map((d) => `<p style="margin:2px 0;">⚠️ ${escapeHtml(d)}</p>`)
    .join("")}</div>`;
}

const md = (s: string) => marked.parse(s, { async: false, gfm: true, breaks: true }) as string;

function imageFigure(img: RenderImage | undefined, style = "") {
  if (!img) return "";
  return `<figure style="margin:24px 0;text-align:center;${style}"><img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt)}" loading="lazy" style="max-width:100%;height:auto;border-radius:12px;" />${
    img.caption || img.credit
      ? `<figcaption style="font-size:13px;color:#6b7280;margin-top:6px;">${escapeHtml(img.caption ?? "")}${img.credit ? ` <span style="opacity:.7">(${escapeHtml(img.credit)})</span>` : ""}</figcaption>`
      : ""
  }</figure>`;
}

function tableHtml(t: { headers: string[]; rows: string[][] }) {
  const th = t.headers.map((h) => `<th style="border:1px solid #e5e7eb;padding:8px 10px;background:#f3f4f6;">${escapeHtml(h)}</th>`).join("");
  const rows = t.rows
    .map((r) => `<tr>${r.map((c) => `<td style="border:1px solid #e5e7eb;padding:8px 10px;">${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<div style="overflow-x:auto;margin:16px 0;"><table style="border-collapse:collapse;width:100%;font-size:15px;"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function productBox(prod: RenderProduct, sentence: string, anchor: string) {
  return `<div style="border:1px solid #fde68a;background:#fffbeb;border-radius:12px;padding:14px 16px;margin:20px 0;">
<p style="margin:0 0 6px;">${escapeHtml(sentence)}</p>
<p style="margin:0;"><a href="${escapeHtml(prod.url)}" target="_blank" rel="sponsored noopener">👉 ${escapeHtml(anchor || prod.name)}${prod.price ? ` (${prod.price.toLocaleString("ko-KR")}원)` : ""}</a></p></div>`;
}

function adsenseUnit(ad?: RenderOptions["adsense"]) {
  if (!ad?.client || !ad.slot) return "";
  return `<ins class="adsbygoogle" style="display:block;text-align:center;" data-ad-layout="in-article" data-ad-format="fluid" data-ad-client="${escapeHtml(ad.client)}" data-ad-slot="${escapeHtml(ad.slot)}"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});</script>`;
}

const anchorId = (i: number) => `sec-${i + 1}`;

/** 구글 블로거용 HTML — TOC, 구조화 데이터(Article/FAQPage), 애드센스 인아티클 슬롯 포함 */
export function renderBlogger(m: Manuscript, o: RenderOptions): string {
  const img = (slot: string) => o.images.find((i) => i.slot === slot);
  const products = new Map((o.products ?? []).map((p) => [p.id, p]));
  const hasAffiliate = m.affiliate.some((a) => products.has(a.productId));
  const midIndex = Math.floor(m.sections.length / 2);
  const out: string[] = [];

  if (hasAffiliate) out.push(`<p style="font-size:13px;color:#6b7280;">※ ${escapeHtml(o.brand.disclosure.affiliate)}</p>`);
  out.push(imageFigure(img("thumbnail")));
  out.push(
    `<div style="border-left:4px solid #2563eb;background:#eff6ff;padding:14px 18px;border-radius:8px;margin:16px 0;"><p style="margin:0;font-weight:600;">${escapeHtml(m.directAnswer)}</p></div>`,
  );
  out.push(
    `<div style="background:#f9fafb;border-radius:12px;padding:14px 18px;margin:16px 0;"><p style="margin:0 0 6px;font-weight:700;">📌 핵심 요약</p><ul style="margin:0;padding-left:20px;">${m.tldr.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul></div>`,
  );
  out.push(riskBox(o));
  out.push(md(m.intro));
  out.push(adsenseUnit(o.adsense));
  out.push(
    `<nav style="border:1px solid #e5e7eb;border-radius:12px;padding:12px 18px;margin:20px 0;"><p style="margin:0 0 6px;font-weight:700;">목차</p><ol style="margin:0;padding-left:20px;">${m.sections
      .map((s, i) => (s.level !== 3 ? `<li><a href="#${anchorId(i)}">${escapeHtml(s.heading)}</a></li>` : ""))
      .join("")}<li><a href="#faq">자주 묻는 질문</a></li></ol></nav>`,
  );

  m.sections.forEach((s, i) => {
    const h = s.level === 3 ? 3 : 2;
    out.push(`<h${h} id="${anchorId(i)}">${escapeHtml(s.heading)}</h${h}>`);
    if (s.image) out.push(imageFigure(img(s.image.slot)));
    out.push(md(s.body));
    if (s.table) out.push(tableHtml(s.table));
    if (s.tip) out.push(`<p style="background:#ecfdf5;border-radius:8px;padding:10px 14px;">💡 <b>지원포유 꿀팁</b> ${escapeHtml(s.tip)}</p>`);
    for (const a of m.affiliate.filter((a) => a.afterSection === i + 1)) {
      const prod = products.get(a.productId);
      if (prod) out.push(productBox(prod, a.sentence, a.anchorText));
    }
    if (i === midIndex) out.push(adsenseUnit(o.adsense));
  });

  if (o.sourceLink && !manuscriptHasSourceToken(m)) out.push(sourceLinkParagraph(o));
  out.push(`<h2 id="faq">자주 묻는 질문 (FAQ)</h2>`);
  for (const f of m.faq) out.push(`<h3>Q. ${escapeHtml(f.q)}</h3><p>${escapeHtml(f.a)}</p>`);
  out.push(`<h2>마무리</h2>`, md(m.conclusion), `<p><b>${escapeHtml(m.cta)}</b></p>`);

  if (m.sources.length) {
    out.push(
      `<div style="font-size:14px;color:#4b5563;margin-top:24px;"><p style="margin:0 0 4px;font-weight:700;">참고 자료</p><ul style="margin:0;padding-left:20px;">${m.sources
        .map((s) => `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a></li>`)
        .join("")}</ul></div>`,
    );
  }
  const date = (o.publishedAt ?? new Date()).toISOString().slice(0, 10);
  out.push(
    `<div style="border-top:1px solid #e5e7eb;margin-top:28px;padding-top:14px;font-size:14px;color:#4b5563;"><b>작성·검수: ${escapeHtml(o.brand.authorName)}</b> — ${escapeHtml(o.brand.authorBio)}<br/>최종 업데이트: ${date}<br/><span style="font-size:12px;">${escapeHtml(o.brand.disclosure.ai)}</span></div>`,
  );
  out.push(jsonLd(m, o, date));
  return applySourceLink(applyPlaceholders(out.filter(Boolean).join("\n"), o.placeholders), o);
}

function jsonLd(m: Manuscript, o: RenderOptions, date: string) {
  const thumb = o.images.find((i) => i.slot === "thumbnail");
  const graph = [
    {
      "@type": "BlogPosting",
      headline: m.title,
      description: m.metaDescription,
      keywords: [m.focusKeyword, ...m.relatedKeywords].join(", "),
      datePublished: date,
      dateModified: date,
      author: { "@type": "Organization", name: o.brand.authorName },
      publisher: { "@type": "Organization", name: o.brand.name },
      ...(thumb && /^https?:/.test(thumb.src) ? { image: thumb.src } : {}),
      ...(o.canonicalUrl ? { mainEntityOfPage: o.canonicalUrl } : {}),
    },
    {
      "@type": "FAQPage",
      mainEntity: m.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ];
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

export type NaverSegment = { type: "html"; html: string } | { type: "image"; localPath: string; src: string; caption: string };

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
  const pushImage = (slot: string) => {
    const im = o.images.find((i) => i.slot === slot);
    if (!im?.localPath) return;
    flush();
    segs.push({ type: "image", localPath: im.localPath, src: im.src, caption: im.caption ?? im.alt });
  };
  const simpleMd = (s: string) =>
    md(s)
      .replace(/<blockquote>/g, "<blockquote><p>")
      .replace(/<\/blockquote>/g, "</p></blockquote>");

  if (m.affiliate.some((a) => products.has(a.productId))) {
    buf.push(`<p><span style="color:#888888;">※ ${escapeHtml(o.brand.disclosure.affiliate)}</span></p>`);
  }
  pushImage("thumbnail");
  buf.push(`<p><b>${escapeHtml(m.directAnswer)}</b></p><p><br></p>`);
  buf.push(`<p><b>📌 핵심 요약</b></p>${m.tldr.map((t) => `<p>✔ ${escapeHtml(t)}</p>`).join("")}<p><br></p>`);
  if (o.riskDisclaimers?.length) buf.push(o.riskDisclaimers.map((d) => `<p><b>⚠️ ${escapeHtml(d)}</b></p>`).join(""));
  buf.push(simpleMd(m.intro));

  m.sections.forEach((s, i) => {
    buf.push(`<p><br></p><h3><b>${escapeHtml(s.heading)}</b></h3>`);
    if (s.image) pushImage(s.image.slot);
    buf.push(simpleMd(s.body));
    if (s.table) buf.push(tableHtml(s.table));
    if (s.tip) buf.push(`<p>💡 <b>꿀팁</b> ${escapeHtml(s.tip)}</p>`);
    for (const a of m.affiliate.filter((a) => a.afterSection === i + 1)) {
      const prod = products.get(a.productId);
      if (prod) buf.push(`<p>${escapeHtml(a.sentence)}</p><p><a href="${escapeHtml(prod.url)}">👉 ${escapeHtml(a.anchorText || prod.name)}</a></p>`);
    }
  });

  if (o.sourceLink && !manuscriptHasSourceToken(m)) buf.push(sourceLinkParagraph(o));
  buf.push(`<p><br></p><h3><b>자주 묻는 질문</b></h3>`);
  for (const f of m.faq) buf.push(`<p><b>Q. ${escapeHtml(f.q)}</b></p><p>A. ${escapeHtml(f.a)}</p><p><br></p>`);
  buf.push(simpleMd(m.conclusion), `<p><b>${escapeHtml(m.cta)}</b></p>`);
  // 출처 링크는 네이버에서도 문제되지 않음 (같은 링크 반복 게재만 피하면 됨) — 신뢰도·GEO 를 위해 노출
  if (m.sources.length) {
    buf.push(`<p><br></p><p><b>참고 자료</b></p>${m.sources.map((s) => `<p>· <a href="${escapeHtml(s.url)}">${escapeHtml(s.title)}</a></p>`).join("")}`);
  }
  buf.push(`<p><span style="color:#888888;">${escapeHtml(o.brand.disclosure.ai)}</span></p>`);
  flush();
  return segs;
}

/** 대시보드 미리보기용 네이버 HTML (세그먼트를 이어 붙임) */
export function renderNaverPreview(segs: NaverSegment[]): string {
  return segs
    .map((s) =>
      s.type === "html"
        ? s.html
        : `<figure style="margin:20px 0;text-align:center;"><img src="${escapeHtml(s.src)}" style="max-width:100%;border-radius:8px;" /><figcaption style="font-size:13px;color:#888;">${escapeHtml(s.caption)}</figcaption></figure>`,
    )
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
