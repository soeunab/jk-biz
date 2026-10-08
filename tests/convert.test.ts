import { describe, expect, it } from "vitest";
import { placeRemoteImages, remoteImages } from "../src/lib/content/convert";

const naverTitle = (t: string) => `<div class="se-component se-section-sectionTitle"><div class="se-module"><span>${t}</span></div></div>`;

describe("기존 글 원고 변환 — 블로그 이미지", () => {
  it("네이버 지연 로딩 이미지는 data-lazy-src 의 큰 이미지로, 스티커는 빼고, 빈 소제목은 무시", () => {
    const html = [
      `<img src="https://postfiles.pstatic.net/a/cover.png?type=w80_blur" data-lazy-src="https://postfiles.pstatic.net/a/cover.png?type=w773">`,
      naverTitle("▶ 1. 내 신청일은?"),
      `<img src="https://storep-phinf.pstatic.net/se-sticker/x.png" class="se-sticker-image">`,
      `<img src="https://postfiles.pstatic.net/a/b.png?type=w966">`,
      naverTitle("​"),
      `<img src="https://postfiles.pstatic.net/a/c.png?type=w773">`,
      `<h2>2. 일정</h2><img src="data:image/png;base64,xx">`,
    ].join("");
    expect(remoteImages(html)).toEqual([
      { url: "https://postfiles.pstatic.net/a/cover.png?type=w966", alt: "", heading: null },
      { url: "https://postfiles.pstatic.net/a/b.png?type=w966", alt: "", heading: "▶ 1. 내 신청일은?" },
      { url: "https://postfiles.pstatic.net/a/c.png?type=w966", alt: "", heading: "▶ 1. 내 신청일은?" },
    ]);
  });

  it("첫 이미지는 썸네일, 나머지는 원문 순서대로 섹션당 1장 — 찬 섹션은 다음 빈 섹션으로", () => {
    // 실제 변환 글(청년미래적금): 첫 소제목 앞 2장, 1번 소제목 아래 1장, 4번 소제목 아래 1장 → 4장 모두 연결
    const imgs = [{ heading: null }, { heading: null }, { heading: "▶ 1. 내 신청일은? 출생연도별 정리" }, { heading: "▶ 4. 신청 전 체크 3가지" }];
    const sections = ["1. 내 신청일은? 출생연도별 정리", "2. 전체 일정", "3. 가입 대상", "4. 신청 전 체크 3가지", "5. 금액"];
    expect(placeRemoteImages(imgs, sections)).toEqual(["thumbnail", "img1", "img2", "img4"]);
  });

  it("소제목 문구가 달라도 순서로 연결하고, 빈 섹션이 없으면 넣지 않음", () => {
    const imgs = [{ heading: "가" }, { heading: "나" }, { heading: "나" }, { heading: "나" }];
    expect(placeRemoteImages(imgs, ["첫째", "둘째"])).toEqual(["thumbnail", "img2", null, null]);
  });
});
