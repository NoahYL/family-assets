import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { BucketItem } from "../lib/types";
import { fmtCompactCNY } from "../lib/format";

const COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#64748b",
];

export function AssetPie({
  data,
  height = 220,
}: {
  data: BucketItem[];
  height?: number;
}) {
  const total = data.reduce((s, it) => s + it.value, 0);
  if (total <= 0 || data.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-xs text-slate-400"
      >
        暂无数据
      </div>
    );
  }
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={1}
          >
            {data.map((_, idx) => (
              <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: number, _n, p: any) => {
              const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
              return [`${fmtCompactCNY(v)} (${pct}%)`, p.payload.label];
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PieLegend({ data }: { data: BucketItem[] }) {
  const total = data.reduce((s, it) => s + it.value, 0);
  return (
    <ul className="space-y-1.5">
      {data.map((it, idx) => {
        const pct = total > 0 ? (it.value / total) * 100 : 0;
        return (
          <li key={it.key} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ background: COLORS[idx % COLORS.length] }}
            />
            <span className="flex-1 text-slate-700 truncate">{it.label}</span>
            <span className="text-slate-500 tabular-nums">{pct.toFixed(1)}%</span>
            <span className="text-slate-900 tabular-nums w-20 text-right">
              {fmtCompactCNY(it.value)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
