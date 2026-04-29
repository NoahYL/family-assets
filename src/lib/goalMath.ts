import type { AssetClass, Goal, HoldingView, Snapshot } from "./types";

// ============ 基础数学 ============

/** 年化 → 月利率：保证复利一致 (1+monthly)^12 = 1+annual */
export function monthlyRate(annual: number): number {
  return Math.pow(1 + annual, 1 / 12) - 1;
}

/** FV = PV(1+r)^n + PMT × [((1+r)^n - 1) / r] */
export function futureValue(
  pv: number,
  pmt: number,
  r: number,
  n: number,
): number {
  if (Math.abs(r) < 1e-12) return pv + pmt * n;
  const g = Math.pow(1 + r, n);
  return pv * g + pmt * ((g - 1) / r);
}

/** 两个日期相差的自然月数（近似） */
export function monthsBetween(aStr: string, bStr: string): number {
  const a = new Date(aStr).getTime();
  const b = new Date(bStr).getTime();
  const days = (b - a) / (1000 * 60 * 60 * 24);
  return days / 30.4375;
}

/** 日差 */
export function daysBetween(aStr: string, bStr: string): number {
  const a = new Date(aStr).getTime();
  const b = new Date(bStr).getTime();
  return (b - a) / (1000 * 60 * 60 * 24);
}

