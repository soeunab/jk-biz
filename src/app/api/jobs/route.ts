import { db } from "@/lib/db";
import { handle, ok } from "@/lib/api";

export const GET = handle(async (req: Request) => {
  const ids = new URL(req.url).searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
  const jobs = await db.job.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, progress: true, error: true } });
  return ok({ jobs });
});
