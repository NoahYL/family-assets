// 与 src-tauri/src/models.rs 保持一致

export type AccountType =
  | "bank"
  | "broker"
  | "payment"
  | "insurance"
  | "realestate"
  | "gold"
  | "custom";

export type AssetClass =
  | "cash"
  | "stock"
  | "fund"
  | "bond"
  | "option"
  | "gold"
  | "realestate"
  | "insurance"
  | "loan"
  | "other";

export type QuoteSource =
  | "sina_cn"
  | "sina_hk"
  | "sina_us"
  | "sina_fx"
  | "sina_gold"
  | "tiantian"
  | "manual";

export interface Account {
  id: number;
  name: string;
  institution: string;
  type: AccountType;
  currency: string;
  owner: string;
  note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountInput {
  name: string;
  institution: string;
  type: AccountType;
  currency: string;
  owner: string;
  note?: string | null;
}

export interface Instrument {
  id: number;
  symbol: string;
  name: string;
  asset_class: AssetClass;
  market?: string | null;
  currency: string;
  quote_source: QuoteSource;
  created_at: string;
}

export interface InstrumentInput {
  symbol: string;
  name: string;
  asset_class: AssetClass;
  market?: string | null;
  currency: string;
  quote_source: QuoteSource;
}

export interface Holding {
  id: number;
  account_id: number;
  instrument_id: number;
  quantity: number;
  cost: number;
  manual_price?: number | null;
  multiplier: number;
  note?: string | null;
  monthly_accrual_cny: number;
  accrual_cursor?: string | null;
  created_at: string;
  updated_at: string;
}

export interface HoldingInput {
  account_id: number;
  instrument_id: number;
  quantity: number;
  cost: number;
  manual_price?: number | null;
  multiplier: number;
  note?: string | null;
  monthly_accrual_cny?: number;
  accrual_cursor?: string | null;
}

export interface HoldingView {
  id: number;
  account_id: number;
  account_name: string;
  institution: string;
  instrument_id: number;
  symbol: string;
  instrument_name: string;
  asset_class: AssetClass;
  market?: string | null;
  currency: string;
  quantity: number;
  cost: number;
  multiplier: number;
  price?: number | null;
  price_fetched_at?: string | null;
  market_value: number;
  market_value_cny: number;
  pnl_cny: number;
  pnl_pct: number;
  manual_price?: number | null;
  note?: string | null;
  monthly_accrual_cny: number;
  accrual_cursor?: string | null;
}

export interface BucketItem {
  key: string;
  label: string;
  value: number;
}

export interface DashboardSummary {
  total_cny: number;
  total_cost_cny: number;
  pnl_cny: number;
  pnl_pct: number;
  by_class: BucketItem[];
  by_account: BucketItem[];
  by_currency: BucketItem[];
  by_owner: BucketItem[];
  last_refreshed_at?: string | null;
}

export interface RefreshFailure {
  symbol: string;
  reason: string;
}

export interface RefreshReport {
  refreshed: number;
  failed: RefreshFailure[];
  snapshot_id: number;
  total_cny: number;
  at: string;
}

// ====== 期权（Wheel 策略）======

export type OptionStrategy = "sell_put" | "covered_call";
export type OptionSide = "put" | "call";
export type OptionStatus = "open" | "expired" | "assigned" | "closed" | "rolled";

export interface OptionTrade {
  id: number;
  account_id: number;
  underlying_instrument_id?: number | null;
  underlying_symbol: string;
  strategy: OptionStrategy;
  option_type: OptionSide;
  strike: number;
  expiration: string;
  contracts: number;
  multiplier: number;
  premium_per_share: number;
  open_date: string;
  currency: string;
  cash_holding_id?: number | null;
  status: OptionStatus;
  close_date?: string | null;
  close_price_per_share?: number | null;
  realized_pnl?: number | null;
  note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OptionTradeInput {
  account_id: number;
  underlying_instrument_id?: number | null;
  underlying_symbol: string;
  strategy: OptionStrategy;
  option_type: OptionSide;
  strike: number;
  expiration: string;
  contracts: number;
  multiplier: number;
  premium_per_share: number;
  open_date: string;
  currency: string;
  cash_holding_id?: number | null;
  note?: string | null;
}

export interface OptionCloseInput {
  close_date: string;
  close_price_per_share: number;
}

export interface OptionTradeView {
  id: number;
  account_id: number;
  account_name: string;
  account_owner: string;
  underlying_instrument_id?: number | null;
  underlying_symbol: string;
  underlying_price?: number | null;
  strategy: OptionStrategy;
  option_type: OptionSide;
  strike: number;
  expiration: string;
  contracts: number;
  multiplier: number;
  premium_per_share: number;
  premium_total: number;
  open_date: string;
  currency: string;
  cash_holding_id?: number | null;
  status: OptionStatus;
  close_date?: string | null;
  close_price_per_share?: number | null;
  realized_pnl?: number | null;
  margin_hold: number;
  safety_margin_pct?: number | null;
  days_to_expiration: number;
  note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OptionDashboard {
  realized_pnl_cny: number;
  open_premium_cny: number;
  margin_hold_cny: number;
  open_count: number;
  win_rate?: number | null;
  closed_count: number;
}

export interface Snapshot {
  id: number;
  snapshot_at: string;
  total_cny: number;
  total_by_class_json: string;
  total_by_account_json: string;
  total_by_currency_json: string;
}
