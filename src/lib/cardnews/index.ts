import type { Prisma } from "@prisma/client";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { db } from "../db";
import { getBrand, type Brand } from "../brand";
import { generateJson } from "../llm";
import { FONT_LINK, FONT_STACK, renderHtmlToPng } from "../browser";
import { saveMedia } from "../storage";
import { readManuscript } from "../content/service";
import type { JobContext } from "../jobs/queue";
import { escapeHtml, truncateWords } from "../util";

export const SlideSchema = z.object({
  type: z.enum(["cover", "point", "list", "quote", "cta"]),
  kicker: z.string().describe("상단 작은 라벨 (예: STEP 1, 꿀팁, 요약) — 없으면 빈 문자열"),
  title: z.string().describe("큰 글씨 제목 18자 내외"),
  body: z.string().describe("본문 60자 내외 (cover/cta 는 짧게)"),
  bullets: z.array(z.string()).describe("list 타입일 때 3~4개, 아니면 빈 배열"),
  emoji: z.string().describe("대표 이모지 1개"),
});
export type Slide = z.infer<typeof SlideSchema>;

export const CaptionsSchema = z.object({
  instagram: z.string().describe("인스타그램 캡션: 훅 1줄 + 요약 3줄 + 저장 유도 + 해시태그 5개 이내"),
  threads: z.string().describe("스레드: 대화체 300자 이내, 해시태그 1개"),
  x: z.string().describe("X(트위터): 120자 이내 한국어, 해시태그 2개 이내"),
  facebook: z.string().describe("페이스북 페이지: 정보형 3~5문장 + 블로그 링크 자리 {link}"),
  band: z.string().describe("네이버 밴드·카카오 채널: 친근한 공지형 + {link}"),
});
export type Captions = z.infer<typeof CaptionsSchema>;

const CardNewsSchema = z.object({ title: z.string(), slides: z.array(SlideSchema), captions: CaptionsSchema });

export const THEMES = {
  brand: { bg: "linear-gradient(160deg,#1e1b4b 0%,#312e81 55%,#6d28d9 100%)", fg: "#ffffff", accent: "#facc15", card: "rgba(255,255,255,.08)", sub: "rgba(255,255,255,.8)" },
  light: { bg: "linear-gradient(180deg,#f8fafc,#e0e7ff)", fg: "#0f172a", accent: "#4f46e5", card: "#ffffff", sub: "#475569" },
  yellow: { bg: "#fde047", fg: "#111827", accent: "#1d4ed8", card: "rgba(255,255,255,.7)", sub: "#374151" },
} as const;
export type ThemeName = keyof typeof THEMES;

export const CARD_W = 1080;
export const CARD_H = 1350;

export function slideHtml(s: Slide, idx: number, total: number, brand: Pick<Brand, "name">, themeName: ThemeName = "brand") {
  const t = THEMES[themeName] ?? THEMES.brand;
  const isCover = s.type === "cover";
  const list = s.bullets.length
    ? `<ul class="list">${s.bullets.map((b, i) => `<li><span class="n">${i + 1}</span><span>${escapeHtml(b)}</span></li>`).join("")}</ul>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8">${FONT_LINK}<style>
*{box-sizing:border-box}body{margin:0;width:${CARD_W}px;height:${CARD_H}px;font-family:${FONT_STACK};}
.c{position:relative;width:100%;height:100%;background:${t.bg};color:${t.fg};padding:110px 96px;display:flex;flex-direction:column;${isCover ? "justify-content:center;" : ""}}
.kicker{display:inline-block;align-self:flex-start;background:${t.accent};color:${themeName === "brand" ? "#111" : "#fff"};font-weight:800;font-size:34px;padding:10px 26px;border-radius:999px;margin-bottom:40px;}
.emoji{font-size:${isCover ? 150 : 110}px;margin-bottom:30px;}
.title{font-size:${isCover ? 96 : 78}px;font-weight:900;line-height:1.2;letter-spacing:-2px;word-break:keep-all;}
.title em{font-style:normal;color:${t.accent};}
.body{margin-top:40px;font-size:44px;line-height:1.6;color:${t.sub};word-break:keep-all;white-space:pre-line;}
.list{list-style:none;padding:0;margin:48px 0 0;display:flex;flex-direction:column;gap:26px;}
.list li{display:flex;gap:24px;align-items:flex-start;background:${t.card};border-radius:28px;padding:30px 34px;font-size:42px;line-height:1.45;word-break:keep-all;}
.n{flex:none;width:64px;height:64px;border-radius:50%;background:${t.accent};color:${themeName === "brand" ? "#111" : "#fff"};font-weight:900;display:flex;align-items:center;justify-content:center;font-size:36px;}
.foot{position:absolute;left:96px;right:96px;bottom:70px;display:flex;justify-content:space-between;font-size:32px;font-weight:700;opacity:.85;}
.quote{font-size:64px;font-weight:800;line-height:1.45;border-left:12px solid ${t.accent};padding-left:40px;margin-top:20px;word-break:keep-all;}
</style></head><body><div class="c">
${s.kicker ? `<div class="kicker">${escapeHtml(s.kicker)}</div>` : ""}
${s.emoji ? `<div class="emoji">${escapeHtml(s.emoji)}</div>` : ""}
${s.type === "quote" ? `<div class="quote">${escapeHtml(s.title)}</div>` : `<div class="title">${escapeHtml(s.title)}</div>`}
${s.body ? `<div class="body">${escapeHtml(s.body)}</div>` : ""}
${list}
<div class="foot"><span>@${escapeHtml(brand.name)}</span><span>${idx + 1} / ${total}${s.type === "cta" ? "" : "  →"}</span></div>
</div></body></html>`;
}

