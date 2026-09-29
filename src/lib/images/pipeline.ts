import { db } from "../db";
import { getBrand, accountBrand } from "../brand";
import { saveMedia } from "../storage";
import type { Manuscript, ImageSlot } from "../content/types";
import { aiImage, pexelsImage, screenshotImage, templateImage, thumbnailImage, unsplashImage, type ImageResult } from "./sources";

type Log = (m: string) => Promise<unknown> | void;

/** 슬롯 유형별 시도 순서 — 앞에서 실패하면 다음 소스로 */
function strategy(slot: ImageSlot): ((s: ImageSlot) => Promise<ImageResult | null>)[] {
  const ai = (s: ImageSlot) => aiImage(s.prompt);
  const stock = async (s: ImageSlot) => (await unsplashImage(s.prompt)) ?? (await pexelsImage(s.prompt));
  const shot = (s: ImageSlot) => screenshotImage(s.url);
  if (slot.source === "screenshot") return [shot, ai, stock];
  if (slot.source === "stock") return [stock, ai];
  return [ai, stock];
}

/** 원고의 이미지 슬롯을 채우고 썸네일을 만듭니다. 기존 이미지는 교체됩니다. */
export async function buildPostImages(postId: string, m: Manuscript, platform: "NAVER" | "BLOGGER", log?: Log) {
  const post = await db.post.findUnique({ where: { id: postId }, select: { account: { select: { name: true, concept: true } } } });
  // 썸네일·목록 이미지에 찍히는 문구는 계정마다 달라야 함 — 여러 블로그를 운영할 때 다른 계정 글에 이 브랜드명이 섞여 나가면 안 됨
  const label = accountBrand(await getBrand(), post?.account).name;
  await db.asset.deleteMany({ where: { postId } });

  // 1) 썸네일 (네이버는 검색결과에서 정사각형으로 잘리므로 1:1)
  const square = platform === "NAVER";
  const bg = await aiImage(m.thumbnail.prompt, square ? "1:1" : "16:9").catch(() => null);
  const thumb = await thumbnailImage({
    headline: m.thumbnail.headline,
    sub: m.thumbnail.sub,
    brand: label,
    background: bg?.buf,
    width: square ? 1080 : 1200,
    height: square ? 1080 : 675,
    seed: m.title.length,
  });
  const t = await saveMedia(thumb.buf, thumb.ext, `posts/${postId}`);
  await db.asset.create({
    data: { postId, kind: "THUMBNAIL", source: bg ? "GEMINI" : "TEMPLATE", slot: "thumbnail", localPath: t.localPath, publicUrl: t.relUrl, alt: m.title, prompt: m.thumbnail.prompt, order: 0, width: thumb.width, height: thumb.height },
  });
  await log?.("썸네일 생성 완료");

  // 2) 본문 이미지
  const slots = m.sections.flatMap((s) => (s.image ? [s.image] : []));
  let order = 1;
  for (const slot of slots) {
    let result: ImageResult | null = null;
    let used = "TEMPLATE";
    for (const [i, attempt] of strategy(slot).entries()) {
      try {
        result = await attempt(slot);
        if (result) {
          used = slot.source === "screenshot" && i === 0 ? "SCREENSHOT" : result.credit?.includes("Unsplash") ? "UNSPLASH" : result.credit?.includes("Pexels") ? "PEXELS" : "GEMINI";
          break;
        }
      } catch (e) {
        await log?.(`${slot.slot} ${slot.source} 실패: ${(e as Error).message.slice(0, 120)}`);
      }
    }
    result ??= await templateImage(slot.alt, label, 1200, 675, order);
    const saved = await saveMedia(result.buf, result.ext, `posts/${postId}`);
    await db.asset.create({
      data: { postId, kind: "INLINE", source: used, slot: slot.slot, localPath: saved.localPath, publicUrl: saved.relUrl, alt: slot.alt, prompt: slot.prompt, credit: result.credit ?? "", order: order++ },
    });
    await log?.(`${slot.slot} (${used}) 준비 완료`);
  }
  return order;
}
