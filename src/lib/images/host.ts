import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { env } from "../env";

/**
 * 외부에서 접근 가능한 이미지 URL 만들기.
 * - local: PUBLIC_BASE_URL/media/... (서버가 인터넷에 공개되어 있어야 함)
 * - cloudinary: Cloudinary 에 업로드 후 https URL 사용 (권장)
 */
export async function publishImage(localPath: string, relUrl: string): Promise<string> {
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
