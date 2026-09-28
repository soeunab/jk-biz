import { handle, ok, fail } from "@/lib/api";
import { enqueue } from "@/lib/jobs/queue";
import { createCardNews, type ThemeName } from "@/lib/cardnews";

export const POST = handle(async (req: Request) => {
  const b = (await req.json()) as { postId?: string; topic?: string; theme?: ThemeName };
  if (!b.postId && !b.topic?.trim()) return fail("원고를 선택하거나 주제를 입력하세요.");
  const card = await createCardNews({ postId: b.postId || undefined, topic: b.topic, theme: b.theme });
  const job = await enqueue("cardnews.generate", { cardNewsId: card.id });
  return ok({ jobId: job.id, redirect: `/cardnews/${card.id}` });
});
