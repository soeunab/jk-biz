import { db } from "@/lib/db";
import { handle, ok } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { status } = (await req.json()) as { status: string };
  await db.topic.update({
    where: { id: (await params).id },
    data: { status, dismissedAt: status === "DISMISSED" ? new Date() : null },
  });
  return ok();
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  await db.topic.delete({ where: { id: (await params).id } });
  return ok();
});
