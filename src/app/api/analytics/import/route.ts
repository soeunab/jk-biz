import { fail, handle, ok } from "@/lib/api";
import { importPostMetrics, importRevenue } from "@/lib/analytics/importCsv";

export const POST = handle(async (req: Request) => {
  const { kind, csv } = (await req.json()) as { kind: "metrics" | "revenue"; csv: string };
  if (!csv?.trim()) return fail("CSV 내용을 붙여 넣으세요.");
  const result = kind === "revenue" ? await importRevenue(csv) : await importPostMetrics(csv);
  return ok(result);
});
