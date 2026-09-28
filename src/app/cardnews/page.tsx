import Link from "next/link";
import { db } from "@/lib/db";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CreateCardNews } from "@/components/CardNewsForms";
import { Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CardNewsList() {
  const [cards, posts] = await Promise.all([
    db.cardNews.findMany({ include: { assets: { orderBy: { order: "asc" }, take: 1 }, socialPosts: true }, orderBy: { createdAt: "desc" } }),
    db.post.findMany({ where: { status: { not: "GENERATING" }, html: { not: "" } }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: 50 }),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="카드뉴스" desc="블로그 원고를 인스타그램·스레드·페이스북용 카드뉴스(1080×1350)와 캡션으로 변환합니다." actions={<AutoRefresh active={cards.some((c) => c.status === "GENERATING")} />} />
      <CreateCardNews posts={posts} />
      {cards.length === 0 ? (
        <Empty>아직 카드뉴스가 없어요.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => (
            <Link key={c.id} href={`/cardnews/${c.id}`} className="card p-0 overflow-hidden hover:shadow-md">
              {c.assets[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.assets[0].publicUrl ?? ""} alt={c.title} className="aspect-[4/5] w-full object-cover" />
              ) : (
                <div className="flex aspect-[4/5] items-center justify-center bg-gray-100 text-sm text-gray-500">{c.status === "GENERATING" ? "생성 중…" : c.status}</div>
              )}
              <div className="p-3">
                <div className="line-clamp-2 text-sm font-medium">{c.title}</div>
                <div className="mt-1 text-xs text-gray-500">{c.socialPosts.filter((s) => s.status === "PUBLISHED").length}개 채널 발행</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
