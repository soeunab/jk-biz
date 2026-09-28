/**
 * 초기 데이터: 브랜드 설정 + 데모 계정 + 샘플 제휴 상품
 * 데모 계정(settings.demo=true)은 실제 발행 없이 전체 흐름을 체험하기 위한 것입니다.
 * 실제 운영 시 [계정 관리]에서 실제 계정을 추가하고 데모 계정은 비활성화/삭제하세요.
 */
import "../scripts/load-env";
import { db } from "../src/lib/db";
import { DEFAULT_BRAND } from "../src/lib/brand";

async function main() {
  await db.setting.upsert({ where: { key: "brand" }, create: { key: "brand", value: DEFAULT_BRAND }, update: {} });

  if ((await db.account.count()) === 0) {
    await db.account.createMany({
      data: [
        {
          platform: "BLOGGER",
          name: "[데모] 지원포유 AI 가이드 (블로거)",
          externalId: "demo-blogger",
          concept: "AI 도구 기초 사용법과 비교 리뷰 중심의 정보형 블로그",
          settings: { demo: true },
        },
        {
          platform: "NAVER",
          name: "[데모] 지원포유 (네이버)",
          externalId: "demo-naver",
          concept: "직장인·프리랜서가 바로 따라 하는 AI 업무 활용 후기형 블로그",
          settings: { demo: true, publishMode: "private" },
        },
        {
          platform: "INSTAGRAM",
          name: "[데모] @jiwon4u 인스타그램",
          externalId: "demo-ig",
          settings: { demo: true },
        },
      ],
    });
  }

  if ((await db.affiliateProduct.count()) === 0) {
    await db.affiliateProduct.createMany({
      data: [
        { program: "SHOPPING_CONNECT", name: "[샘플] 가벼운 업무용 노트북", url: "https://example.com/replace-with-shopping-connect-link", tags: "노트북,재택근무,프리랜서,업무", platform: "NAVER", note: "쇼핑커넥트 링크로 교체하세요" },
        { program: "SHOPPING_CONNECT", name: "[샘플] 저소음 무선 키보드", url: "https://example.com/replace-with-shopping-connect-link-2", tags: "키보드,직장인,업무,보고서", platform: "NAVER", note: "쇼핑커넥트 링크로 교체하세요" },
        { program: "COUPANG", name: "[샘플] 챗GPT·AI 업무 활용 도서", url: "https://example.com/replace-with-coupang-partners-link", tags: "ai,책,프롬프트,입문", platform: "BLOGGER", note: "쿠팡파트너스 링크로 교체하세요" },
      ],
    });
  }
  console.log("✅ 시드 완료");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
