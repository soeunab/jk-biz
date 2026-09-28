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
      <div className="card text-sm">
        <h2 className="mb-2 font-semibold">원고 안전장치 (자동 점검)</h2>
        <ul className="list-disc space-y-1 pl-5 text-gray-600">
          <li><b>투자·재테크(INVEST)</b>: 주식·종목·실적발표·배당·공시·목표주가 등이 제목·소제목에 있으면 &quot;투자 권유 아님·책임은 본인&quot; 고지가 발행될 글에 실제로 들어갔는지, 예측·매수 추천이나 FAQ의 매수·매도 판단이 없는지 점검해요.</li>
          <li><b>시제 모순 점검</b>: 이미 지난 날짜나, 원고 작성 때 조사한 메모에 &quot;출시됐다&quot;고 나온 대상을 &quot;출시 예정&quot;으로 쓴 문장을 찾아요.</li>
          <li><b>고위험 주제</b>: 세무·정부지원·청약·금융·법률·건강 주제는 공식 출처 필수, 고지 문구 자동 삽입.</li>
          <li><b>재발행</b>: 원본과 너무 비슷하면(35% 이상) 경고하고, 원본 링크를 백링크로 자동 삽입해요.</li>
        </ul>
        <p className="mt-2 text-xs text-gray-400">점검은 판단을 돕는 용도이며, 승인 여부는 검수자가 결정합니다. 자세한 내용은 사용 가이드를 참고하세요.</p>
      </div>
      <div className="card">
        <h2 className="mb-3 font-semibold">브랜드 · 원고 기준</h2>
        <BrandForm brand={brand} />
      </div>
    </div>
  );
}
