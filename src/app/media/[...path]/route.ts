import { readFile } from "node:fs/promises";
import path from "node:path";
import { mediaPath } from "@/lib/storage";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

/** 생성 이미지 서빙 — 블로거·인스타그램이 이 URL 로 이미지를 가져갑니다 (인증 제외 경로). */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const file = mediaPath((await params).path);
  const type = file ? TYPES[path.extname(file).toLowerCase()] : undefined;
  if (!file || !type) return new Response("Not found", { status: 404 });
  try {
    const buf = await readFile(file);
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
