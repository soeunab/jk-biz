import { db } from "../db";
import { asObject } from "../util";
import type { JobContext } from "../jobs/queue";
import { bloggerPublish, bloggerSaveDraft } from "./blogger";
import { naverMakePublic, naverPublishPrivate } from "./naver";
import { publishCardNews } from "./social";
import type { PublishResult } from "./types";

/** 데모 계정(settings.demo=true)은 실제 발행 대신 흐름만 시뮬레이션합니다. */
async function isDemo(accountId: string | null) {
  if (!accountId) return true;
  const a = await db.account.findUnique({ where: { id: accountId } });
  return !a || asObject<{ demo?: boolean }>(a.settings, {}).demo === true;
}

/** 1단계: 비공개 발행 (블로거 초안 / 네이버 비공개 발행·임시저장) → 사람 검수 대기 */
export async function publishPrivate(postId: string, ctx?: JobContext) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId } });
  const log = (m: string) => ctx?.log(m);
  let result: PublishResult;
  if (await isDemo(post.accountId)) {
    await log("데모 계정 — 실제 플랫폼에는 발행하지 않고 상태만 변경합니다.");
    result = { remoteId: `demo-${post.id.slice(-6)}`, remoteUrl: undefined };
  } else if (post.platform === "BLOGGER") {
    result = await bloggerSaveDraft(postId, log);
  } else {
    result = await naverPublishPrivate(postId, log);
  }
  await db.post.update({
    where: { id: postId },
    data: { status: "PRIVATE", privateAt: new Date(), remoteId: result.remoteId ?? post.remoteId, remoteUrl: result.remoteUrl ?? post.remoteUrl, error: null },
  });
  return result;
}

/** 2단계: 사람 검수(승인) 후 공개 발행 */
export async function publishPublic(postId: string, ctx?: JobContext) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId } });
  const log = (m: string) => ctx?.log(m);
  let result: PublishResult;
  if (await isDemo(post.accountId)) {
    await log("데모 계정 — 공개 발행을 시뮬레이션합니다.");
    result = { remoteId: post.remoteId ?? undefined, remoteUrl: `https://example.com/demo/${post.id}` };
  } else if (post.platform === "BLOGGER") {
    result = await bloggerPublish(postId, log);
  } else {
    result = await naverMakePublic(postId, log);
  }
  await db.post.update({
    where: { id: postId },
    data: { status: "PUBLISHED", publishedAt: new Date(), remoteId: result.remoteId ?? post.remoteId, remoteUrl: result.remoteUrl ?? post.remoteUrl, error: null },
  });
  return result;
}

export async function publishSocial(socialPostId: string, ctx?: JobContext) {
  const sp = await db.socialPost.findUniqueOrThrow({ where: { id: socialPostId }, include: { cardNews: { include: { post: true } } } });
  const log = (m: string) => ctx?.log(m);
  try {
    let result: PublishResult;
    if (await isDemo(sp.accountId)) {
      await log("데모 계정 — SNS 발행을 시뮬레이션합니다.");
      result = { remoteId: `demo-${sp.id.slice(-6)}` };
    } else {
      result = await publishCardNews(sp.cardNewsId, sp.accountId!, sp.cardNews.post?.remoteUrl ?? "", log);
    }
    await db.socialPost.update({ where: { id: socialPostId }, data: { status: "PUBLISHED", publishedAt: new Date(), remoteId: result.remoteId, remoteUrl: result.remoteUrl, error: null } });
    return result;
  } catch (e) {
    await db.socialPost.update({ where: { id: socialPostId }, data: { status: "FAILED", error: (e as Error).message } });
    throw e;
  }
}
