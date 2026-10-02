import { createHash } from "node:crypto";
import { extname } from "node:path";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { google } from "googleapis";
import { env } from "../env";

const MIME_BY_EXT: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

let gcsAuth: InstanceType<typeof google.auth.GoogleAuth> | null = null;
function gcsClient() {
  gcsAuth ??= new google.auth.GoogleAuth({ keyFile: env.gcs!.keyFile, scopes: ["https://www.googleapis.com/auth/devstorage.read_write"] });
  return google.storage({ version: "v1", auth: gcsAuth });
}

/** 구글 클라우드 스토리지(이 앱이 이미 쓰는 jiwon4u 프로젝트의 전용 버킷)에 업로드 — 블로거 글에 바로 쓸 수 있는 공개 주소를 돌려줌 */
async function uploadToGcs(localPath: string): Promise<string> {
  const { bucket } = env.gcs!;
  const name = `posts/${Date.now()}-${createHash("sha1").update(localPath).digest("hex").slice(0, 8)}${extname(localPath)}`;
  const storage = gcsClient();
  await storage.objects.insert({
    bucket,
    name,
    media: { mimeType: MIME_BY_EXT[extname(localPath).toLowerCase()] ?? "application/octet-stream", body: Readable.from(await readFile(localPath)) },
  });
  return `https://storage.googleapis.com/${bucket}/${encodeURIComponent(name)}`;
}

/**
 * 외부에서 접근 가능한 이미지 URL 만들기.
 * - gcs: 구글 클라우드 스토리지(이 앱이 이미 쓰는 프로젝트의 전용 버킷·서비스 계정) — 권장, 새 계정 불필요
 * - cloudinary: Cloudinary 에 업로드 후 https URL 사용
 * - local: PUBLIC_BASE_URL/media/... (서버가 인터넷에 공개되어 있어야 함)
 */
export async function publishImage(localPath: string, relUrl: string): Promise<string> {
  if (env.imageHost === "gcs" && env.gcs) {
    return uploadToGcs(localPath);
  }
  if (env.imageHost === "cloudinary" && env.cloudinary) {
    const { cloud, key, secret } = env.cloudinary;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const folder = "jiwon4u";
    const signature = createHash("sha1").update(`folder=${folder}&timestamp=${timestamp}${secret}`).digest("hex");
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(await readFile(localPath))]));
    form.append("api_key", key);
    form.append("timestamp", timestamp);
    form.append("folder", folder);
    form.append("signature", signature);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`Cloudinary 업로드 실패: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { secure_url: string }).secure_url;
  }
  return `${env.publicBaseUrl}${relUrl}`;
}