export function addDaysISO(from: string, days: number): string {
  const d = new Date(from);
  d.setDate(d.getDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

// ============ 桶定义 ============

export type Bucket = "realestate" | "yield" | "cash" | "static";

/** 资产类别归桶 */
export function classToBucket(cls: AssetClass): Bucket {
  switch (cls) {
    case "realestate":
      return "realestate";
    case "cash":
      return "cash";
    case "insurance":
      return "static"; // 重疾险/消费型保障不生息
    case "loan":
      return "static"; // 贷款是负债，0% 增长，从总资产里扣
    case "stock":
    case "fund":
    case "bond":
    case "gold":
    case "option":
    case "other":
    default:
      return "yield";
  }
}

export interface BucketSnapshot {
  realestate: number;
  yield_: number; // 留 trailing underscore 因为 "yield" 是 JS 保留字
  cash: number;
  static_: number;
  total: number;
}

export interface BucketInflow {
  /** 每月流入现金桶（工资结余等） */
  cashInflow: number;
  /** 每月流入生息桶（定投股票/基金） */
  yieldInflow: number;
  /** 每月流入房产桶（极少见，比如按月预付装修/升级） */
  realestateInflow: number;
  /** 每月流入保障桶（每月保费） */
  staticInflow: number;
}

/** 从持仓汇总成 4 个桶的当前金额（按 market_value_cny） */
export function bucketHoldings(holdings: HoldingView[]): BucketSnapshot {
  let re = 0,
    y = 0,
    c = 0,
    s = 0;
  for (const h of holdings) {
    const b = classToBucket(h.asset_class);
    const v = h.market_value_cny || 0;
    if (b === "realestate") re += v;
    else if (b === "yield") y += v;
    else if (b === "cash") c += v;
    else s += v;
  }
  return {
    realestate: re,
    yield_: y,
    cash: c,
    static_: s,
    total: re + y + c + s,
  };
}

/** 从持仓汇总每桶的 monthly_accrual_cny 净流入 */
export function bucketInflows(holdings: HoldingView[]): BucketInflow {
  let re = 0,
    y = 0,
    c = 0,
    s = 0;
  for (const h of holdings) {
    const b = classToBucket(h.asset_class);
    const v = h.monthly_accrual_cny || 0;
    if (b === "realestate") re += v;
    else if (b === "yield") y += v;
    else if (b === "cash") c += v;
    else s += v;
  }
  return {
    realestateInflow: re,
    yieldInflow: y,
    cashInflow: c,
    staticInflow: s,
  };
}

// ============ 桶向前投影 ============

export interface ProjectRates {
  /** 生息年化 */
  yieldAnnual: number;
  /** 房产年化变化率（可负） */
  realestateAnnual: number;
  /** 额外每月投入（在 bucketInflow 基础上叠加，分配到生息桶） */
  extraYieldPMT?: number;
}

/** 从某个起点（当前各桶）向前推 months 个月后的分桶金额 */
export function projectBuckets(
  start: BucketSnapshot,
  inflow: BucketInflow,
  rates: ProjectRates,
  months: number,
): BucketSnapshot {
  const rRe = monthlyRate(rates.realestateAnnual);
  const rY = monthlyRate(rates.yieldAnnual);
  const n = Math.max(0, months);

  // 房产桶：起点复利 + 每月流入的年金
  const re =
    start.realestate * Math.pow(1 + rRe, n) +
    inflow.realestateInflow *
      (Math.abs(rRe) < 1e-12 ? n : (Math.pow(1 + rRe, n) - 1) / rRe);

  // 生息桶：起点复利 + (已有流入 + 额外 PMT) 的年金
  const yPmt = inflow.yieldInflow + (rates.extraYieldPMT ?? 0);
  const y =
    start.yield_ * Math.pow(1 + rY, n) +
    yPmt * (Math.abs(rY) < 1e-12 ? n : (Math.pow(1 + rY, n) - 1) / rY);

  // 现金桶：不生息，只累加
  const c = start.cash + inflow.cashInflow * n;

  // 保障桶：同现金（0%）
  const s = start.static_ + inflow.staticInflow * n;

  return {
    realestate: re,
    yield_: y,
    cash: c,
    static_: s,
    total: re + y + c + s,
  };
}

/** 在桶模型下反解：给定目标 FV，为了达标每月还需要额外投入到生息桶多少
 *  （负数意思是不用投就能到，可以放松）
 */
export function solveRequiredYieldPMT(
  start: BucketSnapshot,
  inflow: BucketInflow,
  rates: Omit<ProjectRates, "extraYieldPMT">,
  targetFV: number,
  months: number,
): number {
  if (months <= 0) return Infinity;
  const rRe = monthlyRate(rates.realestateAnnual);
  const rY = monthlyRate(rates.yieldAnnual);
  const n = months;

  const reFwd =
    start.realestate * Math.pow(1 + rRe, n) +
    inflow.realestateInflow *
      (Math.abs(rRe) < 1e-12 ? n : (Math.pow(1 + rRe, n) - 1) / rRe);
  const cashFwd = start.cash + inflow.cashInflow * n;
  const staticFwd = start.static_ + inflow.staticInflow * n;
  const yieldBase =
    start.yield_ * Math.pow(1 + rY, n) +
    inflow.yieldInflow *
      (Math.abs(rY) < 1e-12 ? n : (Math.pow(1 + rY, n) - 1) / rY);

  const needFromExtra = targetFV - reFwd - cashFwd - staticFwd - yieldBase;
  const annuity =
    Math.abs(rY) < 1e-12 ? n : (Math.pow(1 + rY, n) - 1) / rY;
  return needFromExtra / annuity;
}

/** 按桶模型估算在当前节奏（不加额外 PMT）下能到的 FV */
export function projectFVNoExtra(
  start: BucketSnapshot,
  inflow: BucketInflow,
  rates: Omit<ProjectRates, "extraYieldPMT">,
  months: number,
): number {
  return projectBuckets(start, inflow, rates, months).total;
}

// ============ 历史实际 CAGR ============

export function estimateCAGR(
  snaps: Snapshot[],
  minMonths = 6,
): { cagr: number | null; months: number; first: number; last: number } {
  if (snaps.length < 2)
    return { cagr: null, months: 0, first: 0, last: 0 };
  const ordered = [...snaps].sort((a, b) =>
    a.snapshot_at.localeCompare(b.snapshot_at),
  );
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const months = monthsBetween(first.snapshot_at, last.snapshot_at);
  if (months < minMonths || first.total_cny <= 0) {
    return { cagr: null, months, first: first.total_cny, last: last.total_cny };
  }
  const ratio = last.total_cny / first.total_cny;
  const years = months / 12;
  const cagr = Math.pow(ratio, 1 / years) - 1;
  return { cagr, months, first: first.total_cny, last: last.total_cny };
}

/** 根据当前 PV 和实测 CAGR 外推目标达成日 */
export function forecastTargetDate(
  currentAmount: number,
  cagr: number | null,
  targetAmount: number,
  fromDate: string,
): string | null {
  if (cagr == null) return null;
  if (currentAmount >= targetAmount) return fromDate;
  if (cagr <= 0) return null;
  const years = Math.log(targetAmount / currentAmount) / Math.log(1 + cagr);
  return addDaysISO(fromDate, years * 365.25);
}

// ============ 里程碑 ============

export interface Milestone {
  year: number;
  dateISO: string;
  targetValue: number;
  actualValue: number | null;
}

/** 从"今天"的各桶快照出发，每年末的"应到金额" */
export function buildBucketMilestones(
  goal: Goal,
  start: BucketSnapshot,
  inflow: BucketInflow,
  extraYieldPMT: number,
  snaps: Snapshot[],
  today = new Date().toISOString().slice(0, 10),
): Milestone[] {
  const startYear = Number(today.slice(0, 4));
  const endYear = Number(goal.target_date.slice(0, 4));
  const result: Milestone[] = [];
  for (let y = startYear + 1; y <= endYear; y++) {
    const dateISO = `${y}-12-31`;
    const months = Math.max(0, monthsBetween(today, dateISO));
    const proj = projectBuckets(
      start,
      inflow,
      {
        yieldAnnual: goal.expected_annual_return,
        realestateAnnual: goal.realestate_annual_return,
        extraYieldPMT,
      },
      months,
    );
    const actual = findSnapshotOnOrBefore(snaps, dateISO);
    result.push({
      year: y,
      dateISO,
      targetValue: proj.total,
      actualValue: actual?.total_cny ?? null,
    });
  }
  return result;
}

function findSnapshotOnOrBefore(
  snaps: Snapshot[],
  dateISO: string,
): Snapshot | null {
  const today = new Date().toISOString().slice(0, 10);
  if (dateISO > today) return null;
  const ordered = [...snaps].sort((a, b) =>
    a.snapshot_at.localeCompare(b.snapshot_at),
  );
  let best: Snapshot | null = null;
  for (const s of ordered) {
    const d = (s.snapshot_date || s.snapshot_at.slice(0, 10)) as string;
    if (d <= dateISO) best = s;
    else break;
  }
  return best;
}
