import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { handle, ok } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { status, title } = (await req.json()) as { status?: string; title?: string };
  const id = (await params).id;
  // 제목 고르기 (롱테일 확장에서 만든 6가지 유형 제목 중 하나) — 고른 제목은 원고 제목으로 확정(titleLocked)
  if (title?.trim()) {
    const t = await db.topic.findUniqueOrThrow({ where: { id }, select: { signals: true } });
    const signals = { ...((t.signals ?? {}) as Record<string, unknown>), titleLocked: true } as Prisma.InputJsonValue;
    await db.topic.update({ where: { id }, data: { title: title.trim().slice(0, 120), signals } });
  }
  if (status) await db.topic.update({ where: { id }, data: { status, dismissedAt: status === "DISMISSED" ? new Date() : null } });
  return ok();
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  await db.topic.delete({ where: { id: (await params).id } });
  return ok();
});
