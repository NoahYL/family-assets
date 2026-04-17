import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { Account, AccountInput, AccountType } from "../lib/types";
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
import { accountTypeLabel } from "../lib/format";
import { Pencil, Plus, Trash2 } from "lucide-react";

const OWNERS = ["柳哥", "刘总", "共有"] as const;
type Owner = (typeof OWNERS)[number];

const EMPTY: AccountInput = {
  name: "",
  institution: "",
  type: "bank",
  currency: "CNY",
  owner: "柳哥",
  note: "",
};

type Preset = {
  name: string;
  institution: string;
  type: AccountType;
  currency: string;
};

const PRESETS: Preset[] = [
  { name: "兴业银行", institution: "兴业银行", type: "bank", currency: "CNY" },
  { name: "中国银行", institution: "中国银行", type: "bank", currency: "CNY" },
  { name: "国投证券", institution: "国投证券", type: "broker", currency: "CNY" },
  { name: "富途牛牛(港股)", institution: "富途证券", type: "broker", currency: "HKD" },
  { name: "富途牛牛(美股)", institution: "富途证券", type: "broker", currency: "USD" },
  { name: "支付宝", institution: "支付宝", type: "payment", currency: "CNY" },
  { name: "微信零钱", institution: "微信", type: "payment", currency: "CNY" },
  { name: "自有房产", institution: "自持", type: "realestate", currency: "CNY" },
  { name: "商业保单", institution: "保险公司", type: "insurance", currency: "CNY" },
  { name: "实物黄金", institution: "自持", type: "gold", currency: "CNY" },
];

const ownerBadgeTone: Record<string, "blue" | "green" | "slate"> = {
  柳哥: "blue",
  刘总: "green",
  共有: "slate",
};

export default function Accounts() {
  const [list, setList] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState<AccountInput>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const [presetOwner, setPresetOwner] = useState<Owner>("柳哥");
  const [filter, setFilter] = useState<"全部" | Owner>("全部");
  const [confirmTarget, setConfirmTarget] = useState<Account | null>(null);

  async function load() {
    setList(await api.listAccounts());
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () => (filter === "全部" ? list : list.filter((a) => a.owner === filter)),
    [list, filter],
  );

  function startCreate() {
    setEditing(null);
    setForm({ ...EMPTY, owner: presetOwner });
    setErr(null);
    setOpen(true);
  }

  function startEdit(a: Account) {
    setEditing(a);
    setForm({
      name: a.name,
      institution: a.institution,
      type: a.type,
      currency: a.currency,
      owner: a.owner,
      note: a.note ?? "",
    });
    setErr(null);
    setOpen(true);
  }

  async function submit() {
    try {
      if (editing) {
        await api.updateAccount(editing.id, form);
      } else {
        await api.createAccount(form);
      }
      setOpen(false);
      await load();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function doRemove(a: Account) {
    await api.deleteAccount(a.id);
    setConfirmTarget(null);
    await load();
  }

  async function quickAddPreset(p: Preset) {
    await api.createAccount({
      name: p.name,
      institution: p.institution,
      type: p.type,
      currency: p.currency,
      owner: presetOwner,
      note: null,
    });
    await load();
  }

  // 按持有人分组展示
  const grouped = useMemo(() => {
    const m = new Map<string, Account[]>();
    for (const a of filtered) {
      const key = a.owner || "共有";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(a);
    }
    return Array.from(m.entries());
  }, [filtered]);

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">账户</h1>
          <p className="text-sm text-slate-500 mt-1">
            银行、券商、支付、房产、保单等资产容器；每个账户归属一位持有人
          </p>
        </div>
        <Button onClick={startCreate}>
          <Plus size={14} />
          新增账户
        </Button>
      </header>

      <Card title="快速添加常用账户">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs text-slate-600">添加到：</span>
          {OWNERS.map((o) => (
            <button
              key={o}
              onClick={() => setPresetOwner(o)}
              className={`text-sm px-3 py-1 rounded-full transition ${
                presetOwner === o
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mb-3">
          点击下方按钮快速创建账户，归属当前选中的持有人（币种已按常识预设）。
        </p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.name}
              variant="secondary"
              onClick={() => quickAddPreset(p)}
            >
              <Plus size={12} /> {p.name}
              <span className="ml-1 text-[10px] text-slate-500">{p.currency}</span>
            </Button>
          ))}
        </div>
      </Card>

      <Card
        title={`账户列表（${filtered.length}/${list.length}）`}
        actions={
          <div className="flex items-center gap-1">
            {(["全部", ...OWNERS] as const).map((o) => (
              <button
                key={o}
                onClick={() => setFilter(o)}
                className={`text-xs px-2.5 py-1 rounded-full transition ${
                  filter === o
                    ? "bg-slate-800 text-white"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {o}
              </button>
            ))}
          </div>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState title="当前筛选下没有账户" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-3 text-left font-medium w-[22%]">
                    名称
                  </th>
                  <th className="px-3 py-3 text-left font-medium w-[20%]">
                    机构
                  </th>
                  <th className="px-3 py-3 text-left font-medium w-[12%]">
                    类别
                  </th>
                  <th className="px-3 py-3 text-left font-medium w-[10%]">
                    本位币
                  </th>
                  <th className="px-3 py-3 text-left font-medium">备注</th>
                  <th className="px-3 py-3 text-right font-medium w-[100px]">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([owner, accounts]) => (
                  <Fragment key={owner}>
                    <tr className="bg-slate-50/60 border-b border-slate-200">
                      <td colSpan={6} className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Badge tone={ownerBadgeTone[owner] ?? "slate"}>
                            {owner}
                          </Badge>
                          <span className="text-xs text-slate-400">
                            {accounts.length} 个账户
                          </span>
                        </div>
                      </td>
                    </tr>
                    {accounts.map((a) => (
                      <tr
                        key={a.id}
                        className="border-b border-slate-100 last:border-0 align-middle"
                      >
                        <td className="px-3 py-3 font-medium text-slate-900">
                          {a.name}
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {a.institution}
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {accountTypeLabel[a.type] ?? a.type}
                        </td>
                        <td className="px-3 py-3 text-slate-600 tabular-nums">
                          {a.currency}
                        </td>
                        <td className="px-3 py-3 text-slate-500 text-xs">
                          {a.note || <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <Button
                              variant="ghost"
                              onClick={() => startEdit(a)}
                            >
                              <Pencil size={13} />
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => setConfirmTarget(a)}
                            >
                              <Trash2 size={13} className="text-red-500" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        title={editing ? "编辑账户" : "新增账户"}
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
          <Field label="持有人">
            <Select
              value={form.owner}
              onChange={(e) => setForm({ ...form, owner: e.target.value })}
            >
              {OWNERS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="类别">
            <Select
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as AccountType })
              }
            >
              {Object.entries(accountTypeLabel).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="名称">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="如：兴业银行储蓄"
            />
          </Field>
          <Field label="机构">
            <Input
              value={form.institution}
              onChange={(e) =>
                setForm({ ...form, institution: e.target.value })
              }
              placeholder="如：兴业银行"
            />
          </Field>
          <Field label="本位币">
            <Select
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            >
              <option value="CNY">CNY 人民币</option>
              <option value="USD">USD 美元</option>
              <option value="HKD">HKD 港币</option>
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

      <ConfirmDialog
        open={!!confirmTarget}
        title="删除账户"
        message={
          <>
            确定要删除账户「<b>{confirmTarget?.name}</b>」吗？
            <div className="mt-2 text-red-600 text-xs">
              该账户下的所有持仓也会被一并删除，此操作不可恢复。
            </div>
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
