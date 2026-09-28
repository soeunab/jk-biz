import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { CaptionsSchema, rerenderCardNews, SlideSchema, THEMES } from "@/lib/cardnews";
import { enqueue } from "@/lib/jobs/queue";

type Ctx = { params: Promise<{ id: string }> };

/** 슬라이드 문구·캡션·테마 수정 → 즉시 다시 렌더링 */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const id = (await params).id;
  const b = (await req.json()) as { slides?: unknown; captions?: unknown; theme?: string; regenerate?: boolean };
  if (b.regenerate) return ok({ jobId: (await enqueue("cardnews.generate", { cardNewsId: id })).id });
  const data: Prisma.CardNewsUpdateInput = {};
  if (b.slides !== undefined) {
    const s = z.array(SlideSchema).safeParse(b.slides);
    if (!s.success) return fail("슬라이드 형식 오류");
    data.slides = s.data as unknown as Prisma.InputJsonValue;
  }
  if (b.captions !== undefined) data.captions = CaptionsSchema.partial().parse(b.captions) as Prisma.InputJsonValue;
  if (b.theme && b.theme in THEMES) data.theme = b.theme;
  await db.cardNews.update({ where: { id }, data });
  if (b.slides !== undefined || b.theme) await rerenderCardNews(id);
  return ok();
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  await db.cardNews.delete({ where: { id: (await params).id } });
  return ok({ redirect: "/cardnews" });
});
