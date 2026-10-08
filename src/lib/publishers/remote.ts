import { google } from "googleapis";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { similarity } from "../content/similarity";
import { authedClient } from "./google";
import { naverFetchPost } from "./naver";

/*
 * 블로그에 실제로 올라가 있는 글 가져오기 — 스튜디오 밖(블로거·네이버 편집기)에서 고친 내용·사진을 스튜디오에 반영하고,
 * [비공개 발행]을 다시 눌러 그 수정본을 덮어쓰는 사고를 막습니다. 글은 읽기만 하고 바꾸지 않습니다.
 *  - 블로거: Blogger API posts.get(view=ADMIN, 초안도 읽힘) · 주소만 있으면 공개 페이지
 *  - 네이버: 로그인 세션으로 PostView 를 열어 읽음(비공개 글도 읽힘)
 */

/** HTML → 본문 텍스트 (스크립트·JSON-LD 제외) */
export function htmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** 본문 HTML 의 사진 수 (블로거 img, 네이버 se-image-resource) */
export function countImages(html: string): number {
  const naver = (html.match(/class="[^"]*se-image-resource/g) ?? []).length;
  return naver || (html.match(/<img\b/gi) ?? []).length;
}

/** 공개된 글 본문 HTML — 블로거는 post-body, 네이버는 PostView 페이지의 스마트에디터 본문 (로그인 없이) */
export async function fetchPublishedBody(url: string): Promise<string> {
  let target = url;
  const naver = url.match(/blog\.naver\.com\/([^/?#]+)\/(\d+)/);
  if (naver) target = `https://blog.naver.com/PostView.naver?blogId=${naver[1]}&logNo=${naver[2]}`;
  const res = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`글 페이지 ${res.status}`);
  const page = await res.text();
  // 블로거: 테마마다 id='post-body'(jettheme) 또는 class="post-body"
  const start = page.search(naver ? /class="se-main-container"/ : /id=['"]post-body['"]|class=['"][^'"]*post-body/);
  if (start < 0) return page;
  // 본문 시작부터 댓글·푸터 전까지 (정확한 닫는 태그 대신 넉넉히 자르고 텍스트로만 씀)
  const end = page.slice(start).search(/id=['"]comments|class=['"][^'"]*(post-footer|comments|related-posts|post-pager)|id=['"]post-pager|<footer/);
  return page.slice(Math.max(0, page.lastIndexOf("<", start)), end > 0 ? start + end : start + 200_000);
}

export type RemotePost = { title: string; html: string; text: string; images: number; publishedAt?: Date | null; labels?: string[] };

/** 네이버 글 주소·logNo 에서 (blogId, logNo) */
function naverIds(post: { remoteId: string | null; remoteUrl: string | null; account: { externalId: string | null } | null }) {
  const m = post.remoteUrl?.match(/blog\.naver\.com\/([^/?#]+)\/(\d+)/) ?? post.remoteUrl?.match(/blogId=([^&]+).*logNo=(\d+)/);
  const blogId = m?.[1] ?? post.account?.externalId ?? null;
  const logNo = (post.remoteId && /^\d+$/.test(post.remoteId) ? post.remoteId : null) ?? m?.[2] ?? null;
  return blogId && logNo ? { blogId, logNo } : null;
}

/** 블로그에 올라가 있는 글 읽기 */
export async function fetchRemotePost(postId: string): Promise<RemotePost> {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { account: true } });
  if (post.platform === "NAVER") {
    const ids = naverIds(post);
    if (!ids) throw new Error("네이버 글 번호(logNo)를 알 수 없어요 — 글 주소를 확인해 주세요.");
    const r = await naverFetchPost(post.accountId ?? "", ids.blogId, ids.logNo);
    return { ...r, text: r.text.replace(/\s+/g, " ").trim() };
  }
  // 블로거: API 로 (초안·비공개도 읽힘) — 연결이 없거나 실패하면 공개 페이지
  if (post.account?.externalId) {
    try {
      const blogger = google.blogger({ version: "v3", auth: await authedClient(post.account.id) });
      const res = post.remoteId && !post.remoteId.startsWith("demo-")
        ? await blogger.posts.get({ blogId: post.account.externalId, postId: post.remoteId, view: "ADMIN" })
        : post.remoteUrl
          ? await blogger.posts.getByPath({ blogId: post.account.externalId, path: new URL(post.remoteUrl).pathname })
          : null;
      if (res?.data.content != null) {
        const html = res.data.content;
        return { title: res.data.title ?? post.title, html, text: htmlText(html), images: countImages(html), publishedAt: res.data.published ? new Date(res.data.published) : null, labels: res.data.labels ?? [] };
      }
    } catch {
      // 아래 공개 페이지로
    }
  }
  if (!post.remoteUrl) throw new Error("블로그 글 주소가 없어 가져올 수 없어요.");
  const html = await fetchPublishedBody(post.remoteUrl);
  return { title: post.title, html, text: htmlText(html), images: countImages(html) };
}

export type RemoteDiff = { edited: boolean; similarity: number | null; chars: number; baseChars: number | null; images: number; baseImages: number | null; title: string; titleChanged: boolean };

/** 블로그 본문 vs 스튜디오가 올린 본문 — 내용이 3% 넘게 다르거나 사진 수·제목이 다르면 '블로그에서 고침' */
export function compareRemote(remote: { text: string; images: number; title: string }, base: { text: string | null; images: number | null; title: string }): RemoteDiff {
  const sim = base.text ? similarity(remote.text, base.text) : null;
  const titleChanged = !!base.title && remote.title.trim() !== base.title.trim();
  const edited = (sim != null && sim < 0.97) || (base.images != null && remote.images !== base.images) || titleChanged;
  return { edited, similarity: sim == null ? null : Math.round(sim * 1000) / 1000, chars: remote.text.length, baseChars: base.text?.length ?? null, images: remote.images, baseImages: base.images, title: remote.title, titleChanged };
}

/**
 * 스튜디오가 블로그에 올린 직후 기준 저장 — 이후 블로그에서 고쳤는지 비교할 출발점.
 * 네이버 편집기는 붙여 넣은 서식을 일부 바꾸므로 스튜디오 미리보기가 아니라 **올라간 직후의 블로그 본문**을 읽어 기준으로 씀.
 * 읽기에 실패하면 스튜디오 HTML 로 대신함.
 */
export async function markPushed(postId: string, log?: (m: string) => unknown) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId }, select: { html: true, title: true } });
  let base = { text: htmlText(post.html), images: countImages(post.html), title: post.title, html: null as string | null };
  try {
    const r = await fetchRemotePost(postId);
    base = { text: r.text, images: r.images, title: r.title || post.title, html: r.html };
  } catch (e) {
    await log?.(`올라간 본문을 바로 읽지 못해 스튜디오 본문을 비교 기준으로 씀: ${(e as Error).message.split("\n")[0]}`);
  }
  await db.post.update({
    where: { id: postId },
    data: {
      remoteBase: base.text,
      remoteHtml: base.html,
      remoteSyncedAt: base.html ? new Date() : null,
      remoteDiff: { edited: false, similarity: 1, chars: base.text.length, baseChars: base.text.length, images: base.images, baseImages: base.images, title: base.title, titleChanged: false } as Prisma.InputJsonValue,
    },
  });
}

/** [블로그에서 가져오기] — 블로그 본문을 저장하고 스튜디오가 올린 것과 비교 */
export async function syncRemote(postId: string, log?: (m: string) => unknown) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId } });
  const remote = await fetchRemotePost(postId);
  const prev = (post.remoteDiff ?? {}) as Partial<RemoteDiff>;
  const diff = compareRemote(remote, { text: post.remoteBase, images: prev.baseImages ?? null, title: post.remoteBase ? (prev.title ?? post.title) : "" });
  await db.post.update({
    where: { id: postId },
    data: {
      remoteHtml: remote.html,
      remoteSyncedAt: new Date(),
      remoteDiff: diff as unknown as Prisma.InputJsonValue,
      // [기존 글 등록] 글은 제목·발행일을 블로그 값으로 맞춤
      ...(post.origin === "imported" ? { title: remote.title || post.title, ...(remote.publishedAt ? { publishedAt: remote.publishedAt } : {}) } : {}),
    },
  });
  await log?.(
    diff.edited
      ? `블로그에서 고친 내용이 있어요 — 본문 유사도 ${diff.similarity != null ? Math.round(diff.similarity * 100) + "%" : "–"}, 사진 ${diff.baseImages ?? "?"} → ${diff.images}장${diff.titleChanged ? `, 제목 변경("${diff.title}")` : ""}`
      : `블로그 본문 가져옴 (${diff.chars.toLocaleString("ko-KR")}자, 사진 ${diff.images}장)${post.remoteBase ? " — 스튜디오가 올린 것과 같아요" : ""}`,
  );
  return diff;
}
