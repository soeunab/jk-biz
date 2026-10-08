import { db } from "../db";
import { asObject } from "../util";
import type { JobContext } from "../jobs/queue";
import { bloggerPublish, bloggerSaveDraft } from "./blogger";
import { naverMakePublic, naverPublishPrivate } from "./naver";
import { publishCardNews } from "./social";
import { markPushed, syncRemote } from "./remote";
import type { PublishResult } from "./types";
import { NAVER_UNCONFIRMED, NAVER_UNCONFIRMED_MSG, publicUrlOf, PUBLISH_PRIVATE_ALLOWED } from "../content/postStatus";

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
  // 작업이 대기하는 사이 상태가 바뀌었을 수 있음(승인·재생성 등) — 실행 시점에 다시 확인
  if (!(PUBLISH_PRIVATE_ALLOWED as readonly string[]).includes(post.status)) throw new Error(`지금 상태(${post.status})에서는 비공개 발행을 하지 않아요.`);
  let result: PublishResult;
  if (await isDemo(post.accountId)) {
    await log("데모 계정 — 실제 플랫폼에는 발행하지 않고 상태만 변경합니다.");
    result = { remoteId: `demo-${post.id.slice(-6)}`, remoteUrl: undefined };
  } else if (post.platform === "BLOGGER") {
    result = await bloggerSaveDraft(postId, log);
  } else {
    result = await naverPublishPrivate(postId, log);
  }
  if (result.note === NAVER_UNCONFIRMED) {
    // 올라갔는지 모름 — 상태는 초안으로 두고 다시 올리기는 막음(사람이 네이버에서 확인 후 정리)
    await db.post.update({ where: { id: postId }, data: { status: "DRAFT", remoteId: NAVER_UNCONFIRMED, remoteUrl: null, error: NAVER_UNCONFIRMED_MSG } });
    return result;
  }
  await db.post.update({
    where: { id: postId },
    // 블로거 초안은 공개 주소가 없음(편집 주소는 쓰지 않음) — 공개 발행 때 실제 주소가 들어감
    data: { status: "PRIVATE", privateAt: new Date(), remoteId: result.remoteId ?? post.remoteId, remoteUrl: post.platform === "BLOGGER" ? null : (result.remoteUrl ?? post.remoteUrl), error: null },
  });
  // 올라간 직후 본문을 기준으로 저장 — 이후 블로그에서 고쳤는지 비교 (실패해도 발행은 성공)
  if (!(await isDemo(post.accountId))) await markPushed(postId, log).catch(() => undefined);
  return result;
}

/** 2단계: 사람 검수(승인) 후 공개 발행 */
export async function publishPublic(postId: string, ctx?: JobContext) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId } });
  const log = (m: string) => ctx?.log(m);
  if (post.status !== "APPROVED") throw new Error(`사람 승인(APPROVED) 상태가 아니라 공개 발행을 하지 않았어요(지금 상태: ${post.status}).`);
  let result: PublishResult;
  if (await isDemo(post.accountId)) {
    await log("데모 계정 — 공개 발행을 시뮬레이션합니다.");
    result = { remoteId: post.remoteId ?? undefined, remoteUrl: `https://example.com/demo/${post.id}` };
  } else {
    // 공개 직전에 블로그 본문을 다시 읽어 둠 — 비공개 발행 뒤 블로그에서 고친 내용을 스튜디오에 남김 (공개 전환은 블로그 본문을 바꾸지 않음)
    await syncRemote(postId, log).catch((e) => log(`블로그 본문 확인 건너뜀: ${(e as Error).message.split("\n")[0]}`));
    result = post.platform === "BLOGGER" ? await bloggerPublish(postId, log) : await naverMakePublic(postId, log);
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
    const p = sp.cardNews.post;
    if (sp.cardNews.postId && !["APPROVED", "PUBLISHED"].includes(p?.status ?? "")) throw new Error("원고 승인 후 SNS 발행할 수 있어요.");
    let result: PublishResult;
    if (await isDemo(sp.accountId)) {
      await log("데모 계정 — SNS 발행을 시뮬레이션합니다.");
      result = { remoteId: `demo-${sp.id.slice(-6)}` };
    } else {
      result = await publishCardNews(sp.cardNewsId, sp.accountId!, publicUrlOf(p) ?? "", log);
    }
    await db.socialPost.update({ where: { id: socialPostId }, data: { status: "PUBLISHED", publishedAt: new Date(), remoteId: result.remoteId, remoteUrl: result.remoteUrl, error: null } });
    return result;
  } catch (e) {
    await db.socialPost.update({ where: { id: socialPostId }, data: { status: "FAILED", error: (e as Error).message } });
    throw e;
  }
}
