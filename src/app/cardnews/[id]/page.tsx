import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import type { Captions, Slide } from "@/lib/cardnews";
import { ActionButton } from "@/components/ActionButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CaptionEditor, SlideEditor, SocialPublish } from "@/components/CardNewsForms";
import { Badge, PLATFORM } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CardNewsDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await db.cardNews.findUnique({
    where: { id },
    include: { assets: { orderBy: { order: "asc" } }, post: true, socialPosts: { include: { account: true }, orderBy: { createdAt: "desc" } } },
  });
  if (!card) notFound();
  const accounts = await db.account.findMany({ where: { active: true, platform: { in: ["INSTAGRAM", "THREADS", "FACEBOOK"] } }, select: { id: true, name: true, platform: true } });
  const slides = (card.slides ?? []) as Slide[];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/cardnews" className="text-xs text-gray-500">← 카드뉴스 목록</Link>
        <h1 className="mt-2 text-2xl font-bold">{card.title}</h1>
        <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
          {card.post && <Link className="text-indigo-600" href={`/posts/${card.post.id}`}>원고 보기</Link>}
          <AutoRefresh active={card.status === "GENERATING"} />
        </div>
      </div>
      {card.error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{card.error}</div>}

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">슬라이드 ({card.assets.length}장)</h2>
          <div className="flex gap-2">
            <a className="btn-secondary" href={`/api/cardnews/${id}/zip`}>⬇️ ZIP 다운로드 (이미지+캡션)</a>
            <ActionButton url={`/api/cardnews/${id}`} method="PATCH" body={{ regenerate: true }} label="🤖 AI로 다시 만들기" confirm="슬라이드와 캡션을 새로 생성합니다." />
            <ActionButton url={`/api/cardnews/${id}`} method="DELETE" label="삭제" className="btn-danger" confirm="삭제할까요?" redirect="/cardnews" />
          </div>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {card.assets.map((a) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={a.id} src={a.publicUrl ?? ""} alt={a.alt} className="h-80 rounded-xl border shadow-sm" />
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-semibold">슬라이드 문구 편집</h2>
          {slides.length ? <SlideEditor id={id} slides={slides} theme={card.theme} /> : <p className="text-sm text-gray-500">생성 중…</p>}
        </div>
        <div className="flex flex-col gap-5">
          <div className="card">
            <h2 className="mb-3 font-semibold">SNS 발행</h2>
            <SocialPublish id={id} accounts={accounts} />
            {card.socialPosts.length > 0 && (
              <ul className="mt-4 flex flex-col gap-2 text-xs">
                {card.socialPosts.map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <Badge map={PLATFORM} value={s.platform} />
                    <span>{s.account?.name}</span>
                    <span className={s.status === "FAILED" ? "text-red-600" : "text-gray-500"}>{s.status}</span>
                    {s.remoteUrl && <a className="text-indigo-600 underline" href={s.remoteUrl} target="_blank">보기</a>}
                    {s.error && <span className="line-clamp-1 text-red-500">{s.error}</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-gray-400">틱톡·밴드·카카오채널 등은 ZIP 을 내려받아 캡션과 함께 올려 주세요.</p>
          </div>
          <div className="card">
            <h2 className="mb-3 font-semibold">플랫폼별 캡션</h2>
            <CaptionEditor id={id} captions={(card.captions ?? {}) as Partial<Captions>} link={card.post?.remoteUrl ?? ""} />
          </div>
        </div>
      </div>
    </div>
  );
}
