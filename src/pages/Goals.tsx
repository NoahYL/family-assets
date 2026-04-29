import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../lib/api";
import type {
  DashboardSummary,
  Goal,
  GoalInput,
  HoldingView,
  Snapshot,
} from "../lib/types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
} from "../components/ui";
import { fmtCNY, fmtCompactCNY, fmtPct } from "../lib/format";
import {
  bucketHoldings,
  bucketInflows,
  buildBucketMilestones,
  daysBetween,
  estimateCAGR,
  forecastTargetDate,
  monthsBetween,
  projectBuckets,
  projectFVNoExtra,
  solveRequiredYieldPMT,
} from "../lib/goalMath";
import { Pencil, Plus, Trash2 } from "lucide-react";

const today = () => new Date().toISOString().slice(0, 10);
const addYearsISO = (y: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + y);
  return d.toISOString().slice(0, 10);
};

/** 围绕目标里设定的生息年化生成 3 档假设：-3pp / 持平 / +2pp */
function makeScenarios(baseRate: number) {
  const conservative = Math.max(0, baseRate - 0.03);
  const optimistic = baseRate + 0.02;
  const fmt = (r: number) => `${(r * 100).toFixed(1)}%`;
  return [
    {
      key: "conservative",
      label: `保守 ${fmt(conservative)}`,
      rate: conservative,
      tone: "#64748b",
    },
    {
      key: "neutral",
      label: `中性 ${fmt(baseRate)}`,
      rate: baseRate,
      tone: "#2563eb",
    },
    {
      key: "optimistic",
      label: `乐观 ${fmt(optimistic)}`,
      rate: optimistic,
      tone: "#10b981",
    },
  ];
}

const BUCKET_META: Record<
  "realestate" | "yield_" | "cash" | "static_",
  { label: string; color: string; hint: string }
> = {
  realestate: {
    label: "房产",
    color: "#8b5cf6",
    hint: "按『房产年化』涨/跌",
  },
  yield_: {
    label: "生息",
    color: "#2563eb",
    hint: "股票/基金/债券/黄金/期权/其他，按『生息年化』复利",
  },
  cash: {
    label: "现金",
    color: "#64748b",
    hint: "现金/存款，不生息，按工资月度累积流入",
  },
  static_: {
    label: "保障/负债",
    color: "#ec4899",
    hint: "保单 + 贷款（负数），静置 0%",
  },
};

type FormState = {
  name: string;
  target_amount: string;
  target_date: string;
  start_amount: string;
  start_date: string;
  expected_annual_return: string;
  realestate_annual_return: string;
  note: string;
};

