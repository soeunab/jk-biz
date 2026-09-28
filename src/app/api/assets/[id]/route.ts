import { rm } from "node:fs/promises";
import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { saveMedia } from "@/lib/storage";
import { rerenderPost } from "@/lib/content/service";

/** 검수자가 직접 캡처한 이미지로 교체 (신뢰도·독창성 향상) */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const asset = await db.asset.findUniqueOrThrow({ where: { id: (await params).id } });
  const form = await req.formData();
  const file = form.get("file");
  const alt = form.get("alt");
  if (file instanceof File && file.size > 0) {
    if (!file.type.startsWith("image/")) return fail("이미지 파일만 업로드할 수 있어요.");
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const saved = await saveMedia(Buffer.from(await file.arrayBuffer()), ext, asset.postId ? `posts/${asset.postId}` : "uploads");
    await db.asset.update({ where: { id: asset.id }, data: { localPath: saved.localPath, publicUrl: saved.relUrl, source: "UPLOAD", credit: "" } });
  }
  if (typeof alt === "string" && alt.trim()) await db.asset.update({ where: { id: asset.id }, data: { alt: alt.trim() } });
  if (asset.postId) await rerenderPost(asset.postId);
  return ok();
});

export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const asset = await db.asset.delete({ where: { id: (await params).id } });
  await rm(asset.localPath, { force: true });
  if (asset.postId) await rerenderPost(asset.postId);
  return ok();
});
