import { google } from "googleapis";
import { db } from "../db";
import { publishImage } from "../images/host";
import { rerenderPost } from "../content/service";
import { authedClient } from "./google";
import type { PublishResult } from "./types";

/** 비공개(초안) 저장: 블로거 API isDraft=true — 블로그에는 보이지 않고 관리자 화면에서 검수 가능 */
export async function bloggerSaveDraft(postId: string, log: (m: string) => unknown): Promise<PublishResult> {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { account: true } });
  if (!post.account?.externalId) throw new Error("블로거 계정(blogId)이 지정되지 않았습니다.");
  const auth = await authedClient(post.account.id);
  const blogger = google.blogger({ version: "v3", auth });

  // 블로거 API 는 이미지 업로드를 지원하지 않아 공개 URL 로 변환 후 삽입합니다.
  const cache = new Map<string, string>();
  const rendered = await rerenderPost(postId, {
    forPublish: true,
    imageUrl: async (a) => {
      if (!cache.has(a.localPath)) cache.set(a.localPath, await publishImage(a.localPath, a.publicUrl ?? ""));
      return cache.get(a.localPath)!;
    },
  });
  await log(`이미지 ${cache.size}개 공개 URL 준비`);

  const requestBody = { title: rendered.manuscript.title, content: rendered.html, labels: rendered.manuscript.tags };
  const res = post.remoteId
    ? await blogger.posts.update({ blogId: post.account.externalId, postId: post.remoteId, requestBody })
    : await blogger.posts.insert({ blogId: post.account.externalId, isDraft: true, requestBody });
  await log(`블로거 초안 저장 완료 (postId=${res.data.id}). 검색 설명(메타 설명)은 블로거 편집 화면 '검색 설명'에 붙여 넣어 주세요.`);
  return {
    remoteId: res.data.id ?? undefined,
    remoteUrl: `https://www.blogger.com/blog/post/edit/${post.account.externalId}/${res.data.id}`,
  };
}

/** 검수 완료 후 공개 발행 */
export async function bloggerPublish(postId: string, log: (m: string) => unknown): Promise<PublishResult> {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { account: true } });
  if (!post.account?.externalId || !post.remoteId) throw new Error("먼저 비공개(초안) 저장을 해 주세요.");
  const blogger = google.blogger({ version: "v3", auth: await authedClient(post.account.id) });
  const res = await blogger.posts.publish({ blogId: post.account.externalId, postId: post.remoteId });
  await log(`공개 발행 완료: ${res.data.url}`);
  return { remoteId: res.data.id ?? post.remoteId, remoteUrl: res.data.url ?? undefined };
}
