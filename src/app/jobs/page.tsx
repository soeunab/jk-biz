import { db } from "@/lib/db";
import { ActionButton } from "@/components/ActionButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PageHeader } from "@/components/ui";
import { JOB_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { QUEUED: "⏳ 대기", RUNNING: "🔄 실행 중", DONE: "✅ 완료", FAILED: "❌ 실패" };

export default async function JobsPage() {
  const jobs = await db.job.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const active = jobs.some((j) => j.status === "QUEUED" || j.status === "RUNNING");
  const stuck = jobs.some((j) => j.status === "QUEUED" && j.createdAt < new Date(Date.now() - 60_000));
  return (
    <div>
      <PageHeader title="작업 로그" desc="원고 생성·발행·분석 등 백그라운드 작업 현황" actions={<AutoRefresh active={active} />} />
      {stuck && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          1분 넘게 대기 중인 작업이 있어요. 워커가 실행 중인지 확인하세요: <code>npm run worker</code> (또는 <code>npm run dev</code>)
        </div>
      )}
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>작업</th><th>상태</th><th>진행</th><th>시작</th><th>로그</th><th></th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td className="whitespace-nowrap">{JOB_LABEL[j.type] ?? j.type}</td>
                <td className="whitespace-nowrap">{STATUS[j.status] ?? j.status}</td>
                <td className="tabular-nums">{j.progress}%</td>
                <td className="whitespace-nowrap text-xs text-gray-500">{j.createdAt.toLocaleString("ko-KR")}</td>
                <td className="max-w-xl">
                  <details>
                    <summary className="cursor-pointer text-xs text-gray-600">{j.error ? <span className="text-red-600">{j.error.split("\n")[0].slice(0, 120)}</span> : (j.log.trim().split("\n").pop() ?? "")}</summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded bg-gray-50 p-2 text-[11px] whitespace-pre-wrap">{j.log}{j.error ? `\n\n${j.error}` : ""}</pre>
                  </details>
                </td>
                <td>{j.status === "FAILED" && <ActionButton url={`/api/jobs/${j.id}/retry`} label="재시도" className="btn-secondary text-xs" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
