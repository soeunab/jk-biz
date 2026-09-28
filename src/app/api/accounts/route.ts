import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { encryptJson } from "@/lib/crypto";

const PLATFORMS = ["BLOGGER", "NAVER", "INSTAGRAM", "THREADS", "FACEBOOK"];

export const POST = handle(async (req: Request) => {
  const b = (await req.json()) as { platform: string; name: string; externalId?: string; url?: string; concept?: string; settings?: Record<string, unknown>; accessToken?: string };
  if (!PLATFORMS.includes(b.platform)) return fail("플랫폼을 선택하세요.");
  if (!b.name?.trim()) return fail("계정 이름을 입력하세요.");
  const account = await db.account.create({
    data: {
      platform: b.platform,
      name: b.name.trim(),
      externalId: b.externalId?.trim() || null,
      url: b.url?.trim() || null,
      concept: b.concept ?? "",
      settings: (b.settings ?? {}) as Prisma.InputJsonValue,
      credentials: b.accessToken ? encryptJson({ accessToken: b.accessToken.trim() }) : null,
    },
  });
  return ok({ id: account.id });
});
