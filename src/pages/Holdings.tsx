import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type {
  Account,
  HoldingInput,
  HoldingView,
  Instrument,
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

const ownerTone: Record<string, "blue" | "green" | "slate"> = {
  柳哥: "blue",
  刘总: "green",
  共有: "slate",
};
import {
  assetClassLabel,
  fmtCNY,
  fmtCompactCNY,
  fmtNumber,
  fmtPct,
} from "../lib/format";
import { Pencil, Plus, Trash2 } from "lucide-react";

const EMPTY: HoldingInput = {
  account_id: 0,
  instrument_id: 0,
  quantity: 0,
  cost: 0,
  manual_price: null,
  multiplier: 1,
  note: null,
};

export default function Holdings() {
  const [list, setList] = useState<HoldingView[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HoldingView | null>(null);
  const [form, setForm] = useState<HoldingInput>(EMPTY);
  const [unitCost, setUnitCost] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<HoldingView | null>(null);
  const [filterOwner, setFilterOwner] = useState<string>("all");
  const [filterAccountId, setFilterAccountId] = useState<number>(0);

  async function loadAll() {
    const [hs, as_, is_] = await Promise.all([
      api.listHoldings(),
      api.listAccounts(),
      api.listInstruments(),
    ]);
    setList(hs);
    setAccounts(as_);
    setInstruments(is_);
  }

  useEffect(() => {
    loadAll();
  }, []);

  /** 账户 id → owner 的快速查表 */
  const ownerByAccountId = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of accounts) m.set(a.id, a.owner || "共有");
    return m;
  }, [accounts]);

  /** 持有人全集（用于筛选下拉） */
  const owners = useMemo(() => {
    const s = new Set<string>();
    for (const a of accounts) s.add(a.owner || "共有");
    return Array.from(s);
  }, [accounts]);

  /** 按当前持有人筛选后，可选的账户列表 */
  const accountsForFilter = useMemo(() => {
    if (filterOwner === "all") return accounts;
    return accounts.filter((a) => (a.owner || "共有") === filterOwner);
  }, [accounts, filterOwner]);

  /** 筛选后的持仓列表 */
  const filteredList = useMemo(() => {
    return list.filter((h) => {
      if (filterAccountId && h.account_id !== filterAccountId) return false;
      if (filterOwner !== "all") {
        const own = ownerByAccountId.get(h.account_id) ?? "共有";
        if (own !== filterOwner) return false;
      }
      return true;
    });
  }, [list, filterOwner, filterAccountId, ownerByAccountId]);

  const totalCny = useMemo(
    () => filteredList.reduce((s, h) => s + h.market_value_cny, 0),
    [filteredList],
  );

  const currentInstrument = useMemo(
    () => instruments.find((i) => i.id === form.instrument_id),
    [instruments, form.instrument_id],
  );
  const needManualPrice = currentInstrument?.quote_source === "manual";
  const isOption = currentInstrument?.asset_class === "option";

  /** 按持有人分组的账户，用于下拉 optgroup */
  const accountsByOwner = useMemo(() => {
    const m = new Map<string, Account[]>();
    for (const a of accounts) {
      const key = a.owner || "共有";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(a);
    }
    return Array.from(m.entries());
  }, [accounts]);

  function startCreate() {
    setEditing(null);
    setForm({
      ...EMPTY,
      account_id: accounts[0]?.id ?? 0,
      instrument_id: instruments[0]?.id ?? 0,
    });
    setUnitCost("");
    setErr(null);
    setOpen(true);
  }

  function startEdit(h: HoldingView) {
    setEditing(h);
    setForm({
      account_id: h.account_id,
      instrument_id: h.instrument_id,
      quantity: h.quantity,
      cost: h.cost,
      manual_price: h.manual_price ?? null,
      multiplier: h.multiplier ?? 1,
      note: h.note ?? null,
    });
    // 反推单价：总成本 / (数量 × 合约乘数)
    const denom = h.quantity * (h.multiplier || 1);
    const unit = denom !== 0 ? h.cost / denom : 0;
    setUnitCost(Number.isFinite(unit) ? String(+unit.toFixed(6)) : "");
    setErr(null);
    setOpen(true);
  }

  async function submit() {
    try {
      if (!form.account_id || !form.instrument_id) {
        setErr("请选择账户和品种");
        return;
      }
      // 用单价 × 数量 × 合约乘数 计算总成本
      const unit = Number(unitCost) || 0;
      const mult = form.multiplier > 0 ? form.multiplier : 1;
      const payload: HoldingInput = {
        ...form,
        cost: unit * form.quantity * mult,
        multiplier: mult,
      };
      if (editing) {
        await api.updateHolding(editing.id, payload);
      } else {
        await api.createHolding(payload);
      }
      setOpen(false);
      await loadAll();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function doRemove(h: HoldingView) {
    await api.deleteHolding(h.id);
    setConfirmTarget(null);
    await loadAll();
  }

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">持仓</h1>
          <p className="text-sm text-slate-500 mt-1">
            {filteredList.length === list.length
              ? `共 ${list.length} 个持仓`
              : `筛选出 ${filteredList.length} / ${list.length} 个持仓`}
            {" · 合计 "}
            {fmtCompactCNY(totalCny)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={startCreate}
            disabled={accounts.length === 0 || instruments.length === 0}
          >
            <Plus size={14} />
            新增持仓
          </Button>
        </div>
      </header>

      {(accounts.length === 0 || instruments.length === 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-3">
          先去「账户」和「品种库」建好基础数据，再回来录入持仓。
        </div>
      )}

      <Card title={`持仓列表（${filteredList.length}${filteredList.length !== list.length ? ` / ${list.length}` : ""}）`}>
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">持有人</span>
            <Select
              value={filterOwner}
              onChange={(e) => {
                const v = e.target.value;
                setFilterOwner(v);
                // 切持有人时，如果当前选中的账户不属于新持有人，就清空账户筛选
                if (filterAccountId) {
                  const acc = accounts.find((a) => a.id === filterAccountId);
                  if (acc && v !== "all" && (acc.owner || "共有") !== v) {
                    setFilterAccountId(0);
                  }
                }
              }}
            >
              <option value="all">全部</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">账户</span>
            <Select
              value={filterAccountId}
              onChange={(e) => setFilterAccountId(Number(e.target.value))}
            >
              <option value={0}>全部</option>
              {accountsForFilter.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
            </Select>
          </div>
          {(filterOwner !== "all" || filterAccountId !== 0) && (
            <Button
              variant="ghost"
              onClick={() => {
                setFilterOwner("all");
                setFilterAccountId(0);
              }}
            >
              清除筛选
            </Button>
          )}
        </div>
        {list.length === 0 ? (
          <EmptyState title="尚无持仓" hint="点击右上角新增" />
        ) : filteredList.length === 0 ? (
          <EmptyState title="没有符合条件的持仓" hint="换一组筛选条件试试" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead className="text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-3 text-left font-medium">持有人</th>
                  <th className="px-3 py-3 text-left font-medium">账户</th>
                  <th className="px-3 py-3 text-left font-medium">品种</th>
                  <th className="px-3 py-3 text-left font-medium">类别</th>
                  <th className="px-3 py-3 text-right font-medium">数量</th>
                  <th className="px-3 py-3 text-right font-medium">现价</th>
                  <th className="px-3 py-3 text-right font-medium">市值(原币)</th>
                  <th className="px-3 py-3 text-right font-medium">市值(¥)</th>
                  <th className="px-3 py-3 text-right font-medium">浮盈亏</th>
                  <th className="px-3 py-3 text-right font-medium">收益率</th>
                  <th className="px-3 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredList.map((h) => {
                  const pos = h.pnl_cny >= 0;
                  const owner =
                    accounts.find((a) => a.id === h.account_id)?.owner ?? "共有";
                  return (
                    <tr
                      key={h.id}
                      className="border-b border-slate-100 last:border-0 align-middle"
                    >
                      <td className="px-3 py-3">
                        <Badge tone={ownerTone[owner] ?? "slate"}>{owner}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-slate-900 font-medium leading-tight">
                          {h.account_name}
                        </div>
                        <div className="text-slate-400 text-xs leading-tight mt-0.5">
                          {h.institution}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-slate-900 font-medium leading-tight">
                          {h.instrument_name}
                        </div>
                        <div className="text-slate-400 text-xs font-mono leading-tight mt-0.5">
                          {h.symbol}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone="blue">
                          {assetClassLabel[h.asset_class]}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                        {fmtNumber(h.quantity, 4)}
                        {h.multiplier && h.multiplier !== 1 ? (
                          <span className="ml-1 text-[10px] text-slate-400">
                            ×{h.multiplier}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                        {h.price != null ? fmtNumber(h.price, 4) : "—"}
                        {h.manual_price != null && (
                          <span className="ml-1 text-[10px] text-amber-600">
                            手动
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600 whitespace-nowrap">
                        {h.currency} {fmtNumber(h.market_value, 2)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-medium whitespace-nowrap">
                        {fmtCNY(h.market_value_cny)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right tabular-nums whitespace-nowrap ${
                          pos ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {fmtCompactCNY(h.pnl_cny)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right tabular-nums whitespace-nowrap ${
                          pos ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {fmtPct(h.pnl_pct)}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <Button variant="ghost" onClick={() => startEdit(h)}>
                            <Pencil size={13} />
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => setConfirmTarget(h)}
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

      <Modal
        open={open}
        title={editing ? "编辑持仓" : "新增持仓"}
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
          <Field label="账户">
            <Select
              value={form.account_id}
              onChange={(e) =>
                setForm({ ...form, account_id: Number(e.target.value) })
              }
            >
              <option value={0}>请选择…</option>
              {accountsByOwner.map(([owner, accts]) => (
                <optgroup key={owner} label={owner}>
                  {accts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="品种">
            <Select
              value={form.instrument_id}
              onChange={(e) => {
                const newId = Number(e.target.value);
                const inst = instruments.find((i) => i.id === newId);
                setForm({
                  ...form,
                  instrument_id: newId,
                  // 选到期权类别且原先 multiplier=1 时，自动置为 100
                  multiplier:
                    inst?.asset_class === "option" && form.multiplier === 1
                      ? 100
                      : form.multiplier,
                });
              }}
            >
              <option value={0}>请选择…</option>
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  [{assetClassLabel[i.asset_class]}] {i.name} ({i.symbol})
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={isOption ? "合约数" : "数量"}
            hint={
              isOption
                ? "期权合约张数（非股数）"
                : "现金/存款类可直接填金额，价格设为 1"
            }
          >
            <Input
              type="number"
              step="any"
              value={form.quantity}
              onChange={(e) =>
                setForm({ ...form, quantity: Number(e.target.value) })
              }
            />
          </Field>
          <Field
            label={isOption ? "买入单价（权利金/每股等价）" : "买入单价（原币）"}
            hint={(() => {
              const unit = Number(unitCost) || 0;
              const mult = form.multiplier > 0 ? form.multiplier : 1;
              const total = unit * form.quantity * mult;
              if (total > 0) {
                return `总成本 ≈ ${total.toLocaleString("zh-CN", {
                  maximumFractionDigits: 2,
                })}（= 单价 × 数量${mult !== 1 ? ` × 乘数 ${mult}` : ""}）`;
              }
              if (isOption) {
                return "期权报价是每股价，如每张 AAPL 210C 报 $5.20 就填 5.20";
              }
              return "每股买入均价。系统自动 × 数量 = 总成本";
            })()}
          >
            <Input
              type="number"
              step="any"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
          </Field>
          <Field
            label="合约乘数"
            hint="股票/基金填 1；美股期权填 100；期指类按实际填"
          >
            <Input
              type="number"
              step="any"
              value={form.multiplier}
              onChange={(e) =>
                setForm({ ...form, multiplier: Number(e.target.value) || 1 })
              }
            />
          </Field>
          <Field
            label={`手动估值 ${needManualPrice ? "（必填）" : "（可选）"}`}
            hint="房产/保单/现金等无行情的品种走这里；股票基金留空即可"
          >
            <Input
              type="number"
              step="any"
              value={form.manual_price ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  manual_price:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </Field>
          <Field label="备注">
            <Input
              value={form.note ?? ""}
              onChange={(e) =>
                setForm({ ...form, note: e.target.value })
              }
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmTarget}
        title="删除持仓"
        message={
          <>
            确定删除持仓「<b>{confirmTarget?.instrument_name}</b>」（于
            <b>{confirmTarget?.account_name}</b>）？
          </>
        }
        confirmText="删除"
        danger
        onConfirm={() => confirmTarget && doRemove(confirmTarget)}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
