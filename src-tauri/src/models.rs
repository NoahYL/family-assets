use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: i64,
    pub name: String,
    pub institution: String,
    /// bank | broker | payment | insurance | realestate | gold | custom
    #[serde(rename = "type")]
    pub kind: String,
    pub currency: String,
    /// 持有人：柳哥 / 刘总 / 共有
    pub owner: String,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountInput {
    pub name: String,
    pub institution: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub currency: String,
    pub owner: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Instrument {
    pub id: i64,
    pub symbol: String,
    pub name: String,
    /// cash | stock | fund | bond | gold | realestate | insurance | other
    pub asset_class: String,
    /// CN | HK | US | null
    pub market: Option<String>,
    pub currency: String,
    /// sina_cn | sina_hk | sina_us | tiantian | gold | manual
    pub quote_source: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstrumentInput {
    pub symbol: String,
    pub name: String,
    pub asset_class: String,
    pub market: Option<String>,
    pub currency: String,
    pub quote_source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Holding {
    pub id: i64,
    pub account_id: i64,
    pub instrument_id: i64,
    pub quantity: f64,
    pub cost: f64,
    pub manual_price: Option<f64>,
    pub multiplier: f64,
    pub note: Option<String>,
    /// 每月按此金额（CNY）自动累积到 quantity/cost。0 表示不启用。
    pub monthly_accrual_cny: f64,
    /// 上次结算的月份（'YYYY-MM'）。None 表示未开启累积。
    pub accrual_cursor: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HoldingInput {
    pub account_id: i64,
    pub instrument_id: i64,
    pub quantity: f64,
    pub cost: f64,
    pub manual_price: Option<f64>,
    pub multiplier: f64,
    pub note: Option<String>,
    #[serde(default)]
    pub monthly_accrual_cny: f64,
    #[serde(default)]
    pub accrual_cursor: Option<String>,
}

/// 持仓视图，带上品种 / 账户 / 最新价 / 市值
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HoldingView {
    pub id: i64,
    pub account_id: i64,
    pub account_name: String,
    pub institution: String,
    pub instrument_id: i64,
    pub symbol: String,
    pub instrument_name: String,
    pub asset_class: String,
    pub market: Option<String>,
    pub currency: String,
    pub quantity: f64,
    pub cost: f64,
    pub multiplier: f64,
    pub price: Option<f64>,       // 原币种
    pub price_fetched_at: Option<String>,
    pub market_value: f64,         // 原币种
    pub market_value_cny: f64,     // 换算人民币
    pub pnl_cny: f64,
    pub pnl_pct: f64,
    pub manual_price: Option<f64>,
    pub note: Option<String>,
    pub monthly_accrual_cny: f64,
    pub accrual_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub id: i64,
    pub snapshot_at: String,
    pub snapshot_date: Option<String>,
    pub snapshot_month: Option<String>,
    pub total_cny: f64,
    pub total_by_class_json: String,
    pub total_by_account_json: String,
    pub total_by_currency_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardSummary {
    pub total_cny: f64,
    pub total_cost_cny: f64,
    pub pnl_cny: f64,
    pub pnl_pct: f64,
    pub by_class: Vec<BucketItem>,
    pub by_account: Vec<BucketItem>,
    pub by_currency: Vec<BucketItem>,
    pub by_owner: Vec<BucketItem>,
    pub last_refreshed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BucketItem {
    pub key: String,
    pub label: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshReport {
    pub refreshed: usize,
    pub failed: Vec<RefreshFailure>,
    pub snapshot_id: i64,
    pub total_cny: f64,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshFailure {
    pub symbol: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FxRate {
    pub base: String,
    pub quote: String,
    pub rate: f64,
    pub fetched_at: String,
}

// ====== 股票/基金买卖交易日志 ======

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockTrade {
    pub id: i64,
    pub account_id: i64,
    pub instrument_id: i64,
    /// buy | sell
    pub side: String,
    pub quantity: f64,
    pub price_per_share: f64,
    pub trade_date: String,
    pub currency: String,
    pub cash_holding_id: Option<i64>,
    pub realized_pnl: Option<f64>,
    pub avg_cost_at_trade: Option<f64>,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockTradeInput {
    pub account_id: i64,
    pub instrument_id: i64,
    pub quantity: f64,
    pub price_per_share: f64,
    pub trade_date: String,
    pub cash_holding_id: Option<i64>,
    pub note: Option<String>,
}

/// 带展示用元数据的交易视图
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockTradeView {
    pub id: i64,
    pub account_id: i64,
    pub account_name: String,
    pub account_owner: String,
    pub instrument_id: i64,
    pub instrument_symbol: String,
    pub instrument_name: String,
    pub side: String,
    pub quantity: f64,
    pub price_per_share: f64,
    pub total: f64,
    pub trade_date: String,
    pub currency: String,
    pub cash_holding_id: Option<i64>,
    pub realized_pnl: Option<f64>,
    pub avg_cost_at_trade: Option<f64>,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ====== 期权交易日志（Wheel 策略）======

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionTrade {
    pub id: i64,
    pub account_id: i64,
    pub underlying_instrument_id: Option<i64>,
    pub underlying_symbol: String,
    /// sell_put | covered_call
    pub strategy: String,
    /// put | call
    pub option_type: String,
    pub strike: f64,
    /// YYYY-MM-DD
    pub expiration: String,
    pub contracts: f64,
    pub multiplier: i64,
    pub premium_per_share: f64,
    pub open_date: String,
    pub currency: String,
    pub cash_holding_id: Option<i64>,
    /// open | expired | assigned | closed | rolled
    pub status: String,
    pub close_date: Option<String>,
    pub close_price_per_share: Option<f64>,
    pub realized_pnl: Option<f64>,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 新建/编辑期权交易的输入（开仓字段）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionTradeInput {
    pub account_id: i64,
    pub underlying_instrument_id: Option<i64>,
    pub underlying_symbol: String,
    pub strategy: String,
    pub option_type: String,
    pub strike: f64,
    pub expiration: String,
    pub contracts: f64,
    #[serde(default = "default_multiplier")]
    pub multiplier: i64,
    pub premium_per_share: f64,
    pub open_date: String,
    pub currency: String,
    pub cash_holding_id: Option<i64>,
    pub note: Option<String>,
}

fn default_multiplier() -> i64 {
    100
}

/// 平仓输入
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionCloseInput {
    pub close_date: String,
    pub close_price_per_share: f64,
}

/// 列表视图：附加账户名称、标的当前价（可选）等便于展示
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionTradeView {
    pub id: i64,
    pub account_id: i64,
    pub account_name: String,
    pub account_owner: String,
    pub underlying_instrument_id: Option<i64>,
    pub underlying_symbol: String,
    pub underlying_price: Option<f64>,
    pub strategy: String,
    pub option_type: String,
    pub strike: f64,
    pub expiration: String,
    pub contracts: f64,
    pub multiplier: i64,
    pub premium_per_share: f64,
    pub premium_total: f64,
    pub open_date: String,
    pub currency: String,
    pub cash_holding_id: Option<i64>,
    pub status: String,
    pub close_date: Option<String>,
    pub close_price_per_share: Option<f64>,
    pub realized_pnl: Option<f64>,
    /// 保证金占用：sell_put = strike × 100 × contracts，covered_call = 标的股价 × 100 × contracts（没股价就 0）
    pub margin_hold: f64,
    /// 安全边际：(当前价 - 行权价)/行权价，sell_put 越大越安全；covered_call 用(行权价-当前价)/当前价
    pub safety_margin_pct: Option<f64>,
    pub days_to_expiration: i64,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 期权策略仪表盘
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionDashboard {
    /// 已实现权利金净收入（CNY）：作废的 +全额，平仓/被行权/滚动的 +realized_pnl
    pub realized_pnl_cny: f64,
    /// 在途权利金（CNY）：open 状态的 premium_total 加总
    pub open_premium_cny: f64,
    /// 占用保证金（CNY）：所有 open 状态的 margin_hold 加总
    pub margin_hold_cny: f64,
    /// open 数量
    pub open_count: i64,
    /// 所有已结束单子的统计：胜率 = 盈利单 / 总结束单数
    pub win_rate: Option<f64>,
    pub closed_count: i64,
}

// ====== 攒钱目标 ======

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Goal {
    pub id: i64,
    pub name: String,
    pub target_amount: f64,
    pub target_date: String,
    pub start_amount: f64,
    pub start_date: String,
    /// 生息资产年化（股票/基金/债券/黄金/其他），小数表示
    pub expected_annual_return: f64,
    /// 房产年化变化率，可以是负数，小数表示
    pub realestate_annual_return: f64,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalInput {
    pub name: String,
    pub target_amount: f64,
    pub target_date: String,
    pub start_amount: f64,
    pub start_date: String,
    pub expected_annual_return: f64,
    pub realestate_annual_return: f64,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quote {
    pub symbol: String,
    pub price: f64,
    pub currency: String,
}
