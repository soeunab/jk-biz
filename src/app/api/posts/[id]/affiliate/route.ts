import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { readManuscript, rerenderPost } from "@/lib/content/service";
import { PROGRAM_DISCLOSURE, PROGRAM_LINK_LABEL, getBrand } from "@/lib/brand";
import { escapeHtml } from "@/lib/util";

/** 원고를 직접 고칠 수 있는 상태 — 승인·공개된 글은 자동으로 바꾸지 않고 붙여 넣을 문단만 만들어 줌 */
const EDITABLE = ["DRAFT", "PRIVATE", "FAILED", "REJECTED"];

/**
 * 기존 원고에 제휴 상품 추가 (최대 2개 — 광고·상품이 많으면 체류시간이 줄어듦).
 * 검수 전 원고는 원고에 넣고 다시 렌더링, 승인·공개된 글은 복사해 붙일 문단(고지 문구 포함)만 돌려줍니다.
 */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = (await params).id;
  const { productId, afterSection, sentence, anchorText } = (await req.json()) as { productId: string; afterSection: number; sentence: string; anchorText?: string };
  const post = await db.post.findUniqueOrThrow({ where: { id } });
  const m = readManuscript(post.content);
  if (!m) return fail("원고가 없어요.");
  const product = await db.affiliateProduct.findUnique({ where: { id: productId } });
  if (!product) return fail("상품을 찾지 못했어요.");
  if (!sentence?.trim()) return fail("상품을 소개하는 문장을 적어 주세요 (글 흐름에 맞게, 광고성 문구 남발 금지).");
  const at = Math.min(Math.max(1, Math.round(afterSection) || 1), m.sections.length);

  if (!EDITABLE.includes(post.status)) {
    const brand = await getBrand();
    const disclosure = PROGRAM_DISCLOSURE[product.program] ?? brand.disclosure.affiliate;
    const label = PROGRAM_LINK_LABEL[product.program] ?? "제휴 링크";
    const anchor = anchorText?.trim() || product.name;
    const snippet =
      post.platform === "BLOGGER"
        ? `<p class="jw-legend">※ ${escapeHtml(disclosure)}</p>\n<div class="jw-note"><p>${escapeHtml(sentence)}</p><p><a class="jw-ilink" href="${escapeHtml(product.url)}" target="_blank" rel="sponsored noopener">👉 ${escapeHtml(anchor)}</a> <small>(${label})</small></p></div>`
        : `※ ${disclosure}\n\n${sentence}\n👉 ${anchor} (${label})\n${product.url}`;
    return ok({
      snippet,
      note: `승인·공개된 글은 자동으로 고치지 않아요. 고지 문구는 글 맨 위에, 상품 문단은 "${m.sections[at - 1].heading}" 섹션 끝에 직접 붙여 넣으세요.`,
    });
  }

  const others = m.affiliate.filter((a) => a.productId !== productId);
  if (others.length >= 2) return fail("상품은 글당 최대 2개까지예요 — 광고·상품이 많으면 독자가 빨리 떠나요. 기존 상품을 원고 편집에서 빼고 다시 시도하세요.");
  m.affiliate = [...others, { productId, afterSection: at, sentence: sentence.trim(), anchorText: anchorText?.trim() || product.name }];
  await db.post.update({ where: { id }, data: { content: m as unknown as Prisma.InputJsonValue } });
  await rerenderPost(id);
  return ok({
    note: post.status === "PRIVATE" ? "원고에 넣었어요. 이미 비공개 발행된 글이라 [비공개 발행]을 다시 눌러야 블로그에 반영돼요." : "원고에 넣고 다시 렌더링했어요.",
  });
});
