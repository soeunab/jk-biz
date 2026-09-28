import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { currentJob } from "../jobs/context";

/**
 * 수동(복사·붙여넣기) 모드 — 비용 0원.
 * AI 가 필요한 순간 지시문을 저장하고 작업을 "수동 입력 대기"로 멈춥니다.
 * 사용자가 데스크탑 Claude 등에 지시문을 붙여 넣고 받은 JSON 을 붙여 넣으면, 같은 작업을 다시 실행해 그 답을 사용합니다.
 */
export class ManualPendingError extends Error {
  constructor(readonly requestId: string, readonly title: string) {
    super(`수동 입력 대기: ${title}`);
  }
}

type Req<T> = { name: string; title?: string; system: string; prompt: string; schema: z.ZodType<T> };

export async function manualJson<T>(req: Req<T>, reason?: string): Promise<T> {
  const job = currentJob();
  if (!job) throw new Error("수동 모드는 백그라운드 작업(워커)에서만 사용할 수 있어요.");
  const key = `${job.jobId}:${job.calls++}`;
  const existing = await db.manualRequest.findUnique({ where: { key } });
  if (existing?.status === "DONE") {
    const parsed = req.schema.safeParse(existing.response);
    if (parsed.success) return parsed.data;
    // 붙여 넣은 결과가 스키마와 안 맞으면 다시 대기 (보통 붙여넣기 단계에서 걸러짐)
    await db.manualRequest.update({ where: { key }, data: { status: "PENDING", error: formatZodError(parsed.error) } });
    throw new ManualPendingError(existing.id, existing.title);
  }
  if (existing) throw new ManualPendingError(existing.id, existing.title);
  const payload = job.payload;
  const created = await db.manualRequest.create({
    data: {
      key,
      jobId: job.jobId,
      jobType: job.jobType,
      schemaName: req.name,
      title: req.title ?? req.name,
      system: req.system,
      prompt: req.prompt,
      schemaJson: z.toJSONSchema(req.schema as z.ZodType) as Prisma.InputJsonValue,
      postId: typeof payload.postId === "string" ? payload.postId : null,
      cardNewsId: typeof payload.cardNewsId === "string" ? payload.cardNewsId : null,
      error: reason ?? null,
    },
  });
  throw new ManualPendingError(created.id, created.title);
}

/** 데스크탑 Claude 에 그대로 붙여 넣을 한 덩어리 지시문 */
export function buildManualPrompt(r: { system: string; prompt: string; schemaJson: unknown }) {
  return `[역할과 규칙]
${r.system}

[작업]
${r.prompt}

[진행 방법]
- 웹 검색을 쓸 수 있다면 요금제·기능·출시일 같은 최신 사실을 먼저 확인한 뒤 작성하세요.
- 확인하지 못한 사실은 지어내지 말고 reviewChecklist(있다면)에 "확인 필요"로 남기세요.

[출력 형식 — 매우 중요]
아래 JSON 스키마에 맞는 JSON 하나만 출력하세요. 설명 문장이나 코드블록 표시 없이 JSON 만 출력합니다.
${JSON.stringify(r.schemaJson, null, 1)}`;
}

const TYPE_KO: Record<string, string> = { string: "문자열", number: "숫자", boolean: "true/false", array: "목록([ ])", object: "객체({ })", int: "정수" };

/** 붙여 넣은 결과의 형식 오류를 사람이 읽을 수 있는 한국어로 (어느 항목이 왜 틀렸는지) */
export function formatZodError(e: z.ZodError) {
  const lines = e.issues.slice(0, 10).map((i) => {
    const where = i.path.join(".") || "(전체)";
    const iss = i as { code: string; expected?: string; values?: unknown[]; message: string };
    switch (iss.code) {
      case "invalid_type":
        return /received undefined/.test(iss.message)
          ? `${where}: 항목이 빠졌어요 (${TYPE_KO[iss.expected ?? ""] ?? iss.expected} 필요)`
          : `${where}: ${TYPE_KO[iss.expected ?? ""] ?? iss.expected} 형식이어야 해요`;
      case "too_small":
        return `${where}: 너무 짧거나 개수가 부족해요`;
      case "too_big":
        return `${where}: 너무 길거나 개수가 많아요`;
      case "invalid_value":
        return `${where}: ${(iss.values ?? []).map(String).join(", ")} 중 하나여야 해요`;
      case "unrecognized_keys":
        return `${where}: 스키마에 없는 항목이 있어요`;
      default:
        return `${where}: ${iss.message}`;
    }
  });
  if (e.issues.length > 10) lines.push(`…외 ${e.issues.length - 10}개`);
  return lines.join("\n");
}