export async function createCardNews(opts: { postId?: string; topic?: string; theme?: ThemeName }) {
  const post = opts.postId ? await db.post.findUnique({ where: { id: opts.postId } }) : null;
  const card = await db.cardNews.create({
    data: { postId: post?.id ?? null, title: post?.title ?? opts.topic ?? "카드뉴스", theme: opts.theme ?? "brand", status: "GENERATING" },
  });
  return card;
}

/** 워커: 슬라이드 기획 → PNG 렌더 → 캡션 */
export async function runGenerateCardNews(cardNewsId: string, ctx?: JobContext) {
  const card = await db.cardNews.findUniqueOrThrow({ where: { id: cardNewsId }, include: { post: true } });
  const brand = await getBrand();
  const m = card.post ? readManuscript(card.post.content) : null;
  try {
    const source = m
      ? `제목: ${m.title}\n직답: ${m.directAnswer}\n요약: ${m.tldr.join(" / ")}\n섹션:\n${m.sections.map((s) => `- ${s.heading}: ${s.body.slice(0, 300)}`).join("\n")}\nFAQ: ${m.faq.map((f) => f.q).join(" / ")}`
      : `주제: ${card.title}`;

    const result = await generateJson({
      system: `당신은 인스타그램 카드뉴스 에디터입니다. 브랜드: ${brand.name} — ${brand.mission}
원칙: 첫 장은 스크롤을 멈추게 하는 훅, 한 장에 메시지 하나, 짧고 쉬운 문장, 마지막 장은 저장·팔로우·블로그 방문 유도.`,
      prompt: `아래 블로그 원고를 카드뉴스 7장으로 만들어 주세요. 구성: cover 1장 → point/list 4~5장 → quote 또는 요약 1장 → cta 1장.
각 SNS 캡션도 함께 작성하세요. 링크 자리는 {link} 로 표시하세요.

${source}`,
      schema: CardNewsSchema,
      effort: "medium",
      maxTokens: 8000,
      mock: () => mockCardNews(card.title, m?.tldr ?? [], m?.sections.map((s) => s.heading) ?? [], brand.name),
    });
    await ctx?.progress(40, `슬라이드 ${result.slides.length}장 기획 완료`);

    await db.asset.deleteMany({ where: { cardNewsId } });
    for (const [i, s] of result.slides.entries()) {
      const png = await renderHtmlToPng(slideHtml(s, i, result.slides.length, brand, card.theme as ThemeName), CARD_W, CARD_H);
      const saved = await saveMedia(png, "png", `cardnews/${cardNewsId}`);
      await db.asset.create({
        data: { cardNewsId, kind: "CARD_SLIDE", source: "TEMPLATE", slot: `slide${i + 1}`, localPath: saved.localPath, publicUrl: saved.relUrl, alt: s.title, order: i, width: CARD_W, height: CARD_H },
      });
      await ctx?.progress(40 + ((i + 1) / result.slides.length) * 55);
    }
    await db.cardNews.update({
      where: { id: cardNewsId },
      data: {
        title: result.title,
        slides: result.slides as unknown as Prisma.InputJsonValue,
        captions: result.captions as unknown as Prisma.InputJsonValue,
        status: "READY",
        error: null,
      },
    });
    await ctx?.log("카드뉴스 렌더링 완료");
    return { slides: result.slides.length };
  } catch (e) {
    await db.cardNews.update({ where: { id: cardNewsId }, data: { status: "FAILED", error: (e as Error).message } });
    throw e;
  }
}

