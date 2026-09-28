import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hasNaverSession } from "@/lib/publishers/naver";
import { ActionButton } from "@/components/ActionButton";
import { AccountSettingsForm, AddAccount } from "@/components/AccountForms";
import { Badge, PageHeader, PLATFORM } from "@/components/ui";
import { asObject } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connected?: string }> }) {
  const sp = await searchParams;
  const accounts = await db.account.findMany({ orderBy: [{ platform: "asc" }, { createdAt: "asc" }], include: { _count: { select: { posts: true } } } });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="계정 관리" desc="구글 블로거·네이버 블로그를 여러 개 운영할 수 있어요. 계정마다 콘셉트를 다르게 두면 같은 주제도 다른 관점으로 작성됩니다." />
      {sp.connected && <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">✅ 구글 계정이 연결되었습니다.</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {accounts.map((a) => {
          const s = asObject<Record<string, string | boolean>>(a.settings, {});
          const connected = a.platform === "NAVER" ? hasNaverSession(a.id) : !!a.credentials;
          return (
            <div key={a.id} className={`card ${a.active ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge map={PLATFORM} value={a.platform} />
                    {s.demo ? <span className="badge bg-amber-50 text-amber-700">데모</span> : connected ? <span className="badge bg-emerald-50 text-emerald-700">연결됨</span> : <span className="badge bg-red-50 text-red-600">연결 필요</span>}
                  </div>
                  <div className="mt-1 font-semibold">{a.name}</div>
                  <div className="text-xs text-gray-500">{a.externalId ?? "ID 미설정"} · 원고 {a._count.posts}개 {a.url && <>· <a className="underline" href={a.url} target="_blank">{a.url}</a></>}</div>
                  {a.concept && <div className="mt-1 text-xs text-gray-600">콘셉트: {a.concept}</div>}
                  <div className="mt-1 font-mono text-[10px] text-gray-400">계정ID: {a.id}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {a.platform === "BLOGGER" && !s.demo && (
                    env.google ? <a className="btn-primary text-xs" href={`/api/oauth/google/start?accountId=${a.id}`}>{connected ? "구글 재연결" : "구글 연결"}</a> : <span className="text-[11px] text-red-500">GOOGLE_CLIENT_ID 필요</span>
                  )}
                  <ActionButton url={`/api/accounts/${a.id}`} method="PATCH" body={{ active: !a.active }} label={a.active ? "비활성화" : "활성화"} className="btn-secondary text-xs" />
                  <ActionButton url={`/api/accounts/${a.id}`} method="DELETE" label="삭제" className="btn-danger text-xs" confirm="계정을 삭제할까요? (원고는 남습니다)" />
                </div>
              </div>
              {a.platform === "NAVER" && !s.demo && (
                <div className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                  네이버는 글쓰기 API 가 없어 브라우저 자동화를 씁니다. 서버 PC 터미널에서 한 번 로그인하세요:
                  <pre className="mt-1 rounded bg-gray-900 p-2 text-gray-100">npm run naver:login -- {a.id}</pre>
                  {connected ? "✅ 로그인 세션 저장됨" : "⚠️ 로그인 세션 없음"}
                </div>
              )}
              <AccountSettingsForm id={a.id} platform={a.platform} concept={a.concept} externalId={a.externalId ?? ""} url={a.url ?? ""} settings={s as Record<string, string>} />
            </div>
          );
        })}
      </div>
      <AddAccount />
    </div>
  );
}
