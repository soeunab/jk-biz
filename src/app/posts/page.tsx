import Link from "next/link";
import { db } from "@/lib/db";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Badge, Empty, PageHeader, PLATFORM, POST_STATUS, ScoreBar } from "@/components/ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["ALL", "전체"],
  ["GENERATING", "생성 중"],
  ["DRAFT", "원고 완료"],
  ["PRIVATE", "검수 대기"],
  ["APPROVED", "승인됨"],
  ["PUBLISHED", "발행 완료"],
  ["FAILED", "실패"],
];

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ status?: string; account?: string }> }) {
  const sp = await searchParams;
  const status = sp.status ?? "ALL";
  const accounts = await db.account.findMany({ where: { platform: { in: ["BLOGGER", "NAVER"] } } });
  const posts = await db.post.findMany({
    where: { ...(status !== "ALL" ? { status } : {}), ...(sp.account ? { accountId: sp.account } : {}) },
    include: { account: true, _count: { select: { assets: true, cardNews: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const generating = posts.some((p) => p.status === "GENERATING");

  return (
    <div>
      <PageHeader title="원고 · 검수" desc="AI가 만든 원고를 검수하고 비공개 발행 → 승인 → 공개 발행합니다." actions={<AutoRefresh active={generating} />} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {FILTERS.map(([k, l]) => (
          <Link key={k} href={`/posts?status=${k}${sp.account ? `&account=${sp.account}` : ""}`} className={`rounded-lg px-3 py-1.5 ${status === k ? "bg-indigo-600 text-white" : "border bg-white text-gray-700"}`}>{l}</Link>
        ))}
        <span className="mx-2 text-gray-300">|</span>
        <Link href={`/posts?status=${status}`} className={`rounded-lg px-3 py-1.5 ${!sp.account ? "bg-gray-800 text-white" : "border bg-white"}`}>모든 계정</Link>
        {accounts.map((a) => (
          <Link key={a.id} href={`/posts?status=${status}&account=${a.id}`} className={`rounded-lg px-3 py-1.5 ${sp.account === a.id ? "bg-gray-800 text-white" : "border bg-white"}`}>{a.name}</Link>
        ))}
      </div>
      {posts.length === 0 ? (
        <Empty>원고가 없습니다. [주제 발굴]에서 원고를 생성해 보세요.</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>원고</th><th>플랫폼 · 계정</th><th>상태</th><th>SEO</th><th>이미지</th><th>수정</th></tr></thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="max-w-md">
                    <Link href={`/posts/${p.id}`} className="font-medium hover:text-indigo-700">{p.title || p.focusKeyword}</Link>
                    <div className="text-xs text-gray-500">{p.focusKeyword}{p._count.cardNews ? " · 🖼️ 카드뉴스" : ""}</div>
                    {p.error && <div className="mt-1 line-clamp-1 text-xs text-red-600">{p.error}</div>}
                  </td>
                  <td><Badge map={PLATFORM} value={p.platform} /><div className="mt-1 text-xs text-gray-500">{p.account?.name ?? "계정 미지정"}</div></td>
                  <td><Badge map={POST_STATUS} value={p.status} /></td>
                  <td><ScoreBar value={p.seoScore} /></td>
                  <td className="text-xs">{p._count.assets}장</td>
                  <td className="whitespace-nowrap text-xs text-gray-500">{p.updatedAt.toLocaleString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
