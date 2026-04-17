import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type {
  Account,
  HoldingView,
  Instrument,
  OptionCloseInput,
  OptionDashboard,
  OptionStatus,
  OptionTradeInput,
  OptionTradeView,
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
  Select,
} from "../components/ui";
import { fmtCompactCNY, fmtNumber, fmtPct } from "../lib/format";
import { Pencil, Plus, Trash2 } from "lucide-react";

const ownerTone: Record<string, "blue" | "green" | "slate"> = {
  柳哥: "blue",
  刘总: "green",
  共有: "slate",
};

const strategyLabel = {
  sell_put: "Sell Put",
  covered_call: "Covered Call",
} as const;

const statusLabel: Record<OptionStatus, string> = {
  open: "持仓中",
  expired: "已作废",
  assigned: "被行权",
  closed: "已平仓",
  rolled: "已滚动",
};

const statusTone: Record<OptionStatus, "blue" | "green" | "amber" | "red" | "slate"> = {
  open: "blue",
  expired: "green",
  assigned: "amber",
  closed: "slate",
  rolled: "slate",
};

const today = () => new Date().toISOString().slice(0, 10);

/** 表单状态：数字字段用 string 存，避免受控 number input 的"0 删不掉"坑 */
type FormState = Omit<
  OptionTradeInput,
  "strike" | "contracts" | "multiplier" | "premium_per_share"
> & {
  strike: string;
  contracts: string;
  multiplier: string;
  premium_per_share: string;
};

const EMPTY: FormState = {
  account_id: 0,
  underlying_instrument_id: null,
  underlying_symbol: "",
  strategy: "sell_put",
  option_type: "put",
  strike: "",
  expiration: today(),
  contracts: "1",
  multiplier: "100",
  premium_per_share: "",
  open_date: today(),
  currency: "USD",
  cash_holding_id: null,
  note: null,
};

type CloseFormState = { close_date: string; close_price_per_share: string };

