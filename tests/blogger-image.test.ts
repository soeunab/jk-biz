/**
 * 블로거 이미지 형식 — 블로거 편집기 '아주 크게 + 가운데'와 같은 구조, 대체 텍스트·제목 텍스트 포함.
 * 기준: 사용자가 편집기로 직접 올린 글(jiwon4u.kr)의 이미지 HTML.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { bloggerImage } from "@/lib/content/render";
import { imageSize, imageSizeFromBuffer } from "@/lib/images/size";

describe("bloggerImage", () => {
  it("아주 크게(640) + 가운데 + alt·title + 원본 크기", () => {
    const html = bloggerImage({ slot: "thumbnail", src: "https://x/a.png", alt: "제미나이 4 \"아르곤\" 썸네일", width: 1200, height: 675 });
    expect(html).toBe(
      '<div class="separator" style="clear: both; text-align: center;"><a href="https://x/a.png" style="margin-left: 1em; margin-right: 1em;">' +
        '<img alt="제미나이 4 &quot;아르곤&quot; 썸네일" border="0" data-original-height="675" data-original-width="1200" height="360" src="https://x/a.png" title="제미나이 4 &quot;아르곤&quot; 썸네일" width="640" /></a></div>',
    );
  });

  it("캡션·출처가 있으면 블로거 캡션 표 형식, 제목 텍스트는 캡션", () => {
    const html = bloggerImage({ slot: "s1", src: "https://x/b.png", alt: "공식 발표 화면", caption: "구글 공식 블로그 발표", credit: "Google", width: 1280, height: 800 });
    expect(html).toContain('class="tr-caption-container"');
    expect(html).toContain('title="구글 공식 블로그 발표"');
    expect(html).toContain('alt="공식 발표 화면"');
    expect(html).toContain('width="640"');
    expect(html).toContain('height="400"');
    expect(html).toContain('<td class="tr-caption" style="text-align: center;">구글 공식 블로그 발표 (Google)</td>');
  });

  it("크기를 모르면 width 만 (높이는 테마 height:auto)", () => {
    const html = bloggerImage({ slot: "s2", src: "https://x/c.png", alt: "그림" });
    expect(html).toContain('width="640"');
    expect(html).not.toContain("height=");
    expect(bloggerImage({ slot: "s3", src: "", alt: "" })).toBe("");
  });
});

describe("imageSize", () => {
  it("PNG·GIF·WebP(VP8X)·JPEG 머리말에서 크기", async () => {
    const png = Buffer.alloc(32);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(1200, 16);
    png.writeUInt32BE(675, 20);
    expect(imageSizeFromBuffer(png)).toEqual({ width: 1200, height: 675 });

    const gif = Buffer.alloc(32);
    gif.write("GIF89a", 0, "ascii");
    gif.writeUInt16LE(320, 6);
    gif.writeUInt16LE(200, 8);
    expect(imageSizeFromBuffer(gif)).toEqual({ width: 320, height: 200 });

    const webp = Buffer.alloc(40);
    webp.write("RIFF", 0, "ascii");
    webp.write("WEBPVP8X", 8, "ascii");
    webp.writeUIntLE(1199, 24, 3);
    webp.writeUIntLE(674, 27, 3);
    expect(imageSizeFromBuffer(webp)).toEqual({ width: 1200, height: 675 });

    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xa3, 0x04, 0xb0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(imageSizeFromBuffer(jpg)).toEqual({ width: 1200, height: 675 });

    const dir = mkdtempSync(path.join(os.tmpdir(), "img-"));
    writeFileSync(path.join(dir, "a.png"), png);
    expect(await imageSize(path.join(dir, "a.png"))).toEqual({ width: 1200, height: 675 });
    expect(await imageSize(path.join(dir, "없음.png"))).toBeNull();
  });
});
