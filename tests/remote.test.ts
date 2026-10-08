import { describe, expect, it } from "vitest";
import { compareRemote, countImages, htmlText } from "@/lib/publishers/remote";
import { htmlToOutline } from "@/lib/content/convert";

const body = "근로장려금 대상은 소득과 재산 기준을 모두 충족해야 해요. 단독가구는 2,200만원 미만이에요. ".repeat(20);

describe("블로그 본문 비교 (블로그에서 고쳤는지)", () => {
  it("같으면 고치지 않음", () => {
    const d = compareRemote({ text: body, images: 6, title: "제목" }, { text: body, images: 6, title: "제목" });
    expect(d.edited).toBe(false);
  });
  it("사진을 추가했거나 문단을 고치면 고침으로 봄", () => {
    expect(compareRemote({ text: body, images: 7, title: "제목" }, { text: body, images: 6, title: "제목" }).edited).toBe(true);
    const changed = body.slice(0, 600) + "새로 쓴 경험담 문단이 여기에 길게 들어갔어요. 직접 신청해 보니 10분 걸렸어요. ".repeat(10);
    expect(compareRemote({ text: changed, images: 6, title: "제목" }, { text: body, images: 6, title: "제목" }).edited).toBe(true);
    expect(compareRemote({ text: body, images: 6, title: "새 제목" }, { text: body, images: 6, title: "제목" }).titleChanged).toBe(true);
  });
  it("기준이 없으면(기존 글 등록) 고침 여부를 판단하지 않음", () => {
    expect(compareRemote({ text: body, images: 3, title: "제목" }, { text: null, images: null, title: "" }).edited).toBe(false);
  });
});

describe("HTML 도우미", () => {
  it("본문 텍스트·사진 수", () => {
    expect(htmlText("<p>가 &amp; 나</p><script>x()</script>")).toBe("가 & 나");
    expect(countImages('<img src="a"><img src="b">')).toBe(2);
    expect(countImages('<img class="se-image-resource" src="a"><img class="emoji" src="b">')).toBe(1);
  });
  it("소제목을 ## 로 살려 원고 변환용 개요를 만듦", () => {
    const o = htmlToOutline('<p>직답 문단</p><h2>신청 방법은?</h2><p>홈택스에서 해요</p><div class="se-component se-section-sectionTitle">자주 묻는 질문</div><ul><li>Q1</li></ul><img src="x">');
    expect(o).toContain("## 신청 방법은?");
    expect(o).toContain("## 자주 묻는 질문");
    expect(o).toContain("- Q1");
    expect(o).toContain("[사진]");
  });
});
