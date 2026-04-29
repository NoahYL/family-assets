import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../lib/api";
import type { Goal, HoldingView, Snapshot } from "../lib/types";
import { Button, Card, EmptyState } from "../components/ui";
import { assetClassLabel, fmtCNY, fmtCompactCNY, fmtPct } from "../lib/format";
import {
  bucketHoldings,
  bucketInflows,
  monthsBetween,
  projectBuckets,
} from "../lib/goalMath";

type Range = "7d" | "30d" | "90d" | "1y" | "all";
type View = "total" | "stack" | "mom";

const rangeOptions: { key: Range; label: string; days: number | null }[] = [
  { key: "7d", label: "近 7 日", days: 7 },
  { key: "30d", label: "近 30 日", days: 30 },
  { key: "90d", label: "近 90 日", days: 90 },
  { key: "1y", label: "近 1 年", days: 365 },
  { key: "all", label: "全部", days: null },
];

const viewOptions: { key: View; label: string }[] = [
  { key: "total", label: "总额走势" },
  { key: "stack", label: "按类别堆叠" },
  { key: "mom", label: "环比变化" },
];

/** 资产类别调色盘（和总览饼图保持一致感） */
const CLASS_COLORS: Record<string, string> = {
  cash: "#64748b",
  stock: "#2563eb",
  fund: "#0ea5e9",
  bond: "#14b8a6",
  gold: "#f59e0b",
  realestate: "#8b5cf6",
  insurance: "#ec4899",
  option: "#f43f5e",
  loan: "#dc2626",
  other: "#94a3b8",
};

function parseBuckets(json: string): Record<string, number> {
  try {
    const obj = JSON.parse(json);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    return {};
  } catch {
    return {};
  }
}

