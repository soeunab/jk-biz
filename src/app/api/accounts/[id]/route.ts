import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { handle, ok } from "@/lib/api";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { asObject } from "@/lib/util";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const id = (await params).id;
  const b = (await req.json()) as { name?: string; externalId?: string; url?: string; concept?: string; settings?: Record<string, unknown>; active?: boolean; accessToken?: string; disconnect?: boolean };
  const account = await db.account.findUniqueOrThrow({ where: { id } });
  const data: Prisma.AccountUpdateInput = {};
  if (b.name !== undefined) data.name = b.name;
  if (b.externalId !== undefined) data.externalId = b.externalId || null;
  if (b.url !== undefined) data.url = b.url || null;
  if (b.concept !== undefined) data.concept = b.concept;
  if (b.active !== undefined) data.active = b.active;
  if (b.settings) data.settings = { ...asObject<Record<string, unknown>>(account.settings, {}), ...b.settings } as Prisma.InputJsonValue;
  // 재발행 짝은 양방향 관계 — 상대 계정 설정에도 반영
  const nextPartners = b.settings?.republishPartnerIds as string[] | undefined;
  if (Array.isArray(nextPartners)) {
    const prev = (asObject<{ republishPartnerIds?: string[] }>(account.settings, {}).republishPartnerIds ?? []) as string[];
    const changed = [...new Set([...prev, ...nextPartners])].filter((pid) => pid !== id);
    for (const pid of changed) {
      const other = await db.account.findUnique({ where: { id: pid } });
      if (!other) continue;
      const os = asObject<Record<string, unknown>>(other.settings, {});
      const list = new Set((os.republishPartnerIds as string[] | undefined) ?? []);
      if (nextPartners.includes(pid)) list.add(id);
      else list.delete(id);
      await db.account.update({ where: { id: pid }, data: { settings: { ...os, republishPartnerIds: [...list] } as Prisma.InputJsonValue } });
    }
  }
  if (b.accessToken) data.credentials = encryptJson({ ...(decryptJson(account.credentials) ?? {}), accessToken: b.accessToken.trim() });
  if (b.disconnect) data.credentials = null;
  await db.account.update({ where: { id }, data });
  return ok();
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  await db.account.delete({ where: { id: (await params).id } });
  return ok();
});
