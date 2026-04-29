import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type {
  Account,
  HoldingView,
  Instrument,
  StockTradeInput,
  StockTradeView,
  TradeSide,
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
import { fmtCompactCNY, fmtNumber } from "../lib/format";
import { Plus, Trash2 } from "lucide-react";

const ownerTone: Record<string, "blue" | "green" | "slate"> = {
  柳哥: "blue",
  刘总: "green",
  共有: "slate",
};

const sideLabel: Record<TradeSide, string> = { buy: "买入", sell: "卖出" };
const sideTone: Record<TradeSide, "blue" | "amber"> = {
  buy: "blue",
  sell: "amber",
};

const today = () => new Date().toISOString().slice(0, 10);

/** 数字字段用 string 存，避免受控 number input 的 0 bug */
type FormState = {
  account_id: number;
  instrument_id: number;
  side: TradeSide;
  quantity: string;
  price_per_share: string;
  trade_date: string;
  cash_holding_id: number | null;
  note: string;
};

const EMPTY: FormState = {
  account_id: 0,
  instrument_id: 0,
  side: "buy",
  quantity: "",
  price_per_share: "",
  trade_date: today(),
  cash_holding_id: null,
  note: "",
};

export default function Trades() {
  const [list, setList] = useState<StockTradeView[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [holdings, setHoldings] = useState<HoldingView[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<StockTradeView | null>(
    null,
  );
  const [filterOwner, setFilterOwner] = useState<string>("all");
  const [filterAccountId, setFilterAccountId] = useState<number>(0);

  async function loadAll() {
    const [ts, as_, is_, hs] = await Promise.all([
      api.listStockTrades(),
      api.listAccounts(),
      api.listInstruments(),
      api.listHoldings(),
    ]);
    setList(ts);
    setAccounts(as_);
    setInstruments(is_);
    setHoldings(hs);
  }
  useEffect(() => {
    loadAll();
  }, []);

  const accountsByOwner = useMemo(() => {
    const m = new Map<string, Account[]>();
    for (const a of accounts) {
      const k = a.owner || "共有";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    return Array.from(m.entries());
  }, [accounts]);

  const owners = useMemo(() => {
    const s = new Set<string>();
    for (const a of accounts) s.add(a.owner || "共有");
    return Array.from(s);
  }, [accounts]);

  const ownerByAccount = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of accounts) m.set(a.id, a.owner || "共有");
    return m;
  }, [accounts]);

  const accountsForFilter = useMemo(() => {
    if (filterOwner === "all") return accounts;
    return accounts.filter((a) => (a.owner || "共有") === filterOwner);
  }, [accounts, filterOwner]);

  const filtered = useMemo(() => {
    return list.filter((t) => {
      if (filterAccountId && t.account_id !== filterAccountId) return false;
      if (filterOwner !== "all") {
        const own = ownerByAccount.get(t.account_id) ?? "共有";
        if (own !== filterOwner) return false;
      }
      return true;
    });
  }, [list, filterOwner, filterAccountId, ownerByAccount]);

  /** 账户 / 品种变了，自动选中第一笔同币种现金持仓（如果当前没选或选的不匹配） */
  useEffect(() => {
    const inst = instruments.find((i) => i.id === form.instrument_id);
    if (!form.account_id || !inst) return;
    const firstCash = holdings.find(
      (h) =>
        h.account_id === form.account_id &&
        h.asset_class === "cash" &&
        h.currency === inst.currency,
    );
    const currentStillValid =
      form.cash_holding_id &&
      holdings.some(
        (h) =>
          h.id === form.cash_holding_id &&
          h.account_id === form.account_id &&
          h.asset_class === "cash" &&
          h.currency === inst.currency,
      );
    if (!currentStillValid) {
      setForm((f) => ({ ...f, cash_holding_id: firstCash?.id ?? null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.account_id, form.instrument_id, holdings, instruments]);

  /** 当前账户 + 品种币种匹配的现金 holdings */
  const cashOptions = useMemo(() => {
    if (!form.account_id || !form.instrument_id) return [] as HoldingView[];
    const inst = instruments.find((i) => i.id === form.instrument_id);
    if (!inst) return [];
    return holdings.filter(
      (h) =>
        h.account_id === form.account_id &&
        h.asset_class === "cash" &&
        h.currency === inst.currency,
    );
  }, [form.account_id, form.instrument_id, holdings, instruments]);

  /** 可交易品种：只显示 stock / fund / bond */
  const tradableInstruments = useMemo(
    () =>
      instruments.filter((i) =>
        ["stock", "fund", "bond"].includes(i.asset_class),
      ),
    [instruments],
  );

  /** 当前账户现有的持仓（用于卖出时提示上限） */
  const currentHolding = useMemo(() => {
    if (!form.account_id || !form.instrument_id) return null;
    return (
      holdings.find(
        (h) =>
          h.account_id === form.account_id &&
          h.instrument_id === form.instrument_id,
      ) ?? null
    );
  }, [form.account_id, form.instrument_id, holdings]);

  function startCreate(side: TradeSide = "buy") {
    setForm({
      ...EMPTY,
      side,
      account_id: accounts[0]?.id ?? 0,
      instrument_id: tradableInstruments[0]?.id ?? 0,
    });
    setErr(null);
    setOpen(true);
  }

  async function submit() {
    try {
      if (!form.account_id || !form.instrument_id) {
        setErr("请选择账户和品种");
        return;
      }
      const qty = Number(form.quantity);
      const price = Number(form.price_per_share);
      if (!qty || qty <= 0) return setErr("请填数量");
      if (price < 0 || Number.isNaN(price)) return setErr("请填价格");
      if (!form.cash_holding_id) {
        return setErr(
          "请选择联动现金持仓。如果该账户还没有现金持仓，请先到「持仓」页新增一笔",
        );
      }
      if (form.side === "buy") {
        const cash = holdings.find((h) => h.id === form.cash_holding_id);
        if (cash && qty * price > cash.quantity + 1e-9) {
          return setErr(
            `现金余额 ${fmtNumber(cash.quantity, 2)} ${cash.currency} 不足以买入（需要 ${fmtNumber(qty * price, 2)}）`,
          );
        }
      }
      const payload: StockTradeInput = {
        account_id: form.account_id,
        instrument_id: form.instrument_id,
        quantity: qty,
        price_per_share: price,
        trade_date: form.trade_date,
        cash_holding_id: form.cash_holding_id,
        note: form.note || null,
      };
      if (form.side === "buy") await api.recordStockBuy(payload);
      else await api.recordStockSell(payload);
      setOpen(false);
      await loadAll();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function doRemove(t: StockTradeView) {
    try {
      await api.deleteStockTrade(t.id);
      setConfirmTarget(null);
      await loadAll();
    } catch (e) {
      alert(String(e));
    }
  }

  const total = Number(form.quantity) * Number(form.price_per_share);

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">股票交易</h1>
          <p className="text-sm text-slate-500 mt-1">
            买入/卖出会自动联动现金持仓与股票成本，永远不会重复计算
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => startCreate("sell")}>
            <Plus size={14} />
            新增卖出
          </Button>
          <Button onClick={() => startCreate("buy")}>
            <Plus size={14} />
            新增买入
          </Button>
        </div>
      </header>

      <Card title={`交易流水（${filtered.length}${filtered.length !== list.length ? ` / ${list.length}` : ""}）`}>
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">持有人</span>
            <Select
              value={filterOwner}
              onChange={(e) => {
                const v = e.target.value;
                setFilterOwner(v);
                if (filterAccountId) {
                  const acc = accounts.find((a) => a.id === filterAccountId);
                  if (acc && v !== "all" && (acc.owner || "共有") !== v)
                    setFilterAccountId(0);
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
          <EmptyState title="尚无交易" hint="点击右上角新增买入/卖出" />
        ) : filtered.length === 0 ? (
          <EmptyState title="没有符合条件的交易" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-3 text-left font-medium">日期</th>
                  <th className="px-3 py-3 text-left font-medium">方向</th>
                  <th className="px-3 py-3 text-left font-medium">账户</th>
                  <th className="px-3 py-3 text-left font-medium">品种</th>
                  <th className="px-3 py-3 text-right font-medium">数量</th>
                  <th className="px-3 py-3 text-right font-medium">价格</th>
                  <th className="px-3 py-3 text-right font-medium">总额</th>
                  <th className="px-3 py-3 text-right font-medium">已实现盈亏</th>
                  <th className="px-3 py-3 text-left font-medium">备注</th>
                  <th className="px-3 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const owner = ownerByAccount.get(t.account_id) ?? "共有";
                  const realized = t.realized_pnl;
                  const pos = (realized ?? 0) >= 0;
                  return (
                    <tr
                      key={t.id}
                      className="border-b border-slate-100 last:border-0 align-middle"
                    >
                      <td className="px-3 py-3 text-slate-600 whitespace-nowrap">
                        {t.trade_date}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={sideTone[t.side]}>
                          {sideLabel[t.side]}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <Badge tone={ownerTone[owner] ?? "slate"}>
                            {owner}
                          </Badge>
                          <span className="text-slate-900">
                            {t.account_name}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-slate-900 font-medium leading-tight">
                          {t.instrument_name}
                        </div>
                        <div className="text-slate-400 text-xs font-mono leading-tight mt-0.5">
                          {t.instrument_symbol}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {fmtNumber(t.quantity, 4)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {t.currency} {fmtNumber(t.price_per_share, 4)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-medium">
                        {t.currency} {fmtNumber(t.total, 2)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right tabular-nums whitespace-nowrap ${
                          realized == null
                            ? "text-slate-400"
                            : pos
                              ? "text-emerald-600"
                              : "text-red-600"
                        }`}
                      >
                        {realized == null
                          ? "—"
                          : `${t.currency} ${fmtNumber(realized, 2)}`}
                      </td>
                      <td className="px-3 py-3 text-slate-500 text-xs max-w-[200px] truncate">
                        {t.note ?? ""}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button
                          variant="ghost"
                          onClick={() => setConfirmTarget(t)}
                        >
                          <Trash2 size={13} className="text-red-500" />
                        </Button>
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
        title={form.side === "buy" ? "新增买入" : "新增卖出"}
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
          <Field label="方向">
            <Select
              value={form.side}
              onChange={(e) =>
                setForm({ ...form, side: e.target.value as TradeSide })
              }
            >
              <option value="buy">买入</option>
              <option value="sell">卖出</option>
            </Select>
          </Field>
          <Field label="日期">
            <Input
              type="date"
              value={form.trade_date}
              onChange={(e) =>
                setForm({ ...form, trade_date: e.target.value })
              }
            />
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
              onChange={(e) =>
                setForm({
                  ...form,
                  instrument_id: Number(e.target.value),
                  cash_holding_id: null,
                })
              }
            >
              <option value={0}>请选择…</option>
              {tradableInstruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.symbol}) · {i.currency}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="数量"
            hint={
              form.side === "sell" && currentHolding
                ? `当前持仓 ${fmtNumber(currentHolding.quantity, 4)}`
                : undefined
            }
          >
            <Input
              type="number"
              step="any"
              value={form.quantity}
              onChange={(e) =>
                setForm({ ...form, quantity: e.target.value })
              }
            />
          </Field>
          <Field
            label="成交价（每股/每份）"
            hint={
              total > 0
                ? `总额 ≈ ${total.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`
                : undefined
            }
          >
            <Input
              type="number"
              step="any"
              value={form.price_per_share}
              onChange={(e) =>
                setForm({ ...form, price_per_share: e.target.value })
              }
            />
          </Field>
          <Field
            label={`联动现金持仓（${form.side === "buy" ? "扣" : "加"}款） *`}
            hint={
              cashOptions.length === 0
                ? "⚠️ 该账户没有同币种现金持仓，请先到「持仓」页新增一笔再来交易"
                : "买入会扣这笔现金，余额不够会拒绝；卖出会把款打到这笔现金里"
            }
          >
            <Select
              value={form.cash_holding_id ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                setForm({ ...form, cash_holding_id: v || null });
              }}
              disabled={!form.account_id || !form.instrument_id || cashOptions.length === 0}
            >
              {cashOptions.length === 0 && (
                <option value={0}>—（无可用现金持仓）</option>
              )}
              {cashOptions.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.instrument_name}（余额 {fmtNumber(h.quantity, 2)}{" "}
                  {h.currency}）
                </option>
              ))}
            </Select>
          </Field>
          <Field label="备注">
            <Input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
        </div>
        {form.side === "sell" && currentHolding && (
          <div className="mt-3 text-xs text-slate-500 bg-slate-50 rounded px-3 py-2">
            当前平均成本 ≈{" "}
            {fmtNumber(
              currentHolding.quantity > 0
                ? currentHolding.cost / currentHolding.quantity
                : 0,
              4,
            )}
            ；卖出价 × 数量 =
            {total > 0
              ? ` ${fmtCompactCNY(total)}`
              : " —"}
            ；卖出后会自动把对应成本从持仓里抽掉。
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmTarget}
        title="删除交易"
        message={
          <>
            确定删除这笔{sideLabel[confirmTarget?.side ?? "buy"]}「
            <b>{confirmTarget?.instrument_name}</b>」？系统会把持仓和现金恢复到交易前的状态。
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
