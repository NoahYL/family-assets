import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../lib/api";
import type { Snapshot } from "../lib/types";
import { Card, EmptyState } from "../components/ui";
import { fmtCNY, fmtCompactCNY } from "../lib/format";

export default function Trend() {
  const [snaps, setSnaps] = useState<Snapshot[]>([]);

  async function load() {
    setSnaps(await api.listSnapshots(180));
  }

  useEffect(() => {
    load();
  }, []);

  const data = useMemo(
    () =>
      snaps.map((s) => ({
        at: s.snapshot_at.slice(5, 16),
        total: s.total_cny,
      })),
    [snaps],
  );

  const latest = snaps.length ? snaps[snaps.length - 1].total_cny : 0;
  const first = snaps.length ? snaps[0].total_cny : 0;
  const delta = latest - first;
  const deltaPct = first > 0 ? (delta / first) * 100 : 0;

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">资产趋势</h1>
        <p className="text-sm text-slate-500 mt-1">
          每次点击"刷新行情"都会留下一个快照，这里看走势
        </p>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <Card title="最新">
          <div className="text-2xl font-semibold tabular-nums">
            {fmtCompactCNY(latest)}
          </div>
        </Card>
        <Card title="期初">
          <div className="text-2xl font-semibold tabular-nums">
            {fmtCompactCNY(first)}
          </div>
        </Card>
        <Card title="区间变化">
          <div
            className={`text-2xl font-semibold tabular-nums ${
              delta >= 0 ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {fmtCompactCNY(delta)}
            <span className="text-sm ml-2">
              ({deltaPct >= 0 ? "+" : ""}
              {deltaPct.toFixed(2)}%)
            </span>
          </div>
        </Card>
      </div>

      <Card title={`走势图（${snaps.length} 个快照）`}>
        {snaps.length === 0 ? (
          <EmptyState
            title="还没有快照"
            hint="去总览页点一次「刷新行情」即可生成第一个快照"
          />
        ) : (
          <div style={{ height: 360 }}>
            <ResponsiveContainer>
              <LineChart data={data} margin={{ left: 10, right: 20, top: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="at"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickMargin={6}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickFormatter={(v) => fmtCompactCNY(v)}
                  width={80}
                />
                <Tooltip
                  formatter={(v: number) => fmtCNY(v)}
                  labelStyle={{ fontSize: 12 }}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}