export default function Options() {
  const [list, setList] = useState<OptionTradeView[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [holdings, setHoldings] = useState<HoldingView[]>([]);
  const [dashboard, setDashboard] = useState<OptionDashboard | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | OptionStatus>("all");
  const [err, setErr] = useState<string | null>(null);

  // 新增/编辑
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OptionTradeView | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  // 状态切换弹窗
  const [closeTarget, setCloseTarget] = useState<OptionTradeView | null>(null);
  const [closeMode, setCloseMode] = useState<"closed" | "rolled">("closed");
  const [closeForm, setCloseForm] = useState<CloseFormState>({
    close_date: today(),
    close_price_per_share: "",
  });
  const [expireTarget, setExpireTarget] = useState<OptionTradeView | null>(null);
  const [assignTarget, setAssignTarget] = useState<OptionTradeView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OptionTradeView | null>(null);

  async function loadAll() {
    const [ts, as_, is_, hs, dash] = await Promise.all([
      api.listOptionTrades(),
      api.listAccounts(),
      api.listInstruments(),
      api.listHoldings(),
      api.getOptionDashboard(),
    ]);
    setList(ts);
    setAccounts(as_);
    setInstruments(is_);
    setHoldings(hs);
    setDashboard(dash);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const filtered = useMemo(() => {
    if (filterStatus === "all") return list;
    return list.filter((t) => t.status === filterStatus);
  }, [list, filterStatus]);

  /** 当前账户下可选的"同币种现金 holding" */
  const cashHoldingsForForm = useMemo(() => {
    return holdings.filter(
      (h) =>
        h.account_id === form.account_id &&
        h.asset_class === "cash" &&
        h.currency === form.currency,
    );
  }, [holdings, form.account_id, form.currency]);

  /** 表单数字字段的实时解析（仅用于展示预览） */
  const numStrike = Number(form.strike) || 0;
  const numContracts = Number(form.contracts) || 0;
  const numMultiplier = Number(form.multiplier) || 0;
  const numPremium = Number(form.premium_per_share) || 0;

  function startCreate() {
    setEditing(null);
    setForm({
      ...EMPTY,
      account_id: accounts[0]?.id ?? 0,
    });
    setErr(null);
    setOpen(true);
  }

  function startEdit(t: OptionTradeView) {
    setEditing(t);
    setForm({
      account_id: t.account_id,
      underlying_instrument_id: t.underlying_instrument_id ?? null,
      underlying_symbol: t.underlying_symbol,
      strategy: t.strategy,
      option_type: t.option_type,
      strike: String(t.strike),
      expiration: t.expiration,
      contracts: String(t.contracts),
      multiplier: String(t.multiplier),
      premium_per_share: String(t.premium_per_share),
      open_date: t.open_date,
      currency: t.currency,
      cash_holding_id: t.cash_holding_id ?? null,
      note: t.note ?? null,
    });
    setErr(null);
    setOpen(true);
  }

  async function submit() {
    try {
      if (!form.account_id) return setErr("请选择账户");
      if (!form.underlying_symbol.trim()) return setErr("请填标的代码");
      if (!numStrike) return setErr("请填行权价");
      if (!numContracts) return setErr("请填张数");
      if (!numMultiplier) return setErr("请填合约乘数");
      const payload: OptionTradeInput = {
        account_id: form.account_id,
        underlying_instrument_id: form.underlying_instrument_id,
        underlying_symbol: form.underlying_symbol,
        strategy: form.strategy,
        option_type: form.option_type,
        strike: numStrike,
        expiration: form.expiration,
        contracts: numContracts,
        multiplier: numMultiplier,
        premium_per_share: numPremium,
        open_date: form.open_date,
        currency: form.currency,
        cash_holding_id: form.cash_holding_id,
        note: form.note,
      };
      if (editing) {
        await api.updateOptionTrade(editing.id, payload);
      } else {
        await api.createOptionTrade(payload);
      }
      setOpen(false);
      await loadAll();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function submitClose() {
    if (!closeTarget) return;
    const payload: OptionCloseInput = {
      close_date: closeForm.close_date,
      close_price_per_share: Number(closeForm.close_price_per_share) || 0,
    };
    if (closeMode === "closed") {
      await api.closeOptionTrade(closeTarget.id, payload);
    } else {
      await api.markOptionRolled(closeTarget.id, payload);
    }
    setCloseTarget(null);
    await loadAll();
  }
  async function submitExpire() {
    if (!expireTarget) return;
    await api.markOptionExpired(expireTarget.id);
    setExpireTarget(null);
    await loadAll();
  }
  async function submitAssign() {
    if (!assignTarget) return;
    await api.markOptionAssigned(assignTarget.id);
    setAssignTarget(null);
    await loadAll();
  }
  async function doDelete(t: OptionTradeView) {
    await api.deleteOptionTrade(t.id);
    setDeleteTarget(null);
    await loadAll();
  }

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">期权日志</h1>
          <p className="text-sm text-slate-500 mt-1">
            Wheel 策略 · Sell Put 和 Covered Call 的完整记账（不用每天更新价格）
          </p>
        </div>
        <Button onClick={startCreate} disabled={accounts.length === 0}>
          <Plus size={14} />
          新开一笔
        </Button>
      </header>

      {/* 仪表盘 */}
      {dashboard && (
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            label="已实现权利金"
            hint="作废/平仓/行权后结算的净收入"
            value={fmtCompactCNY(dashboard.realized_pnl_cny)}
            tone={dashboard.realized_pnl_cny >= 0 ? "emerald" : "red"}
          />
          <StatCard
            label={`在途权利金（${dashboard.open_count} 笔）`}
            hint="持仓中期权已收到的权利金（已在现金里）"
            value={fmtCompactCNY(dashboard.open_premium_cny)}
            tone="blue"
          />
          <StatCard
            label="占用保证金"
            hint="持仓中期权锁定的现金/股票市值"
            value={fmtCompactCNY(dashboard.margin_hold_cny)}
            tone="slate"
          />
          <StatCard
            label={`胜率（${dashboard.closed_count} 笔结束）`}
            hint="已结束单子中盈利单占比"
            value={
              dashboard.win_rate == null
                ? "—"
                : `${(dashboard.win_rate * 100).toFixed(1)}%`
            }
            tone="emerald"
          />
        </div>
      )}

      <Card title={`期权记录（${filtered.length}${filtered.length !== list.length ? ` / ${list.length}` : ""}）`}>
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-500">状态</span>
          <Select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
          >
            <option value="all">全部</option>
            <option value="open">持仓中</option>
            <option value="expired">已作废</option>
            <option value="closed">已平仓</option>
            <option value="assigned">被行权</option>
            <option value="rolled">已滚动</option>
          </Select>
          {filterStatus !== "all" && (
            <Button variant="ghost" onClick={() => setFilterStatus("all")}>
              清除筛选
            </Button>
          )}
        </div>

        {list.length === 0 ? (
          <EmptyState
            title="还没有期权记录"
            hint="点击右上角「新开一笔」记录你的第一个 Sell Put 或 Covered Call"
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="没有符合条件的期权" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1200px]">
              <thead className="text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-3 text-left font-medium">状态</th>
                  <th className="px-3 py-3 text-left font-medium">持有人/账户</th>
                  <th className="px-3 py-3 text-left font-medium">策略</th>
                  <th className="px-3 py-3 text-left font-medium">标的</th>
                  <th className="px-3 py-3 text-right font-medium">行权价</th>
                  <th className="px-3 py-3 text-right font-medium">到期/剩余</th>
                  <th className="px-3 py-3 text-right font-medium">张数</th>
                  <th className="px-3 py-3 text-right font-medium">权利金/股</th>
                  <th className="px-3 py-3 text-right font-medium">权利金合计</th>
                  <th className="px-3 py-3 text-right font-medium">安全边际</th>
                  <th className="px-3 py-3 text-right font-medium">已实现盈亏</th>
                  <th className="px-3 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const pos = (t.realized_pnl ?? 0) >= 0;
                  const safetyOk =
                    t.safety_margin_pct == null ? null : t.safety_margin_pct > 0;
                  return (
                    <tr
                      key={t.id}
                      className="border-b border-slate-100 last:border-0 align-middle"
                    >
                      <td className="px-3 py-3">
                        <Badge tone={statusTone[t.status]}>
                          {statusLabel[t.status]}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={ownerTone[t.account_owner] ?? "slate"}>
                          {t.account_owner}
                        </Badge>
                        <div className="text-slate-500 text-xs leading-tight mt-1">
                          {t.account_name}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {strategyLabel[t.strategy]}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-slate-900 leading-tight">
                          {t.underlying_symbol}
                        </div>
                        {t.underlying_price != null && (
                          <div className="text-slate-400 text-xs leading-tight mt-0.5">
                            现价 {fmtNumber(t.underlying_price, 2)} {t.currency}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                        {fmtNumber(t.strike, 2)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                        <div className="leading-tight">{t.expiration}</div>
                        {t.status === "open" && (
                          <div
                            className={`text-xs leading-tight mt-0.5 ${
                              t.days_to_expiration < 7
                                ? "text-red-500"
                                : t.days_to_expiration < 30
                                ? "text-amber-500"
                                : "text-slate-400"
                            }`}
                          >
                            {t.days_to_expiration} 天
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                        {fmtNumber(t.contracts, 0)}
                        <span className="ml-1 text-[10px] text-slate-400">
                          ×{t.multiplier}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                        {fmtNumber(t.premium_per_share, 2)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                        {t.currency} {fmtNumber(t.premium_total, 2)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right tabular-nums whitespace-nowrap ${
                          safetyOk == null
                            ? "text-slate-400"
                            : safetyOk
                            ? "text-emerald-600"
                            : "text-red-500"
                        }`}
                      >
                        {t.safety_margin_pct == null
                          ? "—"
                          : fmtPct(t.safety_margin_pct * 100)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right tabular-nums whitespace-nowrap ${
                          t.realized_pnl == null
                            ? "text-slate-400"
                            : pos
                            ? "text-emerald-600"
                            : "text-red-500"
                        }`}
                      >
                        {t.realized_pnl == null
                          ? "—"
                          : `${t.currency} ${fmtNumber(t.realized_pnl, 2)}`}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1 flex-wrap justify-end">
                          {t.status === "open" && (
                            <>
                              <Button
                                variant="ghost"
                                onClick={() => setExpireTarget(t)}
                                title="到期作废"
                              >
                                作废
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setCloseTarget(t);
                                  setCloseMode("closed");
                                  setCloseForm({
                                    close_date: today(),
                                    close_price_per_share: "",
                                  });
                                }}
                                title="提前平仓"
                              >
                                平仓
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => setAssignTarget(t)}
                                title="被行权"
                              >
                                行权
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setCloseTarget(t);
                                  setCloseMode("rolled");
                                  setCloseForm({
                                    close_date: today(),
                                    close_price_per_share: "",
                                  });
                                }}
                                title="滚动 = 平仓 + 手动开新单"
                              >
                                滚动
                              </Button>
                            </>
                          )}
                          <Button variant="ghost" onClick={() => startEdit(t)}>
                            <Pencil size={13} />
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => setDeleteTarget(t)}
                          >
                            <Trash2 size={13} className="text-red-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* === 新增/编辑 Modal === */}
      <Modal
        open={open}
        title={editing ? "编辑期权" : "新开一笔期权"}
        onClose={() => setOpen(false)}
        width="max-w-2xl"
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
          <Field label="策略">
            <Select
              value={form.strategy}
              onChange={(e) => {
                const strategy = e.target.value as "sell_put" | "covered_call";
                setForm({
                  ...form,
                  strategy,
                  option_type: strategy === "sell_put" ? "put" : "call",
                });
              }}
            >
              <option value="sell_put">Sell Put（留现金等接）</option>
              <option value="covered_call">
                Covered Call（持股卖 call）
              </option>
            </Select>
          </Field>
          <Field label="账户">
            <Select
              value={form.account_id}
              onChange={(e) =>
                setForm({
                  ...form,
                  account_id: Number(e.target.value),
                  cash_holding_id: null,
                })
              }
            >
              <option value={0}>请选择…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.owner} · {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="标的代码" hint="如 MSTR / TQQQ / NVDA">
            <Input
              value={form.underlying_symbol}
              onChange={(e) =>
                setForm({ ...form, underlying_symbol: e.target.value.toUpperCase() })
              }
            />
          </Field>
          <Field
            label="标的品种（可选）"
            hint="选上可自动获取标的当前价算安全边际"
          >
            <Select
              value={form.underlying_instrument_id ?? 0}
              onChange={(e) =>
                setForm({
                  ...form,
                  underlying_instrument_id: Number(e.target.value) || null,
                })
              }
            >
              <option value={0}>不关联（手动填现价也行）</option>
              {instruments
                .filter((i) => i.asset_class === "stock" || i.asset_class === "fund")
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.symbol})
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="行权价">
            <Input
              type="number"
              step="any"
              placeholder="例如 140"
              value={form.strike}
              onChange={(e) => setForm({ ...form, strike: e.target.value })}
            />
          </Field>
          <Field label="到期日">
            <Input
              type="date"
              value={form.expiration}
              onChange={(e) => setForm({ ...form, expiration: e.target.value })}
            />
          </Field>
          <Field label="张数">
            <Input
              type="number"
              step="1"
              placeholder="例如 1"
              value={form.contracts}
              onChange={(e) => setForm({ ...form, contracts: e.target.value })}
            />
          </Field>
          <Field label="合约乘数" hint="美股期权默认 100">
            <Input
              type="number"
              step="1"
              placeholder="100"
              value={form.multiplier}
              onChange={(e) => setForm({ ...form, multiplier: e.target.value })}
            />
          </Field>
          <Field
            label="权利金/股"
            hint={(() => {
              const total = numPremium * numContracts * numMultiplier;
              return total > 0
                ? `合计收入 ≈ ${form.currency} ${total.toFixed(2)}`
                : "卖出期权每股收到的权利金，如 2.95";
            })()}
          >
            <Input
              type="number"
              step="any"
              placeholder="例如 2.95"
              value={form.premium_per_share}
              onChange={(e) =>
                setForm({ ...form, premium_per_share: e.target.value })
              }
            />
          </Field>
          <Field label="开仓日">
            <Input
              type="date"
              value={form.open_date}
              onChange={(e) => setForm({ ...form, open_date: e.target.value })}
            />
          </Field>
          <Field label="权利金币种">
            <Select
              value={form.currency}
              onChange={(e) =>
                setForm({
                  ...form,
                  currency: e.target.value,
                  cash_holding_id: null,
                })
              }
            >
              <option value="USD">USD</option>
              <option value="HKD">HKD</option>
              <option value="CNY">CNY</option>
            </Select>
          </Field>
          <Field
            label="权利金入账到"
            hint="自动把权利金加到这个现金持仓上；留空则不联动"
          >
            <Select
              value={form.cash_holding_id ?? 0}
              onChange={(e) =>
                setForm({
                  ...form,
                  cash_holding_id: Number(e.target.value) || null,
                })
              }
            >
              <option value={0}>
                {cashHoldingsForForm.length === 0
                  ? "该账户下无对应币种现金（建议先去持仓建好）"
                  : "不联动现金"}
              </option>
              {cashHoldingsForForm.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.instrument_name} · {h.currency} {fmtNumber(h.quantity, 2)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="备注">
            <Input
              value={form.note ?? ""}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
        </div>
      </Modal>

      {/* === 平仓/滚动 Modal === */}
      <Modal
        open={!!closeTarget}
        title={closeMode === "closed" ? "平仓（Buy to Close）" : "滚动（Close + Reopen）"}
        onClose={() => setCloseTarget(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCloseTarget(null)}>
              取消
            </Button>
            <Button onClick={submitClose}>确认</Button>
          </>
        }
      >
        {closeTarget && (
          <div className="space-y-3 text-sm">
            <div className="text-slate-600">
              {closeTarget.underlying_symbol} {closeTarget.strike}
              {closeTarget.option_type === "put" ? "P" : "C"} · 到期{" "}
              {closeTarget.expiration}
            </div>
            <div className="text-slate-500 text-xs">
              开仓权利金：{closeTarget.currency}{" "}
              {fmtNumber(closeTarget.premium_total, 2)}（{fmtNumber(closeTarget.premium_per_share, 2)}/股）
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="平仓日期">
                <Input
                  type="date"
                  value={closeForm.close_date}
                  onChange={(e) =>
                    setCloseForm({ ...closeForm, close_date: e.target.value })
                  }
                />
              </Field>
              <Field
                label="平仓价/股"
                hint={(() => {
                  const priceNum = Number(closeForm.close_price_per_share) || 0;
                  if (!priceNum) return "每股买回价格，如 0.50";
                  const cost =
                    priceNum * closeTarget.contracts * closeTarget.multiplier;
                  const realized = closeTarget.premium_total - cost;
                  return `平仓成本 ≈ ${closeTarget.currency} ${cost.toFixed(
                    2,
                  )}，预计实现盈亏 ${realized >= 0 ? "+" : ""}${realized.toFixed(
                    2,
                  )}`;
                })()}
              >
                <Input
                  type="number"
                  step="any"
                  placeholder="例如 0.50"
                  value={closeForm.close_price_per_share}
                  onChange={(e) =>
                    setCloseForm({
                      ...closeForm,
                      close_price_per_share: e.target.value,
                    })
                  }
                />
              </Field>
            </div>
            {closeMode === "rolled" && (
              <div className="rounded bg-amber-50 text-amber-800 text-xs px-3 py-2">
                滚动 = 平掉当前合约 + 开一个新合约。确认后记得**再新开一笔**记录滚出去的那张。
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* === 作废确认 === */}
      <ConfirmDialog
        open={!!expireTarget}
        title="到期作废"
        message={
          expireTarget && (
            <>
              确认「<b>{expireTarget.underlying_symbol} {expireTarget.strike}
              {expireTarget.option_type === "put" ? "P" : "C"}</b>」到期未被行权？
              <div className="mt-2 text-xs text-slate-500">
                将记为已实现收入：{expireTarget.currency}{" "}
                {fmtNumber(expireTarget.premium_total, 2)}，不影响任何持仓。
              </div>
            </>
          )
        }
        confirmText="确认作废"
        onConfirm={submitExpire}
        onCancel={() => setExpireTarget(null)}
      />

      {/* === 被行权确认 === */}
      <ConfirmDialog
        open={!!assignTarget}
        title="标记被行权"
        message={
          assignTarget && (
            <>
              确认「<b>{assignTarget.underlying_symbol} {assignTarget.strike}
              {assignTarget.option_type === "put" ? "P" : "C"}</b>」被行权？
              <div className="mt-3 rounded bg-amber-50 text-amber-800 text-xs px-3 py-2 space-y-1">
                <div className="font-medium">⚠️ 请手动到「持仓」页调整：</div>
                {assignTarget.strategy === "covered_call" ? (
                  <>
                    <div>
                      ① 减少 {assignTarget.underlying_symbol} 持仓{" "}
                      {assignTarget.contracts * assignTarget.multiplier} 股
                    </div>
                    <div>
                      ② 增加现金 {assignTarget.currency}{" "}
                      {(
                        assignTarget.strike *
                        assignTarget.contracts *
                        assignTarget.multiplier
                      ).toFixed(2)}
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      ① 减少现金 {assignTarget.currency}{" "}
                      {(
                        assignTarget.strike *
                        assignTarget.contracts *
                        assignTarget.multiplier
                      ).toFixed(2)}
                    </div>
                    <div>
                      ② 增加 {assignTarget.underlying_symbol} 持仓{" "}
                      {assignTarget.contracts * assignTarget.multiplier} 股，成本建议按{" "}
                      {(
                        assignTarget.strike - assignTarget.premium_per_share
                      ).toFixed(2)}
                      /股（行权价 − 权利金）
                    </div>
                  </>
                )}
              </div>
            </>
          )
        }
        confirmText="已了解，标记被行权"
        onConfirm={submitAssign}
        onCancel={() => setAssignTarget(null)}
      />

      {/* === 删除确认 === */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="删除期权记录"
        danger
        message={
          deleteTarget && (
            <>
              确认删除「<b>{deleteTarget.underlying_symbol} {deleteTarget.strike}
              {deleteTarget.option_type === "put" ? "P" : "C"}</b>」？
              {deleteTarget.status === "open" && deleteTarget.cash_holding_id && (
                <div className="mt-2 text-xs text-slate-500">
                  持仓中记录：会同时从对应现金中扣回权利金
                  {deleteTarget.currency} {fmtNumber(deleteTarget.premium_total, 2)}。
                </div>
              )}
            </>
          )
        }
        confirmText="删除"
        onConfirm={() => deleteTarget && doDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = "slate",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "emerald" | "red" | "blue" | "slate";
}) {
  const toneMap: Record<string, string> = {
    emerald: "text-emerald-600",
    red: "text-red-500",
    blue: "text-blue-600",
    slate: "text-slate-900",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${toneMap[tone]}`}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}
