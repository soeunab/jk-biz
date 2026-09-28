import { db } from "@/lib/db";
import { handle, ok } from "@/lib/api";

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { status } = (await req.json()) as { status: "OPEN" | "DONE" | "DISMISSED" };
  await db.insight.update({ where: { id: (await params).id }, data: { status } });
  return ok();
});
