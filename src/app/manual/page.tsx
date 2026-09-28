import { AutoRefresh } from "@/components/AutoRefresh";
import { ManualTaskCard } from "@/components/ManualTaskCard";
import { Empty, PageHeader } from "@/components/ui";
import { pendingManualTasks } from "@/lib/manualTasks";

export const dynamic = "force-dynamic";

export default async function ManualPage() {
  const tasks = await pendingManualTasks();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="수동 작업함"
        desc="수동 모드(또는 구독 한도 초과 등으로 수동 전환)일 때 AI 가 필요한 작업이 여기 모입니다. 지시문을 데스크탑 Claude 에 붙여 넣고 결과를 붙여 넣으면 나머지(이미지·점검·발행 준비)는 자동으로 이어집니다."
        actions={<AutoRefresh active={false} />}
      />
      {tasks.length === 0 ? <Empty>대기 중인 수동 작업이 없어요.</Empty> : tasks.map((t) => <ManualTaskCard key={t.id} {...t} link={t.link} />)}
    </div>
  );
}
