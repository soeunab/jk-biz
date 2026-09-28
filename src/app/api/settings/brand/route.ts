import { fail, handle, ok } from "@/lib/api";
import { saveBrand, type Brand } from "@/lib/brand";

export const PUT = handle(async (req: Request) => {
  const b = (await req.json()) as Partial<Brand>;
  try {
    await saveBrand(b);
  } catch (e) {
    return fail((e as Error).message);
  }
  return ok();
});
