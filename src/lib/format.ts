export const CNY = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  maximumFractionDigits: 2,
});

export function fmtCNY(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return "¥—";
  return CNY.format(n);
}

export function fmtNumber(
  n: number | undefined | null,
  digits = 2,
): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtPct(n: number | undefined | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function fmtCompactCNY(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return "¥—";
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`;
  if (abs >= 1e4) return `${(n / 1e4).toFixed(2)} 万`;
  return fmtCNY(n);
}

export const assetClassLabel: Record<string, string> = {
  cash: "现金",
  stock: "股票",
  fund: "基金",
  bond: "债券",
  option: "期权",
  gold: "黄金",
  realestate: "房产",
  insurance: "保单",
  loan: "贷款",
  other: "其他",
};

export const accountTypeLabel: Record<string, string> = {
  bank: "银行",
  broker: "券商",
  payment: "支付",
  insurance: "保险",
  realestate: "房产",
  gold: "黄金",
  custom: "其他",
};

export const quoteSourceLabel: Record<string, string> = {
  sina_cn: "新浪·A股",
  sina_hk: "新浪·港股",
  sina_us: "新浪·美股",
  sina_fx: "新浪·汇率",
  sina_gold: "新浪·黄金",
  tiantian: "天天基金",
  manual: "手动估值",
};
