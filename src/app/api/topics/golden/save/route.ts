import { handle, ok } from "@/lib/api";
import { saveGoldenAsTopic } from "@/lib/topics/golden";

/** 황금키워드 → 주제 목록에 저장 (origin golden) — 이후 제목 6가지·원고 생성은 기존 흐름 그대로 */
export const POST = handle(async (req: Request) => {
  const { id } = (await req.json()) as { id: string };
  return ok(await saveGoldenAsTopic(id));
});
