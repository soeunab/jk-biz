import { fail, handle, ok } from "@/lib/api";
import { enqueue } from "@/lib/jobs/queue";
import { CATEGORY_CHOICES } from "@/lib/topics/channels/config";
import { NO_RESTRICTION } from "@/lib/topics/channels/filters";
import { CHANNEL_IDS, type ChannelId } from "@/lib/topics/channels/types";

/** 실시간 6채널 발굴 작업 등록 (수집은 워커가 브라우저로 진행) */
export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as { category?: string; limit?: number; domain?: string; channels?: string[]; focusTerms?: unknown };
  const category = body.category?.trim() || NO_RESTRICTION;
  if (!CATEGORY_CHOICES.includes(category)) return fail(`알 수 없는 카테고리: ${category}`);
  const channels = (body.channels ?? []).filter((c): c is ChannelId => CHANNEL_IDS.includes(c as ChannelId));
  if (body.channels && !channels.length) return fail("수집할 채널을 하나 이상 고르세요.");
  const focusTerms = Array.isArray(body.focusTerms)
    ? [...new Set(body.focusTerms.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter((t) => t && t.length <= 30))].slice(0, 60)
    : [];
  const job = await enqueue("topic.channels", {
    category,
    limit: Math.min(Math.max(Number(body.limit) || 10, 1), 30),
    domain: body.domain?.trim() || undefined,
    channels: channels.length ? channels : undefined,
    focusTerms: focusTerms.length ? focusTerms : undefined,
  });
  return ok({ jobId: job.id });
});
