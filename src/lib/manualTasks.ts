import { db } from "./db";
import { buildManualPrompt } from "./llm/manual";
import { JOB_LABEL } from "./labels";

/** 화면에 보여줄 수동 작업 목록 (지시문 포함) */
export async function pendingManualTasks(where: { postId?: string; cardNewsId?: string } = {}) {
  const rows = await db.manualRequest.findMany({ where: { status: "PENDING", ...where }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    jobLabel: JOB_LABEL[r.jobType] ?? r.jobType,
    promptText: buildManualPrompt(r),
    note: r.error,
    createdAt: r.createdAt.toLocaleString("ko-KR"),
    link: r.postId ? { href: `/posts/${r.postId}`, label: "원고 보기" } : r.cardNewsId ? { href: `/cardnews/${r.cardNewsId}`, label: "카드뉴스 보기" } : undefined,
  }));
}