/** 슬라이드 문구를 수정한 뒤 다시 렌더링 (AI 호출 없음) */
export async function rerenderCardNews(cardNewsId: string) {
  const card = await db.cardNews.findUniqueOrThrow({ where: { id: cardNewsId } });
  const brand = await getBrand();
  const slides = z.array(SlideSchema).parse(card.slides);
  await db.asset.deleteMany({ where: { cardNewsId } });
  for (const [i, s] of slides.entries()) {
    const png = await renderHtmlToPng(slideHtml(s, i, slides.length, brand, card.theme as ThemeName), CARD_W, CARD_H);
    const saved = await saveMedia(png, "png", `cardnews/${cardNewsId}`);
    await db.asset.create({
      data: { cardNewsId, kind: "CARD_SLIDE", source: "TEMPLATE", slot: `slide${i + 1}`, localPath: saved.localPath, publicUrl: saved.relUrl, alt: s.title, order: i, width: CARD_W, height: CARD_H },
    });
  }
}

/** 슬라이드 PNG + 플랫폼별 캡션 텍스트를 ZIP 으로 (수동 업로드용: 틱톡·밴드·카카오 등) */
export async function exportCardNewsZip(cardNewsId: string, link = ""): Promise<Buffer> {
  const card = await db.cardNews.findUniqueOrThrow({ where: { id: cardNewsId }, include: { assets: { orderBy: { order: "asc" } } } });
  const zip = new JSZip();
  for (const [i, a] of card.assets.entries()) zip.file(`slide_${String(i + 1).padStart(2, "0")}.png`, await readFile(a.localPath));
  const captions = CaptionsSchema.partial().parse(card.captions ?? {});
  const text = Object.entries(captions)
    .map(([k, v]) => `■ ${k}\n${String(v).replaceAll("{link}", link)}\n`)
    .join("\n");
  zip.file("captions.txt", text);
  return zip.generateAsync({ type: "nodebuffer" });
}

function mockCardNews(title: string, tldr: string[], headings: string[], brandName: string) {
  const hs = headings.length ? headings : ["AI 도구 시작하기", "가입 방법", "활용 예시", "주의할 점"];
  const slides: Slide[] = [
    { type: "cover", kicker: "AI 활용 가이드", title: truncateWords(title.split(" — ")[0], 28), body: "저장해두고 하나씩 따라 해 보세요", bullets: [], emoji: "🤖" },
    ...hs.slice(0, 4).map((h, i) => ({
      type: (i === 1 ? "list" : "point") as Slide["type"],
      kicker: `STEP ${i + 1}`,
      title: truncateWords(h, 32),
      body: i === 1 ? "" : "핵심만 짧게 정리했어요. 자세한 방법은 블로그에서 확인하세요.",
      bullets: i === 1 ? ["공식 사이트 접속", "계정으로 로그인", "첫 질문 입력"] : [],
      emoji: ["💡", "📝", "🚀", "⚠️"][i] ?? "✨",
    })),
    { type: "quote", kicker: "핵심 요약", title: tldr[0] ?? "작은 일 하나부터 AI에게 맡겨 보세요", body: tldr.slice(1).join("\n"), bullets: [], emoji: "" },
    { type: "cta", kicker: "", title: "더 자세한 방법은\n블로그에서!", body: `저장 📌 · 팔로우 ➕\n@${brandName}`, bullets: [], emoji: "👉" },
  ];
  return {
    title,
    slides,
    captions: {
      instagram: `${title}\n\n✔ ${tldr.join("\n✔ ")}\n\n나중에 다시 보려면 저장📌 해두세요!\n\n#AI활용 #AI도구 #업무자동화 #${brandName} #생산성`,
      threads: `${title} — 처음이라면 이 순서대로만 해 보세요. 자세한 건 블로그에 정리해 뒀어요 #AI활용`,
      x: `${title.slice(0, 60)} 핵심만 7장으로 정리했어요 #AI활용 #${brandName}`,
      facebook: `${title}\n\n${tldr.join(" ")}\n\n자세히 보기 👉 {link}`,
      band: `안녕하세요, ${brandName}입니다 😊\n오늘은 "${title}"를 정리했어요.\n👉 {link}`,
    },
  };
}
