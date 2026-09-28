import { db } from "@/lib/db";
import { handle, ok } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { active } = (await req.json()) as { active: boolean };
  await db.affiliateProduct.update({ where: { id: (await params).id }, data: { active } });
  return ok();
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  await db.affiliateProduct.delete({ where: { id: (await params).id } });
  return ok();
});
