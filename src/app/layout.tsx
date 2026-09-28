import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { providerLabel } from "@/lib/llm";

export const metadata: Metadata = {
  title: "지원포유 콘텐츠 스튜디오",
  description: "블로그 원고 생성 · 자동 포스팅 · 카드뉴스 · 성과 분석",
};

const NAV = [
  { href: "/", label: "대시보드", icon: "🏠" },
  { href: "/topics", label: "주제 발굴", icon: "🔎" },
  { href: "/posts", label: "원고 · 검수", icon: "📝" },
  { href: "/cardnews", label: "카드뉴스", icon: "🖼️" },
  { href: "/analytics", label: "유입 · 수익 분석", icon: "📈" },
  { href: "/insights", label: "발전 제안", icon: "🧭" },
  { href: "/accounts", label: "계정 관리", icon: "👥" },
  { href: "/affiliates", label: "수익화 상품", icon: "🛍️" },
  { href: "/settings", label: "설정", icon: "⚙️" },
  { href: "/jobs", label: "작업 로그", icon: "🧾" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="flex min-h-screen">
          <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-gray-200 bg-white px-3 py-5 md:flex">
            <Link href="/" className="mb-6 px-2">
              <div className="text-lg font-extrabold text-indigo-700">지원포유</div>
              <div className="text-xs text-gray-500">콘텐츠 스튜디오</div>
            </Link>
            <nav className="flex flex-col gap-0.5">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700">
                  <span className="mr-2">{n.icon}</span>
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto px-2 text-[11px] text-gray-400">글쓰기 AI: {providerLabel()}</div>
          </aside>
          <div className="flex-1">
            <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 bg-white px-3 py-2 md:hidden">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-2 py-1 text-xs text-gray-700">
                  {n.icon} {n.label}
                </Link>
              ))}
            </nav>
            <main className="mx-auto max-w-7xl p-4 md:p-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
