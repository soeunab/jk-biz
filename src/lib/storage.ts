import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * 생성된 이미지는 storage/media 아래에 저장되고 /media/... 경로(src/app/media 라우트)로 서빙됩니다.
 * (Next.js 운영 모드는 빌드 이후 public/ 에 추가된 파일을 서빙하지 않기 때문)
 */
export const MEDIA_DIR = path.join(process.cwd(), "storage", "media");

export async function saveMedia(buf: Buffer, ext: string, folder = "misc") {
  const dir = path.join(MEDIA_DIR, folder);
  await mkdir(dir, { recursive: true });
  const name = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}.${ext.replace(/^\./, "")}`;
  const full = path.join(dir, name);
  await writeFile(full, buf);
  const rel = `/media/${folder}/${name}`;
  return { localPath: full, relUrl: rel, absUrl: `${env.publicBaseUrl}${rel}` };
}

/** /media/... URL → 실제 파일 경로 (MEDIA_DIR 밖으로 벗어나면 null) */
export function mediaPath(segments: string[]): string | null {
  const full = path.resolve(MEDIA_DIR, ...segments);
  return full.startsWith(MEDIA_DIR + path.sep) ? full : null;
}
