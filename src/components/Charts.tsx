"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { date: string; pageviews: number; clicks: number; impressions: number; revenue: number };

const axis = { fontSize: 11, fill: "var(--text-secondary)" };
const fmt = (n: number) => new Intl.NumberFormat("ko-KR").format(Math.round(n));
const short = (d: string) => d.slice(5).replace("-", "/");

/** 일별 조회수 — 단일 계열 라인 (수익은 별도 차트: 이중 축 금지) */
export function TrafficChart({ data }: { data: Point[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eef0f3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={short} tick={axis} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={fmt} width={64} />
          <Tooltip formatter={(v) => [`${fmt(Number(v))}회`, "조회수"]} labelFormatter={(l) => String(l)} />
          <Line type="monotone" dataKey="pageviews" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RevenueChart({ data }: { data: Point[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eef0f3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={short} tick={axis} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={fmt} width={64} />
          <Tooltip formatter={(v) => [`${fmt(Number(v))}원`, "수익"]} cursor={{ fill: "#f3f4f6" }} />
          <Bar dataKey="revenue" fill="var(--series-3)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SearchChart({ data }: { data: Point[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eef0f3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={short} tick={axis} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={fmt} width={64} />
          <Tooltip formatter={(v) => [`${fmt(Number(v))}회`, "검색 클릭"]} />
          <Line type="monotone" dataKey="clicks" stroke="var(--series-2)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 수익원별 막대 — 값은 막대 옆에 직접 표기 */
export function SourceBars({ rows }: { rows: { label: string; amount: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  if (!rows.length) return <p className="text-sm text-gray-500">수익 데이터가 없습니다.</p>;
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-medium text-gray-700">{r.label}</span>
            <span className="tabular-nums text-gray-600">{fmt(r.amount)}원</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100">
            <div className="h-2 rounded-full" style={{ width: `${(r.amount / max) * 100}%`, background: "var(--series-1)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
