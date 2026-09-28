import { db } from "@/lib/db";
import { ActionButton } from "@/components/ActionButton";
import { AffiliateForm } from "@/components/SettingsForms";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const PROGRAM: Record<string, string> = { SHOPPING_CONNECT: "쇼핑커넥트", COUPANG: "쿠팡파트너스", OTHER: "기타" };

export default async function AffiliatesPage() {
  const items = await db.affiliateProduct.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="수익화 상품" desc="등록한 제휴 상품은 원고 생성 시 주제와 태그가 맞을 때만 자연스럽게 1~2개 추천되고, 대가성 문구가 자동으로 붙습니다." />
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>프로그램</th><th>상품</th><th>태그</th><th>플랫폼</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>{PROGRAM[p.program] ?? p.program}</td>
                <td className="max-w-sm"><div className="font-medium">{p.name}</div><a href={p.url} target="_blank" className="line-clamp-1 text-xs text-indigo-600">{p.url}</a>{p.note && <div className="text-xs text-amber-600">{p.note}</div>}</td>
                <td className="text-xs">{p.tags}</td>
                <td className="text-xs">{p.platform}</td>
                <td>{p.active ? "사용" : "중지"}</td>
                <td className="whitespace-nowrap">
                  <ActionButton url={`/api/affiliates/${p.id}`} method="PATCH" body={{ active: !p.active }} label={p.active ? "중지" : "사용"} className="btn-secondary text-xs" />{" "}
                  <ActionButton url={`/api/affiliates/${p.id}`} method="DELETE" label="삭제" className="btn-danger text-xs" confirm="삭제할까요?" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AffiliateForm />
      <div className="card text-sm text-gray-600">
        <h3 className="mb-2 font-semibold text-gray-800">수익화 체크 포인트</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>애드센스(블로거)</b>: [계정 관리]에서 게시자 ID·인아티클 슬롯을 넣으면 도입부 뒤와 본문 중간에 광고가 삽입됩니다. 자동광고만 쓸 경우 비워 두세요.</li>
          <li><b>애드포스트(네이버)</b>: 네이버가 본문에 자동 노출하므로 별도 설정이 필요 없습니다. 수익은 CSV/직접 입력으로 반영하세요.</li>
          <li><b>쇼핑커넥트</b>: 공정위 지침에 따라 글 상단에 대가성 문구가 자동 표기됩니다. 과도한 상품 나열은 저품질 위험이 있어 최대 2개로 제한합니다.</li>
        </ul>
      </div>
    </div>
  );
}
