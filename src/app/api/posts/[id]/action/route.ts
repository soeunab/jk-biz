import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { enqueue, enqueueOnce } from "@/lib/jobs/queue";
import { createCardNews } from "@/lib/cardnews";
import { getBrand } from "@/lib/brand";
import { currentSimilarity, readManuscript, researchNotesOf } from "@/lib/content/service";
import { readinessIssues } from "@/lib/content/readiness";
import {
  canRegenerate,
  editLockedMessage,
  isEditLocked,
  canMarkPublished,
  NAVER_UNCONFIRMED,
  NAVER_UNCONFIRMED_MSG,
  PUBLISH_PRIVATE_ALLOWED,
  REGENERATE_BLOCKED_MSG,
  UNLINK_ALLOWED,
} from "@/lib/content/postStatus";

type Action =
  | "regenerate"
  | "images"
  | "publishPrivate"
  | "approve"
  | "publishPublic"
  | "markPublished"
  | "cardnews"
  | "unapprove"
  | "reject"
  | "reopen"
  | "unlinkRemote";

/**
 * 원고 워크플로
 * DRAFT → (publishPrivate) → PRIVATE[검수 대기] → (approve) → APPROVED → (publishPublic) → PUBLISHED
 *                                    └─ (reject) → REJECTED[반려] → (reopen) → DRAFT
 * 모든 상태 전환은 사람이 버튼으로 명시적으로 호출할 때만 일어납니다.
 */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = (await params).id;
  const { action, url, force, reason, userSources } = (await req.json()) as { action: Action; url?: string; force?: boolean; reason?: string; userSources?: unknown };
  const post = await db.post.findUniqueOrThrow({ where: { id }, include: { account: true } });

  switch (action) {
    case "regenerate": {
      // 공개·승인된 글을 다시 쓰면 블로그 글과 프로그램 원고가 어긋나고, 다음 발행 때 라이브 글을 덮어쓸 수 있음
      if (!canRegenerate(post.status)) return fail(REGENERATE_BLOCKED_MSG);
      // 📎 내 자료로 다시 쓰기 — 자료는 원고의 조사 기록(research.user)에 저장해 이번·다음 재생성과 AI 검수가 근거로 씀
      let research: Prisma.InputJsonValue | undefined;
      if (userSources !== undefined) {
        const parsed = UserSourcesInput.safeParse(userSources);
        if (!parsed.success) return fail(`자료 형식 오류: ${parsed.error.issues[0]?.message ?? ""}`);
        const { notes, urls, mode } = parsed.data;
        const rest = { ...((post.research && typeof post.research === "object" ? post.research : {}) as Record<string, unknown>) };
        delete rest.user;
        research = (notes.trim() || urls.length ? { ...rest, user: { notes: notes.trim(), urls, mode, at: new Date().toISOString() } } : rest) as Prisma.InputJsonValue;
      }
      await db.post.update({ where: { id }, data: { status: "GENERATING", error: null, ...(research !== undefined ? { research } : {}) } });
      return ok({ jobId: (await enqueueOnce("post.generate", { postId: id })).id });
    }
    case "images":
      if (isEditLocked(post.status)) return fail(editLockedMessage(post.status));
      return ok({ jobId: (await enqueueOnce("post.images", { postId: id })).id });
    case "publishPrivate":
      if (!post.accountId) return fail("발행할 계정을 먼저 지정하세요.");
      if (!(PUBLISH_PRIVATE_ALLOWED as readonly string[]).includes(post.status) || !post.html) return fail("원고가 완성된 뒤에 발행할 수 있어요.");
      // 네이버는 다시 올리면 새 글이 하나 더 생김 — 이미 올라간 글이 있으면 막고 안내
      if (post.platform === "NAVER" && post.remoteId) return fail(naverAlreadyUploadedMsg(post.remoteId));
      return ok({ jobId: (await enqueueOnce("post.publishPrivate", { postId: id })).id });
    case "approve": {
      if (post.status !== "PRIVATE") return fail("비공개 발행(검수 대기) 상태에서만 승인할 수 있어요.");
      const m = readManuscript(post.content);
      // 저장된 값이 아니라 지금 다시 계산 — 같은 주제를 다른 계정에 만든 글이 나중에 끝났을 수 있음
      const sim = m ? await currentSimilarity(id, post.platform, m) : undefined;
      const issues = m ? readinessIssues(m, { brand: await getBrand(), similarity: sim, renderedHtml: post.html, researchNotes: researchNotesOf(post.research), republish: (post.seoReport as { republish?: null | { sourceTitle: string; sourceUrl: string | null; similarity: number; warn: boolean } } | null)?.republish ?? null, accountConcept: post.account ? post.account.concept : undefined }) : [];
      // 확인 사유가 있으면 한 번 알려 주고, 검수자가 확인한 뒤(force) 승인
      if (issues.length && !force) return ok({ needsConfirm: true, issues: issues.map((i) => i.message) });
      await db.post.update({ where: { id }, data: { status: "APPROVED", reviewerNote: issues.length ? `${post.reviewerNote}\n[승인 시 확인한 사유] ${issues.map((i) => i.message).join(" / ")}`.trim() : post.reviewerNote } });
      return ok();
    }
    case "reject":
      if (!["PRIVATE", "APPROVED", "DRAFT"].includes(post.status)) return fail("검수 중인 원고만 반려할 수 있어요.");
      await db.post.update({ where: { id }, data: { status: "REJECTED", reviewerNote: `${post.reviewerNote}\n[반려] ${reason ?? ""}`.trim() } });
      return ok();
    case "reopen":
      if (post.status !== "REJECTED") return fail("반려된 원고만 다시 열 수 있어요.");
      await db.post.update({ where: { id }, data: { status: "DRAFT" } });
      return ok();
    case "unapprove":
      if (post.status !== "APPROVED") return fail("승인된 원고만 승인을 취소할 수 있어요.");
      await db.post.update({ where: { id }, data: { status: "PRIVATE" } });
      return ok();
    case "publishPublic":
      if (post.status !== "APPROVED") return fail("사람 검수(승인) 후에만 공개 발행할 수 있어요.");
      return ok({ jobId: (await enqueueOnce("post.publishPublic", { postId: id })).id });
    case "markPublished":
      // 네이버 등에서 사람이 직접 공개한 경우
      if (!canMarkPublished(post)) return fail("비공개 발행(검수 대기)이나 승인 상태의 원고만 '직접 발행함'으로 표시할 수 있어요.");
      await db.post.update({
        where: { id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          remoteUrl: url?.trim() || post.remoteUrl,
          // 확인 불가 표시는 실제 글 번호가 아니므로 지움 (주소에 logNo 가 있으면 그걸로)
          ...(post.remoteId === NAVER_UNCONFIRMED ? { remoteId: url?.match(/(?:\/|logNo=)(\d{6,})/)?.[1] ?? null } : {}),
          error: null,
        },
      });
      return ok();
    case "unlinkRemote":
      // 네이버에서 글을 지운 뒤(또는 업로드가 실패해 글이 없을 때) 프로그램 쪽 연결만 끊어 다시 올릴 수 있게 함
      if (!(UNLINK_ALLOWED as readonly string[]).includes(post.status)) return fail("비공개·초안·실패 상태의 원고만 연결을 해제할 수 있어요.");
      await db.post.update({ where: { id }, data: { remoteId: null, remoteUrl: null, status: "DRAFT", error: null } });
      return ok();
    case "cardnews": {
      const card = await createCardNews({ postId: id });
      const job = await enqueue("cardnews.generate", { cardNewsId: card.id });
      return ok({ jobId: job.id, redirect: `/cardnews/${card.id}` });
    }
    default:
      return fail("알 수 없는 작업");
  }
});

/** 사용자 제공 자료 — 서버는 URL 을 직접 내려받지 않음(조사 단계 AI 가 읽음) */
const UserSourcesInput = z.object({
  notes: z.string().max(30_000, "자료 텍스트는 30,000자까지 넣을 수 있어요."),
  urls: z
    .array(z.string().trim().url("URL 형식이 올바르지 않아요.").refine((u) => /^https?:\/\//i.test(u), "http(s) 주소만 넣을 수 있어요."))
    .max(10, "참고 URL 은 10개까지 넣을 수 있어요."),
  mode: z.enum(["prefer", "only"]),
});

function naverAlreadyUploadedMsg(logNo: string) {
  if (logNo === NAVER_UNCONFIRMED) return NAVER_UNCONFIRMED_MSG;
  return `이미 네이버에 올라간 글이 있어요(logNo=${logNo}). 네이버에서 직접 수정하거나, 네이버에서 그 글을 삭제한 뒤 [네이버 연결 해제]를 누르고 다시 올리세요.`;
}
