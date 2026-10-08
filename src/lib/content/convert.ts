import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { generateJson } from "../llm";
import { normalizeKeyword } from "../topics/scoring";
import { syncRemote } from "../publishers/remote";
import type { JobContext } from "../jobs/queue";
import { rerenderPost } from "./service";
import { ManuscriptSchema, type Manuscript } from "./types";
import { saveMedia } from "../storage";
import { imageSizeFromBuffer } from "../images/size";

/** 블로그 본문에서 이미지 주소와 그 이미지가 속한 소제목(앞에 나온 마지막 소제목)을 순서대로 */
export function remoteImages(html: string): { url: string; alt: string; heading: string | null }[] {
  const out: { url: string; alt: string; heading: string | null }[] = [];
  let heading: string | null = null;
  const re = /<(h2|h3)[^>]*>([\s\S]*?)<\/\1>|<div[^>]*se-section-sectionTitle[^>]*>([\s\S]*?)<\/div>\s*<\/div>|<img\b[^>]*>/gi;
  for (const m of html.matchAll(re)) {
    if (m[0].toLowerCase().startsWith("<img")) {
      const attr = (n: string) => m[0].match(new RegExp(`${n}="([^"]*)"`, "i"))?.[1] ?? "";
      // 네이버는 지연 로딩이라 src 가 흐린 미리보기(w80_blur)일 수 있어 data-lazy-src 를 먼저
      const raw = attr("data-lazy-src") || attr("src");
      if (!/^https?:\/\//.test(raw)) continue;
      if (/se-sticker|emoticon|static\.blog\.naver\.net|\/sticker\//i.test(m[0])) continue; // 스티커·아이콘 제외
      const url = raw.replace(/\?type=w\d+(_blur)?/, "?type=w966");
      out.push({ url, alt: attr("alt") || attr("title"), heading });
    } else {
      // 빈 소제목(제로폭 공백만 있는 것)은 무시하고 앞 소제목을 유지
      heading = (m[2] ?? m[3] ?? "").replace(/<[^>]+>/g, "").replace(/[\u200b\u00a0]/g, " ").replace(/\s+/g, " ").trim() || heading;
    }
  }
  return out;
}

/**
 * 블로그 이미지 → 원고 자리 배정 (순수 함수). 첫 소제목 앞(없으면 맨 처음) 이미지 1장은 썸네일,
 * 나머지는 원문 순서를 지키며 섹션당 1장 — 소제목으로 찾은 섹션(첫 소제목 앞이면 첫 섹션)이 찼으면 그다음 빈 섹션으로, 빈 섹션이 없으면 null.
 */
export function placeRemoteImages(imgs: { heading: string | null }[], sectionHeadings: string[]): (string | null)[] {
  // 글자·숫자만 비교 ("▶ 4. 신청 전 체크" = "4. 신청 전 체크"), 서로 포함하면 같은 소제목으로 봄
  const norm = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  const same = (a: string, b: string) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  const remoteHeadings = [...new Set(imgs.map((i) => i.heading).filter((h): h is string => !!h))];
  const used = new Set<number>();
  const sectionOf = (h: string) => {
    const exact = sectionHeadings.findIndex((s, k) => !used.has(k) && same(norm(s), norm(h)));
    if (exact >= 0) return exact;
    // 못 찾으면 소제목 순서로 (원문 n번째 소제목 → 원고 n번째 섹션)
    return remoteHeadings.indexOf(h);
  };
  const thumbIdx = Math.max(0, imgs.findIndex((i) => i.heading == null));
  let last = -1;
  return imgs.map((img, i) => {
    if (i === thumbIdx) return "thumbnail";
    let sec = Math.max(img.heading ? sectionOf(img.heading) : 0, last + 1, 0);
    while (sec < sectionHeadings.length && used.has(sec)) sec++;
    if (sec >= sectionHeadings.length) return null;
    used.add(sec);
    last = sec;
    return `img${sec + 1}`;
  });
}

/** 블로그 원본 이미지를 내려받아 원고 이미지로 연결 — 변환한 원고의 스튜디오 미리보기·카드뉴스·재발행에 이미지가 빠지지 않게 */
async function importRemoteImages(postId: string, m: Manuscript, html: string, log: (s: string) => unknown) {
  const imgs = remoteImages(html);
  if (!imgs.length) return 0;
  await db.asset.deleteMany({ where: { postId, kind: { not: "CARD_SLIDE" } } });
  const slots = placeRemoteImages(imgs, m.sections.map((s) => s.heading));
  let order = 0;
  let saved = 0;
  const download = async (url: string) => {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://blog.naver.com/" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`이미지 ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "";
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("gif") ? "gif" : "jpg";
    return { buf, ext };
  };
  for (const [i, img] of imgs.entries()) {
    const slot = slots[i];
    if (!slot) continue;
    if (slot !== "thumbnail") {
      const sec = Number(slot.slice(3)) - 1;
      m.sections[sec].image = { slot, source: "stock", prompt: "", url: img.url, alt: img.alt || `${m.focusKeyword} ${m.sections[sec].heading}`, caption: "" };
    }
    try {
      const { buf, ext } = await download(img.url);
      const file = await saveMedia(buf, ext, `posts/${postId}`);
      const size = imageSizeFromBuffer(buf);
      await db.asset.create({
        data: {
          postId,
          kind: slot === "thumbnail" ? "THUMBNAIL" : "INLINE",
          source: "UPLOAD",
          slot,
          localPath: file.localPath,
          publicUrl: file.relUrl,
          alt: img.alt || m.title,
          credit: "블로그 원본",
          order: order++,
          ...(size ?? {}),
        },
      });
      saved++;
    } catch (e) {
      await log(`이미지 내려받기 실패(${slot}): ${(e as Error).message}`);
      if (slot !== "thumbnail") m.sections[Number(slot.slice(3)) - 1].image = null;
    }
  }
  const skipped = slots.filter((x) => !x).length;
  await log(`블로그 원본 이미지 ${saved}장을 원고에 연결 (본문 이미지 ${imgs.length}장${skipped ? ` — 섹션당 1장이라 ${skipped}장은 넣을 자리가 없음` : ""})`);
  return saved;
}

/**
 * 블로그 본문 HTML → 소제목·문단 구조를 살린 간단한 텍스트(마크다운 비슷하게).
 * 블로거 h2/h3, 네이버 스마트에디터 소제목(se-section-sectionTitle)을 "## "로 표시해 AI 가 섹션을 나누기 쉽게 함.
 */
export function htmlToOutline(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<div[^>]*se-section-sectionTitle[^>]*>/gi, "\n\n## ")
    .replace(/<h2[^>]*>/gi, "\n\n## ")
    .replace(/<h3[^>]*>/gi, "\n\n### ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)[^>]*>/gi, "\n")
    .replace(/<img[^>]*>/gi, "\n[사진]\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * [원고로 변환] — 블로그에 올라간 글(기존 글 등록·블로그에서 고친 글)을 스튜디오 원고 형식으로 옮겨
 * AI 사실 검수·SEO 점검·카드뉴스·다른 계정 재발행을 쓸 수 있게 합니다. 내용은 바꾸지 않고 구조만 나눕니다(Claude 1번).
 * 공개된 글을 자동으로 고치지 않습니다 — 원고는 스튜디오 안에서만 바뀝니다.
 */
export async function convertRemote(postId: string, ctx?: JobContext) {
  const log = (m: string) => ctx?.log(m);
  let post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { account: true } });
  if (!post.remoteHtml) {
    await log("블로그 본문을 먼저 가져와요");
    await syncRemote(postId, log);
    post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { account: true } });
  }
  const outline = htmlToOutline(post.remoteHtml ?? "");
  if (outline.length < 200) throw new Error("가져온 본문이 너무 짧아 원고로 바꿀 수 없어요.");
  await ctx?.progress(20, `본문 ${outline.length.toLocaleString("ko-KR")}자를 원고 형식으로 옮기는 중…`);

  const manuscript = await generateJson({
    name: "convertRemote",
    task: "write",
    title: `원고로 변환: ${post.title}`,
    system: `당신은 이미 발행된 블로그 글을 원고 JSON 형식으로 옮기는 편집자입니다.
- 문장·숫자·고유명사를 바꾸지 마세요. 오탈자·사실 오류도 고치지 마세요(검수는 다음 단계에서 사람이 합니다). 원문에 없는 내용을 지어내지 마세요.
- "## " 로 시작하는 줄이 소제목입니다. 소제목 단위로 sections 를 나누고 body 에는 그 아래 문단을 마크다운으로 그대로 옮기세요. [사진] 자리는 image=null 로 두세요.
- 글 맨 앞 요약·결론 문단은 directAnswer 와 intro 로, "핵심 요약"류 목록은 tldr 로, 질문-답 형식은 faq 로, 마무리 문단은 conclusion 으로 옮기세요. 원문에 없는 항목은 빈 문자열·빈 배열로 두세요.
- focusKeyword 는 제목 맨 앞의 핵심 검색어, metaDescription 은 원문 첫 요약 문장에서 120~150자로, slug 는 영문 키워드로.
- sources 는 원문에 있는 링크만, affiliate 는 빈 배열, reviewChecklist 는 빈 배열.`,
    prompt: `[제목]\n${post.title}\n\n[본문]\n${outline.slice(0, 30_000)}`,
    schema: ManuscriptSchema,
    effort: "medium",
    maxTokens: 32000,
    mock: () => {
      throw new Error("데모 모드에서는 원고 변환을 할 수 없어요.");
    },
  });
  manuscript.title = post.title || manuscript.title;
  manuscript.affiliate = [];
  manuscript.sections.forEach((s) => (s.image = null));
  // 블로그 원본 이미지를 내려받아 섹션·썸네일에 연결 (스튜디오 미리보기·카드뉴스·재발행용)
  await importRemoteImages(postId, manuscript, post.remoteHtml ?? "", log).catch((e) => log(`이미지 가져오기 건너뜀: ${(e as Error).message}`));
  await db.post.update({
    where: { id: postId },
    data: {
      content: manuscript as unknown as Prisma.InputJsonValue,
      focusKeyword: manuscript.focusKeyword,
      normalizedKeyword: post.normalizedKeyword || normalizeKeyword(manuscript.focusKeyword),
      metaDescription: manuscript.metaDescription,
      tags: manuscript.tags,
    },
  });
  // SEO·AEO 점검과 HTML 코드 탭을 위해 렌더링 (블로그 원본은 remoteHtml 에 그대로 있음 — 미리보기는 블로그 현재본을 보여 줌)
  await rerenderPost(postId);
  await ctx?.progress(100, `원고로 변환 완료 — 섹션 ${manuscript.sections.length}개 · FAQ ${manuscript.faq.length}개`);
  return { sections: manuscript.sections.length };
}