export default function Trend() {
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [holdings, setHoldings] = useState<HoldingView[]>([]);
  const [range, setRange] = useState<Range>("30d");
  const [view, setView] = useState<View>("total");

  async function load() {
    // 拉 2 年上限；按天一点，一般够看
    const [ss, gs, hs] = await Promise.all([
      api.listSnapshots(730),
      api.listGoals(),
      api.listHoldings(),
    ]);
    setSnaps(ss);
    setGoal(gs[0] ?? null);
    setHoldings(hs);
  }
  useEffect(() => {
    load();
  }, []);

  /** 按时间正序（后端给的可能是倒序）*/
  const ordered = useMemo(
    () =>
      [...snaps].sort((a, b) =>
        a.snapshot_at.localeCompare(b.snapshot_at),
      ),
    [snaps],
  );

  /** 按所选时间段筛选（按天数计） */
  const filtered = useMemo(() => {
    const days = rangeOptions.find((r) => r.key === range)?.days ?? null;
    if (days == null) return ordered;
    return ordered.slice(-days);
  }, [ordered, range]);

  /** 所有曾出现过的资产类别（用于堆叠图的 Area 列） */
  const allClasses = useMemo(() => {
    const s = new Set<string>();
    for (const snap of filtered) {
      const obj = parseBuckets(snap.total_by_class_json);
      for (const k of Object.keys(obj)) s.add(k);
    }
    // 按预期重要性排序
    const order = [
      "cash",
      "stock",
      "fund",
      "bond",
      "realestate",
      "insurance",
      "gold",
      "other",
      "option",
      "loan",
    ];
    return Array.from(s).sort(
      (a, b) => (order.indexOf(a) + 99) - (order.indexOf(b) + 99),
    );
  }, [filtered]);

  /** 组装图表数据 */
  const chartData = useMemo(() => {
    // 目标轨迹：用分桶模型做"理想线"。
    // - start_date → today 之间：用当前桶比例的加权年化，从 start_amount 按月流入 + 复利外推
    // - today → target_date：用今天的真实桶做 projectBuckets 向前推
    // 两段在 today 附近能平滑衔接。
    let blendedMonthly = 0;
    let monthlyInflowCNY = 0;
    let startBuckets = bucketHoldings(holdings);
    let startInflow = bucketInflows(holdings);
    if (goal && startBuckets.total > 0) {
      const wRe = startBuckets.realestate / startBuckets.total;
      const wY = startBuckets.yield_ / startBuckets.total;
      const blendedAnnual =
        wRe * goal.realestate_annual_return +
        wY * goal.expected_annual_return;
      blendedMonthly = Math.pow(1 + blendedAnnual, 1 / 12) - 1;
      monthlyInflowCNY =
        startInflow.cashInflow +
        startInflow.yieldInflow +
        startInflow.realestateInflow +
        startInflow.staticInflow;
    }
    const today = new Date().toISOString().slice(0, 10);

    return filtered.map((s, i) => {
      // 一日一点：优先用 snapshot_date，老数据回退到 snapshot_at 前 10 位
      const label =
        (s as any).snapshot_date || s.snapshot_at.slice(0, 10);
      const byClass = parseBuckets(s.total_by_class_json);
      const prev = i > 0 ? filtered[i - 1].total_cny : s.total_cny;
      const mom = s.total_cny - prev;
      const momPct = prev > 0 ? (mom / prev) * 100 : 0;

      // 目标轨迹
      let target: number | null = null;
      if (goal && label >= goal.start_date && label <= goal.target_date) {
        if (label <= today) {
          // 过去段：start_amount 按加权年化 + 月流入年金
          const m = Math.max(0, monthsBetween(goal.start_date, label));
          if (Math.abs(blendedMonthly) < 1e-12) {
            target = goal.start_amount + monthlyInflowCNY * m;
          } else {
            const g = Math.pow(1 + blendedMonthly, m);
            target =
              goal.start_amount * g +
              monthlyInflowCNY * ((g - 1) / blendedMonthly);
          }
        } else {
          // 未来段：从今天的真实分桶向前推
          const m = Math.max(0, monthsBetween(today, label));
          const proj = projectBuckets(
            startBuckets,
            startInflow,
            {
              yieldAnnual: goal.expected_annual_return,
              realestateAnnual: goal.realestate_annual_return,
            },
            m,
          );
          target = proj.total;
        }
      }

      return {
        at: label,
        total: s.total_cny,
        mom,
        momPct,
        target,
        ...byClass,
      } as Record<string, number | string | null>;
    });
  }, [filtered, goal, holdings]);

  /** 指标：最新 / 期初 / 高点 / 低点 / 最大回撤 */
  const stats = useMemo(() => {
    if (filtered.length === 0) {
      return {
        latest: 0,
        first: 0,
        delta: 0,
        deltaPct: 0,
        peak: 0,
        trough: 0,
        maxDrawdown: 0,
        maxDrawdownPct: 0,
      };
    }
    const latest = filtered[filtered.length - 1].total_cny;
    const first = filtered[0].total_cny;
    let peak = -Infinity;
    let trough = Infinity;
    let runningPeak = -Infinity;
    let maxDd = 0;
    let maxDdPct = 0;
    for (const s of filtered) {
      const v = s.total_cny;
      if (v > peak) peak = v;
      if (v < trough) trough = v;
      if (v > runningPeak) runningPeak = v;
      const dd = v - runningPeak;
      const ddPct = runningPeak > 0 ? (dd / runningPeak) * 100 : 0;
      if (dd < maxDd) {
        maxDd = dd;
        maxDdPct = ddPct;
      }
    }
    const delta = latest - first;
    const deltaPct = first > 0 ? (delta / first) * 100 : 0;
    return {
      latest,
      first,
      delta,
      deltaPct,
      peak,
      trough,
      maxDrawdown: maxDd,
      maxDrawdownPct: maxDdPct,
    };
  }, [filtered]);

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">资产趋势</h1>
          <p className="text-sm text-slate-500 mt-1">
            一日一点（日 K）：每天第一次"刷新行情"生成当日快照，同日再刷只更新不新增
          </p>
        </div>
        <div className="flex items-center gap-2">
          {rangeOptions.map((r) => (
            <Button
              key={r.key}
              variant={range === r.key ? "primary" : "ghost"}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </header>

      {/* 指标卡：6 张 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="最新" value={fmtCompactCNY(stats.latest)} />
        <StatCard label="期初" value={fmtCompactCNY(stats.first)} />
        <StatCard
          label="区间变化"
          value={fmtCompactCNY(stats.delta)}
          sub={fmtPct(stats.deltaPct)}
          tone={stats.delta >= 0 ? "pos" : "neg"}
        />
        <StatCard label="区间高点" value={fmtCompactCNY(stats.peak)} tone="pos" />
        <StatCard label="区间低点" value={fmtCompactCNY(stats.trough)} tone="neg" />
        <StatCard
          label="最大回撤"
          value={fmtCompactCNY(stats.maxDrawdown)}
          sub={fmtPct(stats.maxDrawdownPct)}
          tone="neg"
        />
      </div>

      <Card
        title={`走势图（${filtered.length} 天${
          filtered.length !== ordered.length ? ` / 共 ${ordered.length}` : ""
        }）`}
        actions={
          <>
            {viewOptions.map((v) => (
              <Button
                key={v.key}
                variant={view === v.key ? "primary" : "ghost"}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </Button>
            ))}
          </>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState
            title="还没有快照"
            hint="去总览页点一次「刷新行情」即可生成当月快照"
          />
        ) : (
          <div style={{ height: 380 }}>
            <ResponsiveContainer>
              {view === "total" ? (
                <LineChart
                  data={chartData}
                  margin={{ left: 10, right: 20, top: 10 }}
                >
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
                    name="总资产"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                  />
                  {goal && (
                    <Line
                      type="monotone"
                      dataKey="target"
                      name={`目标轨迹（${goal.name}）`}
                      stroke="#10b981"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                    />
                  )}
                  {goal && <Legend wrapperStyle={{ fontSize: 12 }} />}
                </LineChart>
              ) : view === "stack" ? (
                <AreaChart
                  data={chartData}
                  margin={{ left: 10, right: 20, top: 10 }}
                >
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
                  <Legend
                    wrapperStyle={{ fontSize: 12 }}
                    formatter={(key) => assetClassLabel[key] ?? key}
                  />
                  {allClasses.map((cls) => (
                    <Area
                      key={cls}
                      type="monotone"
                      dataKey={cls}
                      name={cls}
                      stackId="1"
                      stroke={CLASS_COLORS[cls] ?? "#94a3b8"}
                      fill={CLASS_COLORS[cls] ?? "#94a3b8"}
                      fillOpacity={0.75}
                    />
                  ))}
                </AreaChart>
              ) : (
                <BarChart
                  data={chartData}
                  margin={{ left: 10, right: 20, top: 10 }}
                >
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
                    formatter={(v: number, _n, item: any) => {
                      const pct = item?.payload?.momPct;
                      return [
                        `${fmtCNY(v)}${typeof pct === "number" ? ` (${fmtPct(pct)})` : ""}`,
                        "环比",
                      ];
                    }}
                    labelStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="mom" name="环比">
                    {chartData.map((d, i) => (
                      <Cell
                        key={i}
                        fill={(d.mom as number) >= 0 ? "#10b981" : "#ef4444"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* 月度明细表：和图联动，最新在上 */}
      {filtered.length > 0 && (
        <Card title="每日明细">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">日期</th>
                  <th className="px-3 py-2 text-right font-medium">总资产</th>
                  <th className="px-3 py-2 text-right font-medium">日环比</th>
                  <th className="px-3 py-2 text-right font-medium">日环比 %</th>
                  <th className="px-3 py-2 text-left font-medium">
                    按类别占比
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...chartData].reverse().map((d) => {
                  const mom = d.mom as number;
                  const momPct = d.momPct as number;
                  const total = d.total as number;
                  const pos = mom >= 0;
                  return (
                    <tr
                      key={d.at as string}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                        {d.at as string}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {fmtCompactCNY(total)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          pos ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {fmtCompactCNY(mom)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          pos ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {fmtPct(momPct)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1 h-4 rounded overflow-hidden bg-slate-100 min-w-[200px]">
                          {allClasses.map((cls) => {
                            const v = (d[cls] as number | undefined) ?? 0;
                            const pct = total > 0 ? (v / total) * 100 : 0;
                            if (pct < 0.5) return null;
                            return (
                              <div
                                key={cls}
                                style={{
                                  width: `${pct}%`,
                                  backgroundColor:
                                    CLASS_COLORS[cls] ?? "#94a3b8",
                                }}
                                title={`${assetClassLabel[cls] ?? cls} ${pct.toFixed(1)}%`}
                              />
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg";
}) {
  const color =
    tone === "pos"
      ? "text-emerald-600"
      : tone === "neg"
        ? "text-red-600"
        : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>
        {value}
      </div>
      {sub && (
        <div className={`text-xs mt-0.5 tabular-nums ${color}`}>{sub}</div>
      )}
    </div>
  );
}
