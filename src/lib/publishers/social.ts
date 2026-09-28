import { db } from "../db";
import { decryptJson } from "../crypto";
import { env } from "../env";
import { publishImage } from "../images/host";
import { CaptionsSchema } from "../cardnews";
import { sleep } from "../util";
import type { PublishResult } from "./types";

/**
 * 카드뉴스 SNS 발행
 * - 인스타그램: Instagram Graph API (비즈니스/크리에이터 계정 + 페이스북 페이지 연결 필요) — 캐러셀 최대 10장
 * - 스레드: Threads API — 캐러셀
 * - 페이스북 페이지: Pages API — 다중 사진 게시물
 * 이미지 URL 은 외부에서 접근 가능해야 합니다(IMAGE_HOST=cloudinary 권장).
 */
type SocialCreds = { accessToken: string };

async function graph<T>(base: string, pathname: string, params: Record<string, string>, method: "GET" | "POST" = "POST"): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${base}/${pathname}?${qs}`, { method });
  const data = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok || data.error) throw new Error(`Graph API 오류: ${data.error?.message ?? res.status}`);
  return data;
}

async function slideUrls(cardNewsId: string) {
  const assets = await db.asset.findMany({ where: { cardNewsId }, orderBy: { order: "asc" } });
  const urls: string[] = [];
  for (const a of assets.slice(0, 10)) urls.push(await publishImage(a.localPath, a.publicUrl ?? ""));
  return urls;
}

export async function publishCardNews(cardNewsId: string, accountId: string, link: string, log: (m: string) => unknown): Promise<PublishResult> {
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  const card = await db.cardNews.findUniqueOrThrow({ where: { id: cardNewsId } });
  const captions = CaptionsSchema.partial().parse(card.captions ?? {});
  const creds = decryptJson<SocialCreds>(account.credentials);
  if (!creds?.accessToken || !account.externalId) throw new Error(`"${account.name}" 계정에 액세스 토큰과 사용자/페이지 ID 를 입력해 주세요.`);
  const token = creds.accessToken;
  const withLink = (s?: string) => (s ?? card.title).replaceAll("{link}", link);
  const urls = await slideUrls(cardNewsId);
  await log(`슬라이드 ${urls.length}장 업로드 URL 준비`);

  if (account.platform === "INSTAGRAM") {
    const base = `https://graph.facebook.com/${env.metaGraphVersion}`;
    const children: string[] = [];
    for (const url of urls) {
      const r = await graph<{ id: string }>(base, `${account.externalId}/media`, { image_url: url, is_carousel_item: "true", access_token: token });
      children.push(r.id);
    }
    const container = await graph<{ id: string }>(base, `${account.externalId}/media`, {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption: withLink(captions.instagram),
      access_token: token,
    });
    for (let i = 0; i < 20; i++) {
      const s = await graph<{ status_code: string }>(base, container.id, { fields: "status_code", access_token: token }, "GET");
      if (s.status_code === "FINISHED") break;
      if (s.status_code === "ERROR") throw new Error("인스타그램 미디어 처리 실패");
      await sleep(3000);
    }
    const pub = await graph<{ id: string }>(base, `${account.externalId}/media_publish`, { creation_id: container.id, access_token: token });
    const info = await graph<{ permalink?: string }>(base, pub.id, { fields: "permalink", access_token: token }, "GET");
    return { remoteId: pub.id, remoteUrl: info.permalink };
  }

  if (account.platform === "THREADS") {
    const base = "https://graph.threads.net/v1.0";
    const children: string[] = [];
    for (const url of urls) {
      const r = await graph<{ id: string }>(base, `${account.externalId}/threads`, { media_type: "IMAGE", image_url: url, is_carousel_item: "true", access_token: token });
      children.push(r.id);
    }
    const container = await graph<{ id: string }>(base, `${account.externalId}/threads`, {
      media_type: "CAROUSEL",
      children: children.join(","),
      text: withLink(captions.threads),
      access_token: token,
    });
    await sleep(5000); // 스레드 권장: 게시 전 처리 대기
    const pub = await graph<{ id: string }>(base, `${account.externalId}/threads_publish`, { creation_id: container.id, access_token: token });
    const info = await graph<{ permalink?: string }>(base, pub.id, { fields: "permalink", access_token: token }, "GET");
    return { remoteId: pub.id, remoteUrl: info.permalink };
  }

  if (account.platform === "FACEBOOK") {
    const base = `https://graph.facebook.com/${env.metaGraphVersion}`;
    const media: string[] = [];
    for (const url of urls) {
      const r = await graph<{ id: string }>(base, `${account.externalId}/photos`, { url, published: "false", access_token: token });
      media.push(r.id);
    }
    const params: Record<string, string> = { message: withLink(captions.facebook), access_token: token };
    media.forEach((id, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
    const pub = await graph<{ id: string }>(base, `${account.externalId}/feed`, params);
    return { remoteId: pub.id, remoteUrl: `https://www.facebook.com/${pub.id}` };
  }

  throw new Error(`${account.platform} 은(는) 자동 발행을 지원하지 않습니다. ZIP 내보내기를 이용해 주세요.`);
}
