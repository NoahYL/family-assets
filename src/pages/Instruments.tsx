import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type {
  AssetClass,
  Instrument,
  InstrumentInput,
  QuoteSource,
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
import { assetClassLabel, quoteSourceLabel } from "../lib/format";
import { Pencil, Plus, Trash2 } from "lucide-react";

const EMPTY: InstrumentInput = {
  symbol: "",
  name: "",
  asset_class: "stock",
  market: "CN",
  currency: "CNY",
  quote_source: "sina_cn",
};

/** 根据 class+market 自动建议 quote_source 和 currency */
function suggest(input: InstrumentInput): InstrumentInput {
  const next = { ...input };
  if (input.asset_class === "stock") {
    if (input.market === "CN") {
      next.quote_source = "sina_cn";
      next.currency = "CNY";
    } else if (input.market === "HK") {
      next.quote_source = "sina_hk";
      next.currency = "HKD";
    } else if (input.market === "US") {
      next.quote_source = "sina_us";
      next.currency = "USD";
    }
  } else if (input.asset_class === "fund") {
    next.quote_source = "tiantian";
    next.currency = "CNY";
    next.market = null;
  } else if (input.asset_class === "gold") {
    next.quote_source = "sina_gold";
    next.currency = "CNY";
    next.market = null;
  } else if (input.asset_class === "cash") {
    next.quote_source = "manual";
  } else if (input.asset_class === "option") {
    // 期权无免费实时行情 → 走手动估值，币种按市场联动
    next.quote_source = "manual";
    if (input.market === "US") next.currency = "USD";
    else if (input.market === "HK") next.currency = "HKD";
  }
  return next;
}

export default function Instruments() {
  const [list, setList] = useState<Instrument[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Instrument | null>(null);
  const [form, setForm] = useState<InstrumentInput>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<Instrument | null>(null);
  const [removeErr, setRemoveErr] = useState<string | null>(null);

  async function load() {
    setList(await api.listInstruments());
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!q.trim()) return list;
    const k = q.trim().toLowerCase();
    return list.filter(
      (i) =>
        i.symbol.toLowerCase().includes(k) ||
        i.name.toLowerCase().includes(k),
    );
  }, [list, q]);

  function startCreate() {
    setEditing(null);
    setForm(EMPTY);
    setErr(null);
    setOpen(true);
  }

  function startEdit(i: Instrument) {
    setEditing(i);
    setForm({
      symbol: i.symbol,
      name: i.name,
      asset_class: i.asset_class,
      market: i.market ?? null,
      currency: i.currency,
      quote_source: i.quote_source,
    });
    setErr(null);
    setOpen(true);
  }

  async function submit() {
    try {
      if (editing) {
        await api.updateInstrument(editing.id, form);
      } else {
        await api.createInstrument(form);
      }
      setOpen(false);
      await load();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function doRemove(i: Instrument) {
    try {
      await api.deleteInstrument(i.id);
      setConfirmTarget(null);
      setRemoveErr(null);
      await load();
    } catch (e) {
      setRemoveErr(String(e));
    }
  }

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">品种库</h1>
          <p className="text-sm text-slate-500 mt-1">
            股票、基金、黄金等标的。录入持仓时从这里选。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="搜索代码/名称"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-56"
          />
          <Button onClick={startCreate}>
            <Plus size={14} />
            新增品种
          </Button>
        </div>
      </header>

      <Card title={`品种列表（${filtered.length}）`}>
        {filtered.length === 0 ? (
          <EmptyState title="没有匹配的品种" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2 text-left font-medium">代码</th>
                <th className="py-2 text-left font-medium">名称</th>
                <th className="py-2 text-left font-medium">类别</th>
                <th className="py-2 text-left font-medium">市场</th>
                <th className="py-2 text-left font-medium">币种</th>
                <th className="py-2 text-left font-medium">行情源</th>
                <th className="py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5 font-mono text-xs text-slate-700">
                    {i.symbol}
                  </td>
                  <td className="py-2.5 font-medium text-slate-900">{i.name}</td>
                  <td className="py-2.5">
                    <Badge tone="blue">{assetClassLabel[i.asset_class]}</Badge>
                  </td>
                  <td className="py-2.5 text-slate-600">{i.market ?? "—"}</td>
                  <td className="py-2.5 text-slate-600">{i.currency}</td>
                  <td className="py-2.5 text-slate-500 text-xs">
                    {quoteSourceLabel[i.quote_source]}
                  </td>
                  <td className="py-2.5 text-right">
                    <Button variant="ghost" onClick={() => startEdit(i)}>
                      <Pencil size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setRemoveErr(null);
                        setConfirmTarget(i);
                      }}
                    >
                      <Trash2 size={13} className="text-red-500" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={open}
        title={editing ? "编辑品种" : "新增品种"}
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
          <Field
            label="代码（symbol）"
            hint="A股: sh600519 / sz000001；港股: hk00700；美股: gb_aapl；基金: 6位码"
          >
            <Input
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
            />
          </Field>
          <Field label="名称">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="类别">
            <Select
              value={form.asset_class}
              onChange={(e) =>
                setForm(
                  suggest({
                    ...form,
                    asset_class: e.target.value as AssetClass,
                  }),
                )
              }
            >
              {Object.entries(assetClassLabel).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="市场">
            <Select
              value={form.market ?? ""}
              onChange={(e) =>
                setForm(
                  suggest({ ...form, market: e.target.value || null }),
                )
              }
            >
              <option value="">—</option>
              <option value="CN">CN 内地</option>
              <option value="HK">HK 香港</option>
              <option value="US">US 美国</option>
            </Select>
          </Field>
          <Field label="币种">
            <Select
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            >
              <option value="CNY">CNY 人民币</option>
              <option value="USD">USD 美元</option>
              <option value="HKD">HKD 港币</option>
            </Select>
          </Field>
          <Field label="行情源">
            <Select
              value={form.quote_source}
              onChange={(e) =>
                setForm({
                  ...form,
                  quote_source: e.target.value as QuoteSource,
                })
              }
            >
              {Object.entries(quoteSourceLabel).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmTarget}
        title="删除品种"
        message={
          <>
            确定删除品种「<b>{confirmTarget?.name}</b>」？
            <div className="mt-2 text-xs text-slate-500">
              若有任何持仓引用了它，删除会失败。
            </div>
            {removeErr && (
              <div className="mt-3 text-sm text-red-600 bg-red-50 rounded px-3 py-2">
                {removeErr}
              </div>
            )}
          </>
        }
        confirmText="删除"
        danger
        onConfirm={() => confirmTarget && doRemove(confirmTarget)}
        onCancel={() => {
          setConfirmTarget(null);
          setRemoveErr(null);
        }}
      />
    </div>
  );
}
