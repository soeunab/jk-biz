import { handle, ok } from "@/lib/api";
import { saveBrand, type Brand } from "@/lib/brand";

export const PUT = handle(async (req: Request) => {
  const b = (await req.json()) as Partial<Brand>;
  await saveBrand(b);
  return ok();
});
