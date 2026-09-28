import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";

/** 수익 직접 입력 (애드포스트·쇼핑커넥트 등 API 가 없는 수익) */
export const POST = handle(async (req: Request) => {
  const b = (await req.json()) as { date: string; source: string; amount: number | string; accountId?: string; postId?: string; note?: string };
  const amount = Number(String(b.amount).replace(/,/g, ""));
  if (!b.date || !b.source || !amount) return fail("날짜·수익원·금액을 입력하세요.");
  await db.revenue.create({
    data: { date: new Date(`${b.date}T00:00:00`), source: b.source, amount, accountId: b.accountId || null, postId: b.postId || null, note: b.note ?? "" },
  });
  return ok();
});
