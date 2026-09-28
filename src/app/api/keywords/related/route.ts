import { fail, handle, ok } from "@/lib/api";
import { relatedKeywords } from "@/lib/topics/related";

export const POST = handle(async (req: Request) => {
  const { keyword } = (await req.json()) as { keyword?: string };
  if (!keyword?.trim()) return fail("키워드를 입력하세요.");
  try {
    return ok({ rows: await relatedKeywords(keyword.trim()) });
  } catch (e) {
    return fail((e as Error).message);
  }
});
