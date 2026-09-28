import { db } from "@/lib/db";
import { exportCardNewsZip } from "@/lib/cardnews";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const card = await db.cardNews.findUniqueOrThrow({ where: { id }, include: { post: true } });
  const buf = await exportCardNewsZip(id, card.post?.remoteUrl ?? "");
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="cardnews-${id}.zip"` },
  });
}
