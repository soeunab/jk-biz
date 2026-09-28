import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";

export const POST = handle(async (req: Request) => {
  const b = (await req.json()) as { program: string; name: string; url: string; tags?: string; price?: string; platform?: string; note?: string };
  if (!b.name?.trim() || !/^https?:\/\//.test(b.url ?? "")) return fail("상품명과 올바른 링크(URL)를 입력하세요.");
  await db.affiliateProduct.create({
    data: { program: b.program || "OTHER", name: b.name.trim(), url: b.url.trim(), tags: b.tags ?? "", price: b.price ? Number(b.price.replace(/,/g, "")) : null, platform: b.platform || "BOTH", note: b.note ?? "" },
  });
  return ok();
});
