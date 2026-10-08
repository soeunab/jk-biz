import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { enqueue, enqueueOnce } from "@/lib/jobs/queue";
import { createCardNews } from "@/lib/cardnews";
import { getBrand } from "@/lib/brand";
import { currentSimilarity, readManuscript, researchNotesOf } from "@/lib/content/service";
import { alignmentFrom, readinessIssues } from "@/lib/content/readiness";
import { syncRemote } from "@/lib/publishers/remote";
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
  | "unlinkRemote"
  | "syncRemote"
  | "convertRemote";

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
    case "publishPrivate": {
      if (!post.accountId) return fail("발행할 계정을 먼저 지정하세요.");
      if (!(PUBLISH_PRIVATE_ALLOWED as readonly string[]).includes(post.status) || !post.html) return fail("원고가 완성된 뒤에 발행할 수 있어요.");
      // 네이버 발행 버튼은 눌렸는데 주소를 확인 못 한 글 — 이미 올라갔을 수 있어 사람이 정리하기 전까지 다시 올리지 않음
      if (post.remoteId === NAVER_UNCONFIRMED) return fail(NAVER_UNCONFIRMED_MSG);
      // 이미 블로그에 올라간 글을 다시 올리면: 네이버는 글이 하나 더 생기고, 블로거는 블로그에서 고친 내용을 덮어씀 → 먼저 알리고 확인받음
      if (post.remoteId && !post.remoteId.startsWith("demo-") && !force) {
        if (post.platform === "NAVER") {
          return ok({ needsConfirm: true, issues: ["네이버는 다시 올리면 기존 비공개 글은 그대로 두고 글이 하나 더 생겨요. 고칠 내용이 있으면 네이버 편집 화면에서 직접 고치고 [🔄 블로그에서 가져오기]로 반영하는 걸 권해요. 새 글로 다시 올리려면 기존 비공개 글은 네이버에서 직접 지워 주세요."] });
        }
        const diff = await syncRemote(id).catch(() => null);
        if (diff?.edited) {
          return ok({
            needsConfirm: true,
            issues: [`블로거에서 고친 내용이 있어요 (본문 유사도 ${diff.similarity != null ? Math.round(diff.similarity * 100) + "%" : "–"}, 사진 ${diff.baseImages ?? "?"} → ${diff.images}장${diff.titleChanged ? ", 제목 변경" : ""}). 다시 올리면 블로거에서 고친 내용이 스튜디오 원고로 덮어써져 사라져요.`],
          });
        }
      }
      // 네이버 새 글로 다시 올리기를 확인받았으면 기존 글과의 연결을 끊고 올림 (발행 함수는 연결된 글이 있으면 멈춤 — 중복 클릭 방지)
      if (force && post.platform === "NAVER" && post.remoteId && !post.remoteId.startsWith("demo-")) {
        await db.post.update({ where: { id }, data: { remoteId: null, remoteUrl: null } });
      }
      return ok({ jobId: (await enqueueOnce("post.publishPrivate", { postId: id })).id });
    }
    case "syncRemote":
      if (!post.remoteId && !post.remoteUrl) return fail("아직 블로그에 올라가지 않은 글이에요.");
      return ok({ jobId: (await enqueueOnce("post.syncRemote", { postId: id })).id });
    case "convertRemote":
      if (!post.remoteId && !post.remoteUrl) return fail("블로그 글 주소가 없어요.");
      // 블로그 글은 바꾸지 않고 스튜디오 원고만 만듦 — 공개된 글도 가능, 생성 중일 때만 막음
      if (post.status === "GENERATING") return fail(editLockedMessage(post.status));
      return ok({ jobId: (await enqueueOnce("post.convertRemote", { postId: id })).id });
    case "approve": {
      if (post.status !== "PRIVATE") return fail("비공개 발행(검수 대기) 상태에서만 승인할 수 있어요.");
      const m = readManuscript(post.content);
      // 저장된 값이 아니라 지금 다시 계산 — 같은 주제를 다른 계정에 만든 글이 나중에 끝났을 수 있음
      const sim = m ? await currentSimilarity(id, post.platform, m) : undefined;
      const issues = m ? readinessIssues(m, { brand: await getBrand(), similarity: sim, renderedHtml: post.html, researchNotes: researchNotesOf(post.research), republish: (post.seoReport as { republish?: null | { sourceTitle: string; sourceUrl: string | null; similarity: number; warn: boolean } } | null)?.republish ?? null, accountConcept: post.account ? post.account.concept : undefined, alignment: alignmentFrom(post.aiReview) }) : [];
      // 확인 사유가 있으면 한 번 알려 주고, 검수자가 확인한 뒤(force) 승인
      if (issues.length && !force) return ok({ needsConfirm: true, issues: issues.map((i) => i.message) });
      await db.post.update({ where: { id }, data: { status: "APPROVED", reviewerNote: issues.length ? `${post.reviewerNote}\n[승인 시 확인한 사유] ${issues.map((i) => i.message).join(" / ")}`.trim() : post.reviewerNote } });
      // 승인 시점의 블로그 본문을 뒤에서 가져와 둠 (비공개 발행 뒤 블로그에서 고친 내용 반영) — 승인을 기다리게 하지 않음
      if (post.remoteId && !post.remoteId.startsWith("demo-")) await enqueue("post.syncRemote", { postId: id });
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