export default function Goals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [holdings, setHoldings] = useState<HoldingView[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "1000 万小目标",
    target_amount: "10000000",
    target_date: addYearsISO(10),
    start_amount: "0",
    start_date: today(),
    expected_annual_return: "6",
    realestate_annual_return: "-1",
    note: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Goal | null>(null);

  async function loadAll() {
    const [gs, ds, ss, hs] = await Promise.all([
      api.listGoals(),
      api.getDashboard(),
      api.listSnapshots(730),
      api.listHoldings(),
    ]);
    setGoals(gs);
    setDashboard(ds);
    setSnaps(ss);
    setHoldings(hs);
  }
  useEffect(() => {
    loadAll();
  }, []);

  const goal = goals[0] ?? null;
  const currentAmount = dashboard?.total_cny ?? 0;

  const buckets = useMemo(() => bucketHoldings(holdings), [holdings]);
  const inflows = useMemo(() => bucketInflows(holdings), [holdings]);

  function startCreate() {
    setEditing(null);
    setForm({
      name: "1000 万小目标",
      target_amount: "10000000",
      target_date: addYearsISO(10),
      start_amount: String(Math.round(currentAmount)),
      start_date: today(),
      expected_annual_return: "6",
      realestate_annual_return: "-1",
      note: "",
    });
    setErr(null);
    setOpen(true);
  }
  function startEdit(g: Goal) {
    setEditing(g);
    setForm({
      name: g.name,
      target_amount: String(g.target_amount),
      target_date: g.target_date,
      start_amount: String(g.start_amount),
      start_date: g.start_date,
      expected_annual_return: String(
        Math.round(g.expected_annual_return * 10000) / 100,
      ),
      realestate_annual_return: String(
        Math.round(g.realestate_annual_return * 10000) / 100,
      ),
      note: g.note ?? "",
    });
    setErr(null);
    setOpen(true);
  }
  async function submit() {
    try {
      const payload: GoalInput = {
        name: form.name || "我的目标",
        target_amount: Number(form.target_amount),
        target_date: form.target_date,
        start_amount: Number(form.start_amount),
        start_date: form.start_date,
        expected_annual_return: (Number(form.expected_annual_return) || 6) / 100,
        realestate_annual_return:
          (Number(form.realestate_annual_return) || -1) / 100,
        note: form.note || null,
      };
      if (!payload.target_amount || payload.target_amount <= 0)
        return setErr("目标金额要 > 0");
      if (editing) await api.updateGoal(editing.id, payload);
      else await api.createGoal(payload);
      setOpen(false);
      await loadAll();
    } catch (e) {
      setErr(String(e));
    }
  }
  async function doDelete(g: Goal) {
    await api.deleteGoal(g.id);
    setConfirmDelete(null);
    await loadAll();
  }

  // ——— 计算 ———
  const metrics = useMemo(() => {
    if (!goal) return null;
    const nowISO = today();
    const totalDays = Math.max(1, daysBetween(goal.start_date, goal.target_date));
    const elapsedDays = Math.max(0, daysBetween(goal.start_date, nowISO));
    const timePct = Math.min(100, (elapsedDays / totalDays) * 100);

    const gap = Math.max(0, goal.target_amount - currentAmount);
    const totalAmt = Math.max(1, goal.target_amount - goal.start_amount);
    const progressedAmt = currentAmount - goal.start_amount;
    const moneyPct = Math.max(-50, Math.min(150, (progressedAmt / totalAmt) * 100));
    const remainingMonths = monthsBetween(nowISO, goal.target_date);

    // 三档 PMT（按桶模型反解每月还需额外投入到生息桶）
    const scenarios = makeScenarios(goal.expected_annual_return).map((sc) => {
      const pmt = solveRequiredYieldPMT(
        buckets,
        inflows,
        {
          yieldAnnual: sc.rate,
          realestateAnnual: goal.realestate_annual_return,
        },
        goal.target_amount,
        Math.max(1, remainingMonths),
      );
      return { ...sc, pmt };
    });

    // 不追加投入（仅当前流入 + 房产 / 生息按期望年化）时到期能到的 FV
    const projectedFV = projectFVNoExtra(
      buckets,
      inflows,
      {
        yieldAnnual: goal.expected_annual_return,
        realestateAnnual: goal.realestate_annual_return,
      },
      Math.max(0, remainingMonths),
    );

    // 不追加投入但分桶展示：到期时各桶的金额
    const projectedAtTarget = projectBuckets(
      buckets,
      inflows,
      {
        yieldAnnual: goal.expected_annual_return,
        realestateAnnual: goal.realestate_annual_return,
      },
      Math.max(0, remainingMonths),
    );

    const cagrInfo = estimateCAGR(snaps, 6);
    const predictedDate = forecastTargetDate(
      currentAmount,
      cagrInfo.cagr,
      goal.target_amount,
      nowISO,
    );

    return {
      nowISO,
      timePct,
      moneyPct,
      gap,
      remainingMonths,
      scenarios,
      projectedFV,
      projectedAtTarget,
      cagrInfo,
      predictedDate,
    };
  }, [goal, currentAmount, buckets, inflows, snaps]);

  // 图表数据：目标线（按期望年化 + 现有流入）+ 历史实际
  const chartData = useMemo(() => {
    if (!goal || !metrics) return [];
    const rows: { at: string; actual?: number; target?: number }[] = [];

    // 过去的实际快照
    for (const s of snaps) {
      const d = (s.snapshot_date || s.snapshot_at.slice(0, 10)) as string;
      if (d < goal.start_date || d > goal.target_date) continue;
      rows.push({ at: d, actual: s.total_cny });
    }

    // 未来的目标线：从今天出发，按桶模型每月一点
    const months = Math.ceil(metrics.remainingMonths);
    const todayMs = new Date(metrics.nowISO).getTime();
    // 为了让目标线和实际在今天衔接，今天这一点写入 target = currentAmount
    rows.push({ at: metrics.nowISO, target: currentAmount, actual: currentAmount });
    const step = Math.max(1, Math.ceil(months / 60)); // 最多 60 个点
    for (let m = step; m <= months; m += step) {
      const d = new Date(todayMs + (m * 30.4375) * 86400 * 1000)
        .toISOString()
        .slice(0, 10);
      const proj = projectBuckets(
        buckets,
        inflows,
        {
          yieldAnnual: goal.expected_annual_return,
          realestateAnnual: goal.realestate_annual_return,
        },
        m,
      );
      rows.push({ at: d, target: proj.total });
    }
    // 最后 target_date 的点
    rows.push({ at: goal.target_date, target: metrics.projectedFV });

    return rows.sort((a, b) => a.at.localeCompare(b.at));
  }, [goal, metrics, snaps, buckets, inflows, currentAmount]);

  const milestones = useMemo(() => {
    if (!goal || !metrics) return [];
    // 用中性档的 required PMT 来画里程碑
    const neutral = metrics.scenarios.find((s) => s.key === "neutral");
    const extra = Math.max(0, neutral?.pmt ?? 0);
    return buildBucketMilestones(goal, buckets, inflows, extra, snaps, metrics.nowISO);
  }, [goal, metrics, buckets, inflows, snaps]);

  // ——— 渲染 ———
  if (!goal) {
    return (
      <div className="p-8 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">攒钱目标</h1>
          <p className="text-sm text-slate-500 mt-1">
            按"房产 / 生息 / 现金 / 保障"四桶分别建模，比单一年化假设更贴你家实际
          </p>
        </header>
        <Card title="还没有目标">
          <EmptyState
            title="先立一个小目标"
            hint={`当前总资产 ${fmtCompactCNY(currentAmount)}，点下面开始`}
          />
          <div className="mt-4 flex justify-center">
            <Button onClick={startCreate}>
              <Plus size={14} />
              新建目标
            </Button>
          </div>
        </Card>
        {renderModal()}
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{goal.name}</h1>
          <p className="text-sm text-slate-500 mt-1">
            目标 {fmtCompactCNY(goal.target_amount)} · 截止{" "}
            {goal.target_date} · 起点 {fmtCompactCNY(goal.start_amount)}（
            {goal.start_date}）· 生息 {(goal.expected_annual_return * 100).toFixed(1)}% · 房产{" "}
            {(goal.realestate_annual_return * 100).toFixed(1)}%
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => startEdit(goal)}>
            <Pencil size={13} /> 编辑
          </Button>
          <Button variant="ghost" onClick={() => setConfirmDelete(goal)}>
            <Trash2 size={13} className="text-red-500" /> 删除
          </Button>
        </div>
      </header>

      {metrics && (
        <>
          {/* 资产分桶 */}
          <Card title="当前资产分桶">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(["realestate", "yield_", "cash", "static_"] as const).map(
                (k) => {
                  const v = buckets[k];
                  const inflowKey =
                    k === "realestate"
                      ? "realestateInflow"
                      : k === "yield_"
                        ? "yieldInflow"
                        : k === "cash"
                          ? "cashInflow"
                          : "staticInflow";
                  const inflowVal = inflows[inflowKey];
                  const rate =
                    k === "realestate"
                      ? goal.realestate_annual_return
                      : k === "yield_"
                        ? goal.expected_annual_return
                        : 0;
                  const pct = currentAmount > 0 ? (v / currentAmount) * 100 : 0;
                  const meta = BUCKET_META[k];
                  return (
                    <div
                      key={k}
                      className="rounded-lg border border-slate-200 px-4 py-3"
                      style={{
                        borderLeftWidth: 4,
                        borderLeftColor: meta.color,
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="text-xs text-slate-500">
                            {meta.label}
                          </div>
                          <div className="mt-1 text-lg font-semibold tabular-nums">
                            {fmtCompactCNY(v)}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            占比 {pct.toFixed(1)}%
                          </div>
                        </div>
                        <Badge tone={rate >= 0 ? "green" : "red"}>
                          {rate >= 0 ? "+" : ""}
                          {(rate * 100).toFixed(1)}%
                        </Badge>
                      </div>
                      {inflowVal !== 0 && (
                        <div className="text-xs text-slate-500 mt-2">
                          月流入{" "}
                          <span className="tabular-nums font-medium">
                            {fmtCompactCNY(inflowVal)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                },
              )}
            </div>
            <p className="text-xs text-slate-500 mt-3">
              月流入 = 持仓页各品种的 <code>monthly_accrual_cny</code>{" "}
              在各桶内的汇总。想让工资存款进入模型，去现金持仓把这个字段填上。
            </p>
          </Card>

          {/* 进度诊断 */}
          <Card title="进度诊断">
            <div className="space-y-4">
              <ProgressRow
                label="时间进度"
                pct={metrics.timePct}
                hint={`${goal.start_date} → 今日 → ${goal.target_date}（剩 ${(metrics.remainingMonths / 12).toFixed(1)} 年）`}
                color="#64748b"
              />
              <ProgressRow
                label="资金进度"
                pct={metrics.moneyPct}
                hint={`${fmtCompactCNY(goal.start_amount)} → ${fmtCompactCNY(currentAmount)} → ${fmtCompactCNY(goal.target_amount)}（还差 ${fmtCompactCNY(metrics.gap)}）`}
                color="#2563eb"
              />
              <DeltaBanner diff={metrics.moneyPct - metrics.timePct} />
            </div>
          </Card>

          {/* 核心指标 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="已攒" value={fmtCompactCNY(currentAmount)} />
            <StatCard
              label="距离目标"
              value={fmtCompactCNY(metrics.gap)}
              sub={`占目标 ${((metrics.gap / goal.target_amount) * 100).toFixed(1)}%`}
            />
            <StatCard
              label="剩余时间"
              value={`${Math.floor(metrics.remainingMonths / 12)} 年 ${Math.round(metrics.remainingMonths % 12)} 月`}
            />
            <StatCard
              label="实际 CAGR"
              value={
                metrics.cagrInfo.cagr == null
                  ? "—"
                  : fmtPct(metrics.cagrInfo.cagr * 100)
              }
              sub={
                metrics.cagrInfo.cagr == null
                  ? `数据不足，至少 6 个月（现 ${metrics.cagrInfo.months.toFixed(1)} 月）`
                  : `基于最近 ${metrics.cagrInfo.months.toFixed(1)} 个月`
              }
              tone={
                metrics.cagrInfo.cagr == null
                  ? undefined
                  : metrics.cagrInfo.cagr >= goal.expected_annual_return
                    ? "pos"
                    : "neg"
              }
            />
            <StatCard
              label="预计达成日期"
              value={metrics.predictedDate ?? "—"}
              sub={
                metrics.predictedDate
                  ? metrics.predictedDate <= goal.target_date
                    ? "按当前 CAGR 可提前达成"
                    : "按当前 CAGR 将逾期"
                  : "数据不足或缩水中"
              }
              tone={
                metrics.predictedDate
                  ? metrics.predictedDate <= goal.target_date
                    ? "pos"
                    : "neg"
                  : undefined
              }
            />
            <StatCard
              label="按现节奏到期能到"
              value={fmtCompactCNY(metrics.projectedFV)}
              sub={
                metrics.projectedFV >= goal.target_amount
                  ? `盈余 ${fmtCompactCNY(metrics.projectedFV - goal.target_amount)}`
                  : `缺口 ${fmtCompactCNY(goal.target_amount - metrics.projectedFV)}`
              }
              tone={metrics.projectedFV >= goal.target_amount ? "pos" : "neg"}
            />
            <StatCard
              label="到期房产桶"
              value={fmtCompactCNY(metrics.projectedAtTarget.realestate)}
              sub={`按 ${(goal.realestate_annual_return * 100).toFixed(1)}%/年`}
              tone={goal.realestate_annual_return < 0 ? "neg" : undefined}
            />
            <StatCard
              label="到期生息桶"
              value={fmtCompactCNY(metrics.projectedAtTarget.yield_)}
              sub={`按 ${(goal.expected_annual_return * 100).toFixed(1)}%/年 + 月流入`}
              tone="pos"
            />
          </div>

          {/* 三档：额外每月需投到生息桶多少 */}
          <Card title="要准时到达：每月还要额外投到生息桶多少">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {metrics.scenarios.map((sc) => {
                const enough = sc.pmt <= 0;
                return (
                  <div
                    key={sc.key}
                    className="rounded-lg border border-slate-200 px-4 py-3"
                    style={{ borderLeftWidth: 4, borderLeftColor: sc.tone }}
                  >
                    <div className="text-xs text-slate-500">
                      {sc.label}（生息桶）
                    </div>
                    <div
                      className={`mt-1 text-2xl font-semibold tabular-nums ${enough ? "text-emerald-600" : ""}`}
                    >
                      {enough ? "无需追加" : fmtCompactCNY(sc.pmt)}
                      {!enough && (
                        <span className="text-sm text-slate-400 ml-1">
                          / 月
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {enough
                        ? `盈余 ${fmtCompactCNY(-sc.pmt * metrics.remainingMonths)}`
                        : `年合计 ≈ ${fmtCompactCNY(sc.pmt * 12)}`}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 mt-3">
              这是"除了现有月流入之外"还需要往**生息桶**里额外投入的金额。房产按设定年化自行演化，现金按工资月流入累积，二者都已经扣在公式里。
            </p>
          </Card>

          {/* 轨迹图 */}
          <Card title="轨迹对比（桶模型）">
            {chartData.length === 0 ? (
              <EmptyState title="暂无数据" />
            ) : (
              <div style={{ height: 380 }}>
                <ResponsiveContainer>
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
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="actual"
                      name="实际"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="target"
                      name="预期轨迹（按当前桶模型）"
                      stroke="#10b981"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="text-xs text-slate-500 mt-3">
              绿色虚线 = 从今天出发，按 <b>房产年化 {(goal.realestate_annual_return * 100).toFixed(1)}%</b> + <b>生息年化 {(goal.expected_annual_return * 100).toFixed(1)}%</b> + 持仓页已设的月流入，自然演化到目标日。蓝色实线是你的日 K 实际。
            </p>
          </Card>

          {/* 里程碑 */}
          <Card title="每年里程碑（按中性档所需额外投入）">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">年份</th>
                    <th className="px-3 py-2 text-right font-medium">应到</th>
                    <th className="px-3 py-2 text-right font-medium">实际</th>
                    <th className="px-3 py-2 text-right font-medium">差距</th>
                    <th className="px-3 py-2 text-left font-medium">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {milestones.map((m) => {
                    const diff =
                      m.actualValue != null
                        ? m.actualValue - m.targetValue
                        : null;
                    const pos = (diff ?? 0) >= 0;
                    return (
                      <tr
                        key={m.year}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="px-3 py-2 text-slate-700">
                          {m.year} 年末
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtCompactCNY(m.targetValue)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {m.actualValue != null
                            ? fmtCompactCNY(m.actualValue)
                            : "—"}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            diff == null
                              ? "text-slate-400"
                              : pos
                                ? "text-emerald-600"
                                : "text-red-600"
                          }`}
                        >
                          {diff == null ? "—" : fmtCompactCNY(diff)}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {m.actualValue == null ? (
                            <span className="text-slate-400">未来</span>
                          ) : pos ? (
                            <span className="text-emerald-600">领先</span>
                          ) : (
                            <span className="text-red-600">落后</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {renderModal()}

      <ConfirmDialog
        open={!!confirmDelete}
        title="删除目标"
        message={
          <>
            确定删除「<b>{confirmDelete?.name}</b>」？
          </>
        }
        confirmText="删除"
        danger
        onConfirm={() => confirmDelete && doDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );

  function renderModal() {
    return (
      <Modal
        open={open}
        title={editing ? "编辑目标" : "新建目标"}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={submit}>保存</Button>
          </>
        }
      >
        {err && (
          <div className="mb-3 text-sm text-red-600 bg-red-50 rounded px-3 py-2">
            {err}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="名称">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="目标金额 (CNY)">
            <Input
              type="number"
              step="any"
              value={form.target_amount}
              onChange={(e) =>
                setForm({ ...form, target_amount: e.target.value })
              }
            />
          </Field>
          <Field label="目标日期">
            <Input
              type="date"
              value={form.target_date}
              onChange={(e) =>
                setForm({ ...form, target_date: e.target.value })
              }
            />
          </Field>
          <Field label="起点金额 (CNY)" hint="默认用当前总资产">
            <Input
              type="number"
              step="any"
              value={form.start_amount}
              onChange={(e) =>
                setForm({ ...form, start_amount: e.target.value })
              }
            />
          </Field>
          <Field label="起点日期">
            <Input
              type="date"
              value={form.start_date}
              onChange={(e) =>
                setForm({ ...form, start_date: e.target.value })
              }
            />
          </Field>
          <Field
            label="生息年化 (%)"
            hint="股票/基金/黄金/其他，保守 3-4 / 中性 6 / 激进 9"
          >
            <Input
              type="number"
              step="any"
              value={form.expected_annual_return}
              onChange={(e) =>
                setForm({ ...form, expected_annual_return: e.target.value })
              }
            />
          </Field>
          <Field
            label="房产年化 (%)"
            hint="可负数。默认 -1 反映房价缓慢贬值；如果你对本地楼市有信心可改成 0 或正数"
          >
            <Input
              type="number"
              step="any"
              value={form.realestate_annual_return}
              onChange={(e) =>
                setForm({ ...form, realestate_annual_return: e.target.value })
              }
            />
          </Field>
          <Field label="备注">
            <Input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
        </div>
      </Modal>
    );
  }
}

function ProgressRow({
  label,
  pct,
  hint,
  color,
}: {
  label: string;
  pct: number;
  hint?: string;
  color: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-700 font-medium">{label}</span>
        <span className="tabular-nums text-slate-600">{pct.toFixed(1)}%</span>
      </div>
      <div className="mt-1 h-3 rounded bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

function DeltaBanner({ diff }: { diff: number }) {
  const leading = diff >= 0;
  if (Math.abs(diff) < 0.5) {
    return (
      <div className="text-sm rounded-lg px-3 py-2 bg-slate-50 text-slate-600">
        资金进度和时间进度基本持平——正好在轨道上。
      </div>
    );
  }
  return (
    <div
      className={`text-sm rounded-lg px-3 py-2 ${
        leading
          ? "bg-emerald-50 text-emerald-700"
          : "bg-red-50 text-red-700"
      }`}
    >
      {leading ? "✓ 领先" : "× 落后"} {Math.abs(diff).toFixed(1)} 个百分点
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
      {sub && <div className="text-xs mt-0.5 text-slate-500">{sub}</div>}
    </div>
  );
}
