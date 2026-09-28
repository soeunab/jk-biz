import { getBrand } from "@/lib/brand";
import { integrationStatus, env } from "@/lib/env";
import { providerLabel } from "@/lib/llm";
import { BrandForm } from "@/components/SettingsForms";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const brand = await getBrand();
  const status = integrationStatus();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="설정" desc="연동 상태 확인과 브랜드(블로그 주제·문체) 설정" />
      <div className="card">
        <h2 className="mb-1 font-semibold">연동 상태</h2>
        <p className="mb-3 text-xs text-gray-500">API 키는 서버의 <code>.env</code> 파일에서 설정합니다 (보안상 화면에서 입력하지 않음). 현재 글쓰기 AI: <b>{providerLabel()}</b> · 공개 주소: {env.publicBaseUrl}</p>
        <ul className="grid gap-2 md:grid-cols-2">
          {status.map((s) => (
            <li key={s.key} className="flex items-start gap-2 rounded-lg border p-3 text-sm">
              <span>{s.ok ? "✅" : "⬜"}</span>
              <div><div className="font-medium">{s.label}</div><div className="text-xs text-gray-500">{s.hint}</div></div>
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h2 className="mb-3 font-semibold">브랜드 · 원고 기준</h2>
        <BrandForm brand={brand} />
      </div>
    </div>
  );
}
