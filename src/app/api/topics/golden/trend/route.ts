import { handle, ok } from "@/lib/api";
import { goldenTrend } from "@/lib/topics/golden";

/** 상세 패널용 — 최근 30일 일간 추이(하루 저장) + 골든 점수·진단(규칙, AI 안 씀) */
export const GET = handle(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return ok(await goldenTrend(id));
});
