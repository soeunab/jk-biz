import { open } from "node:fs/promises";

/**
 * 이미지 파일 머리말만 읽어 가로·세로 픽셀을 구합니다 (PNG·JPEG·WebP·GIF). 의존성 없이 앞부분만 읽음.
 * 블로거 '아주 크게' 형식(width 640 + 원본 크기 표시)에 원본 비율이 필요해서 씁니다. 못 읽으면 null.
 */
export function imageSizeFromBuffer(b: Buffer): { width: number; height: number } | null {
  if (b.length < 24) return null;
  // PNG: IHDR
  if (b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  // GIF
  if (b.toString("ascii", 0, 3) === "GIF") return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  // WebP
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (kind === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (kind === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    return null;
  }
  // JPEG: SOFn 마커까지 건너뜀
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

export async function imageSize(path: string): Promise<{ width: number; height: number } | null> {
  try {
    const fh = await open(path, "r");
    try {
      const buf = Buffer.alloc(256 * 1024); // JPEG 는 EXIF 뒤에 SOF 가 있어 넉넉히
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      return imageSizeFromBuffer(buf.subarray(0, bytesRead));
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}
