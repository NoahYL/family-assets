import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { DashboardSummary, RefreshReport } from "../lib/types";
import { Card, Button, Badge } from "../components/ui";
import { AssetPie, PieLegend } from "../components/AssetPie";
import { fmtCNY, fmtCompactCNY, fmtPct } from "../lib/format";
import { RefreshCw } from "lucide-react";

export default function Dashboard() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [report, setReport] = useState<RefreshReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const d = await api.getDashboard();
      setData(d);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setErr(null);
    setReport(null);
    try {
      const r = await api.refreshAll();
      setReport(r);
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const pnlPositive = (data?.pnl_cny ?? 0) >= 0;

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">总览</h1>
          <p className="text-sm text-slate-500 mt-1">
            {data?.last_refreshed_at
              ? `上次刷新：${data.last_refreshed_at}`
              : "尚未刷新过行情"}
          </p>
        </div>
        <Button onClick={refresh} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "刷新中…" : "刷新行情"}
        </Button>
      </header>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3">
          {err}
        </div>
      )}

      {report && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm px-4 py-3">
          刷新完成：成功 {report.refreshed} 个
          {report.failed.length > 0 && (
            <>
              ，失败 {report.failed.length} 个 —{" "}
              <span className="text-red-600">
                {report.failed.map((f) => `${f.symbol}(${f.reason})`).join("; ")}
              </span>
            </>
          )}
          。最新总资产 {fmtCNY(report.total_cny)}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="家庭总资产">
          <div className="text-3xl font-semibold tabular-nums text-slate-900">
            {fmtCompactCNY(data?.total_cny ?? 0)}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            精确值 {fmtCNY(data?.total_cny ?? 0)}
          </div>
        </Card>
        <Card title="累计浮盈亏">
          <div
            className={`text-3xl font-semibold tabular-nums ${
              pnlPositive ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {fmtCompactCNY(data?.pnl_cny ?? 0)}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            收益率 {fmtPct(data?.pnl_pct ?? 0)} ·{" "}
            成本合计 {fmtCompactCNY(data?.total_cost_cny ?? 0)}
          </div>
        </Card>
        <Card title="状态">
          <div className="space-y-2 text-sm">
            <div>
              <Badge tone={loading ? "amber" : "green"}>
                {loading ? "加载中" : "就绪"}
              </Badge>
            </div>
            <div className="text-slate-500 text-xs">
              数据存储于本地 SQLite，无云端同步
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="按持有人">
          <AssetPie data={data?.by_owner ?? []} />
          <div className="mt-4">
            <PieLegend data={data?.by_owner ?? []} />
          </div>
        </Card>
        <Card title="按资产类别">
          <AssetPie data={data?.by_class ?? []} />
          <div className="mt-4">
            <PieLegend data={data?.by_class ?? []} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="按账户 / 机构">
          <AssetPie data={data?.by_account ?? []} />
          <div className="mt-4">
            <PieLegend data={data?.by_account ?? []} />
          </div>
        </Card>
        <Card title="按币种">
          <AssetPie data={data?.by_currency ?? []} />
          <div className="mt-4">
            <PieLegend data={data?.by_currency ?? []} />
          </div>
        </Card>
      </div>
    </div>
  );
}
