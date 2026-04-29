//! 期权交易日志相关命令
//!
//! 支持 4 种策略：
//! - sell_put / covered_call —— Wheel 卖方策略，开仓收权利金
//! - buy_call / buy_put       —— 裸买方向性策略，开仓付权利金
//!
//! 核心设计（用 cash_flow_sign 统一处理方向）：
//! - 期权本身不作为"持仓资产"计入总资产，所有经济活动通过 cash_holding 联动
//! - sign = +1（卖方）：开仓收钱、平仓花钱、作废赚全额、被行权赚全额
//! - sign = -1（买方）：开仓花钱、平仓收钱、作废全损、被行权全损（行权后用户手动调标的）
//! - realized_pnl = sign × (premium_total - close_total) 平仓
//! - realized_pnl = sign × premium_total                作废 / 被行权
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::{
    OptionCloseInput, OptionDashboard, OptionTrade, OptionTradeInput, OptionTradeView,
};
use chrono::{Local, NaiveDate};
use rusqlite::params;
use std::collections::HashMap;
use tauri::State;

const SELECT_TRADE: &str = "SELECT id, account_id, underlying_instrument_id, underlying_symbol,
         strategy, option_type, strike, expiration, contracts, multiplier,
         premium_per_share, open_date, currency, cash_holding_id,
         status, close_date, close_price_per_share, realized_pnl, note,
         created_at, updated_at
         FROM option_trades WHERE id = ?1";

/// 现金流方向：卖方收钱开仓返 +1，买方付钱开仓返 -1
fn cash_flow_sign(strategy: &str) -> f64 {
    match strategy {
        "sell_put" | "covered_call" => 1.0,
        "buy_call" | "buy_put" => -1.0,
        _ => 0.0,
    }
}

/// 校验 strategy + option_type 的合法组合
fn validate_strategy(strategy: &str, option_type: &str) -> AppResult<()> {
    let ok = match (strategy, option_type) {
        ("sell_put", "put") => true,
        ("covered_call", "call") => true,
        ("buy_call", "call") => true,
        ("buy_put", "put") => true,
        _ => false,
    };
    if !ok {
        return Err(AppError::Msg(format!(
            "策略 {strategy} 与方向 {option_type} 不匹配"
        )));
    }
    Ok(())
}

fn row_to_trade(r: &rusqlite::Row) -> rusqlite::Result<OptionTrade> {
    Ok(OptionTrade {
        id: r.get(0)?,
        account_id: r.get(1)?,
        underlying_instrument_id: r.get(2)?,
        underlying_symbol: r.get(3)?,
        strategy: r.get(4)?,
        option_type: r.get(5)?,
        strike: r.get(6)?,
        expiration: r.get(7)?,
        contracts: r.get(8)?,
        multiplier: r.get(9)?,
        premium_per_share: r.get(10)?,
        open_date: r.get(11)?,
        currency: r.get(12)?,
        cash_holding_id: r.get(13)?,
        status: r.get(14)?,
        close_date: r.get(15)?,
        close_price_per_share: r.get(16)?,
        realized_pnl: r.get(17)?,
        note: r.get(18)?,
        created_at: r.get(19)?,
        updated_at: r.get(20)?,
    })
}

/// 列表视图：联表账户 + 标的最新价，并算出 premium_total / margin_hold / 安全边际 / 剩余天数
#[tauri::command]
pub fn list_option_trades(db: State<'_, Db>) -> AppResult<Vec<OptionTradeView>> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT t.id, t.account_id, a.name, a.owner,
                t.underlying_instrument_id, t.underlying_symbol, p.price,
                t.strategy, t.option_type, t.strike, t.expiration,
                t.contracts, t.multiplier, t.premium_per_share,
                t.open_date, t.currency, t.cash_holding_id,
                t.status, t.close_date, t.close_price_per_share, t.realized_pnl,
                t.note, t.created_at, t.updated_at
         FROM option_trades t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN prices p ON p.instrument_id = t.underlying_instrument_id
         ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END,
                  t.expiration ASC, t.id DESC",
    )?;
    let today = Local::now().date_naive();
    let rows = stmt
        .query_map([], |r| {
            let strategy: String = r.get(7)?;
            let strike: f64 = r.get(9)?;
            let contracts: f64 = r.get(11)?;
            let multiplier: i64 = r.get(12)?;
            let premium_per_share: f64 = r.get(13)?;
            let underlying_price: Option<f64> = r.get(6)?;
            let expiration: String = r.get(10)?;

            let premium_total = premium_per_share * contracts * multiplier as f64;

            // 保证金占用：仅卖方策略需要；买方已付权利金，无额外占用
            let margin_hold = match strategy.as_str() {
                "sell_put" => strike * contracts * multiplier as f64,
                "covered_call" => {
                    let ref_price = underlying_price.unwrap_or(strike);
                    ref_price * contracts * multiplier as f64
                }
                _ => 0.0,
            };

            // 安全边际 / 价值度
            // - sell_put: (现价-行权价)/行权价，越大越安全
            // - covered_call: (行权价-现价)/现价，越大越安全
            // - buy_call: (现价-行权价)/行权价，正数表示已 ITM
            // - buy_put: (行权价-现价)/行权价，正数表示已 ITM
            let safety = underlying_price.map(|p| match strategy.as_str() {
                "sell_put" => (p - strike) / strike,
                "covered_call" => (strike - p) / p,
                "buy_call" => (p - strike) / strike,
                "buy_put" => (strike - p) / strike,
                _ => 0.0,
            });

            let dte = NaiveDate::parse_from_str(&expiration, "%Y-%m-%d")
                .map(|d| (d - today).num_days())
                .unwrap_or(0);

            Ok(OptionTradeView {
                id: r.get(0)?,
                account_id: r.get(1)?,
                account_name: r.get(2)?,
                account_owner: r.get(3)?,
                underlying_instrument_id: r.get(4)?,
                underlying_symbol: r.get(5)?,
                underlying_price,
                strategy,
                option_type: r.get(8)?,
                strike,
                expiration,
                contracts,
                multiplier,
                premium_per_share,
                premium_total,
                open_date: r.get(14)?,
                currency: r.get(15)?,
                cash_holding_id: r.get(16)?,
                status: r.get(17)?,
                close_date: r.get(18)?,
                close_price_per_share: r.get(19)?,
                realized_pnl: r.get(20)?,
                margin_hold,
                safety_margin_pct: safety,
                days_to_expiration: dte,
                note: r.get(21)?,
                created_at: r.get(22)?,
                updated_at: r.get(23)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// 开仓：插入记录 + 把权利金加到 cash_holding（如果指定了）
#[tauri::command]
pub fn create_option_trade(
    db: State<'_, Db>,
    input: OptionTradeInput,
) -> AppResult<OptionTrade> {
    let conn = db.conn.lock().unwrap();
    validate_strategy(&input.strategy, &input.option_type)?;
    let sign = cash_flow_sign(&input.strategy);
    let premium_total = input.premium_per_share * input.contracts * input.multiplier as f64;

    // 买方开仓：要求联动现金 + 余额够付权利金
    if sign < 0.0 {
        let cash_id = input
            .cash_holding_id
            .ok_or_else(|| AppError::Msg("买方开仓必须选择联动现金持仓".into()))?;
        let cash_qty: f64 = conn.query_row(
            "SELECT quantity FROM holdings WHERE id = ?1",
            [cash_id],
            |r| r.get(0),
        ).map_err(|_| AppError::Msg("联动的现金持仓不存在".into()))?;
        if cash_qty + 1e-9 < premium_total {
            return Err(AppError::Msg(format!(
                "现金余额 {:.2} 不足以支付权利金（需要 {:.2}）",
                cash_qty, premium_total
            )));
        }
    }

    conn.execute(
        "INSERT INTO option_trades
          (account_id, underlying_instrument_id, underlying_symbol, strategy, option_type,
           strike, expiration, contracts, multiplier, premium_per_share, open_date,
           currency, cash_holding_id, note)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
        params![
            input.account_id,
            input.underlying_instrument_id,
            input.underlying_symbol,
            input.strategy,
            input.option_type,
            input.strike,
            input.expiration,
            input.contracts,
            input.multiplier,
            input.premium_per_share,
            input.open_date,
            input.currency,
            input.cash_holding_id,
            input.note,
        ],
    )?;
    let id = conn.last_insert_rowid();

    // 卖方：cash += premium；买方：cash -= premium
    if let Some(cash_id) = input.cash_holding_id {
        let delta = sign * premium_total;
        conn.execute(
            "UPDATE holdings
               SET quantity = quantity + ?1,
                   cost     = cost + ?1,
                   updated_at = datetime('now')
             WHERE id = ?2",
            params![delta, cash_id],
        )?;
    }

    conn.query_row(SELECT_TRADE, [id], row_to_trade)
        .map_err(Into::into)
}

/// 修改期权"元数据"（不改状态、不做联动），用于开仓后改备注、改行权价等笔误
#[tauri::command]
pub fn update_option_trade(
    db: State<'_, Db>,
    id: i64,
    input: OptionTradeInput,
) -> AppResult<OptionTrade> {
    let conn = db.conn.lock().unwrap();
    validate_strategy(&input.strategy, &input.option_type)?;
    // 读旧权利金 + 旧策略，计算差额并调整现金 holding
    let (old_premium_total, old_cash_id, old_strategy): (f64, Option<i64>, String) = conn.query_row(
        "SELECT premium_per_share * contracts * multiplier, cash_holding_id, strategy
         FROM option_trades WHERE id = ?1",
        [id],
        |r| Ok((r.get::<_, f64>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, String>(2)?)),
    )?;
    let old_sign = cash_flow_sign(&old_strategy);
    let new_sign = cash_flow_sign(&input.strategy);

    conn.execute(
        "UPDATE option_trades SET
           account_id=?1, underlying_instrument_id=?2, underlying_symbol=?3,
           strategy=?4, option_type=?5, strike=?6, expiration=?7,
           contracts=?8, multiplier=?9, premium_per_share=?10,
           open_date=?11, currency=?12, cash_holding_id=?13, note=?14,
           updated_at=datetime('now')
         WHERE id=?15",
        params![
            input.account_id,
            input.underlying_instrument_id,
            input.underlying_symbol,
            input.strategy,
            input.option_type,
            input.strike,
            input.expiration,
            input.contracts,
            input.multiplier,
            input.premium_per_share,
            input.open_date,
            input.currency,
            input.cash_holding_id,
            input.note,
            id,
        ],
    )?;

    // 只有 open 状态才联动现金（已结束的改元数据只是补录，不应该动现金）
    let new_premium_total =
        input.premium_per_share * input.contracts * input.multiplier as f64;
    let status: String = conn.query_row(
        "SELECT status FROM option_trades WHERE id = ?1",
        [id],
        |r| r.get(0),
    )?;
    if status == "open" {
        // 旧现金回退（按旧 sign 反向冲销）
        if let Some(cash) = old_cash_id {
            let undo = old_sign * old_premium_total;
            conn.execute(
                "UPDATE holdings SET quantity = quantity - ?1, cost = cost - ?1,
                   updated_at=datetime('now') WHERE id = ?2",
                params![undo, cash],
            )?;
        }
        // 新现金按新 sign 入账
        if let Some(cash) = input.cash_holding_id {
            let delta = new_sign * new_premium_total;
            conn.execute(
                "UPDATE holdings SET quantity = quantity + ?1, cost = cost + ?1,
                   updated_at=datetime('now') WHERE id = ?2",
                params![delta, cash],
            )?;
        }
    }

    conn.query_row(SELECT_TRADE, [id], row_to_trade)
        .map_err(Into::into)
}

/// 标记"到期作废"：不动 cash（开仓时已结清）；
/// realized_pnl = sign × premium_total
/// - 卖方：+premium（吃下全部权利金）
/// - 买方：-premium（权利金全损）
#[tauri::command]
pub fn mark_option_expired(db: State<'_, Db>, id: i64) -> AppResult<OptionTrade> {
    let conn = db.conn.lock().unwrap();
    let (premium, contracts, mult, strategy): (f64, f64, i64, String) = conn.query_row(
        "SELECT premium_per_share, contracts, multiplier, strategy
         FROM option_trades WHERE id = ?1 AND status = 'open'",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    let realized = cash_flow_sign(&strategy) * premium * contracts * mult as f64;
    let today = Local::now().format("%Y-%m-%d").to_string();
    conn.execute(
        "UPDATE option_trades
           SET status='expired', close_date=?1, realized_pnl=?2, updated_at=datetime('now')
         WHERE id=?3",
        params![today, realized, id],
    )?;
    conn.query_row(SELECT_TRADE, [id], row_to_trade)
        .map_err(Into::into)
}

/// 平仓：
/// - 卖方（buy to close）：付出 close_total → cash -= close_total
/// - 买方（sell to close）：收到 close_total → cash += close_total
/// realized_pnl = sign × (premium_total - close_total)
#[tauri::command]
pub fn close_option_trade(
    db: State<'_, Db>,
    id: i64,
    input: OptionCloseInput,
) -> AppResult<OptionTrade> {
    let conn = db.conn.lock().unwrap();
    let (premium, contracts, mult, cash_id, strategy): (f64, f64, i64, Option<i64>, String) =
        conn.query_row(
            "SELECT premium_per_share, contracts, multiplier, cash_holding_id, strategy
             FROM option_trades WHERE id = ?1 AND status = 'open'",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )?;
    let sign = cash_flow_sign(&strategy);
    let premium_total = premium * contracts * mult as f64;
    let close_total = input.close_price_per_share * contracts * mult as f64;
    let realized = sign * (premium_total - close_total);

    // 现金联动：卖方减 close_total，买方加 close_total（即 -sign × close_total）
    if let Some(cash) = cash_id {
        let delta = -sign * close_total;
        conn.execute(
            "UPDATE holdings SET quantity = quantity + ?1, cost = cost + ?1,
               updated_at=datetime('now') WHERE id = ?2",
            params![delta, cash],
        )?;
    }

    conn.execute(
        "UPDATE option_trades
           SET status='closed', close_date=?1, close_price_per_share=?2,
               realized_pnl=?3, updated_at=datetime('now')
         WHERE id=?4",
        params![input.close_date, input.close_price_per_share, realized, id],
    )?;
    conn.query_row(SELECT_TRADE, [id], row_to_trade)
        .map_err(Into::into)
}

/// 标记"被行权"：realized_pnl = sign × premium_total
/// - 卖方被行权：吃下权利金（标的转手价格 = strike，由用户在持仓页手动调）
/// - 买方行权：权利金已付，PnL = -premium；额外的标的腿请在持仓页手动加/减股
#[tauri::command]
pub fn mark_option_assigned(db: State<'_, Db>, id: i64) -> AppResult<OptionTrade> {
    let conn = db.conn.lock().unwrap();
    let (premium, contracts, mult, strategy): (f64, f64, i64, String) = conn.query_row(
        "SELECT premium_per_share, contracts, multiplier, strategy
         FROM option_trades WHERE id = ?1 AND status = 'open'",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    let realized = cash_flow_sign(&strategy) * premium * contracts * mult as f64;
    let today = Local::now().format("%Y-%m-%d").to_string();
    conn.execute(
        "UPDATE option_trades
           SET status='assigned', close_date=?1, realized_pnl=?2, updated_at=datetime('now')
         WHERE id=?3",
        params![today, realized, id],
    )?;
    conn.query_row(SELECT_TRADE, [id], row_to_trade)
        .map_err(Into::into)
}

/// 标记"已滚动"：等同于一次平仓（按 sign 联动现金 + 算 pnl），再手动开新单
#[tauri::command]
pub fn mark_option_rolled(
    db: State<'_, Db>,
    id: i64,
    input: OptionCloseInput,
) -> AppResult<OptionTrade> {
    let conn = db.conn.lock().unwrap();
    let (premium, contracts, mult, cash_id, strategy): (f64, f64, i64, Option<i64>, String) =
        conn.query_row(
            "SELECT premium_per_share, contracts, multiplier, cash_holding_id, strategy
             FROM option_trades WHERE id = ?1 AND status = 'open'",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )?;
    let sign = cash_flow_sign(&strategy);
    let premium_total = premium * contracts * mult as f64;
    let close_total = input.close_price_per_share * contracts * mult as f64;
    let realized = sign * (premium_total - close_total);
    if let Some(cash) = cash_id {
        let delta = -sign * close_total;
        conn.execute(
            "UPDATE holdings SET quantity = quantity + ?1, cost = cost + ?1,
               updated_at=datetime('now') WHERE id = ?2",
            params![delta, cash],
        )?;
    }
    conn.execute(
        "UPDATE option_trades
           SET status='rolled', close_date=?1, close_price_per_share=?2,
               realized_pnl=?3, updated_at=datetime('now')
         WHERE id=?4",
        params![input.close_date, input.close_price_per_share, realized, id],
    )?;
    conn.query_row(SELECT_TRADE, [id], row_to_trade)
        .map_err(Into::into)
}

/// 删除：如果状态是 open 且绑了 cash_holding，按当时 sign 反向冲销现金
#[tauri::command]
pub fn delete_option_trade(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    let row: Option<(String, f64, Option<i64>, String)> = conn
        .query_row(
            "SELECT status, premium_per_share * contracts * multiplier, cash_holding_id, strategy
             FROM option_trades WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok();
    if let Some((status, premium_total, cash_id, strategy)) = row {
        if status == "open" {
            if let Some(cash) = cash_id {
                // 撤销开仓时的 sign × premium 入账
                let undo = cash_flow_sign(&strategy) * premium_total;
                conn.execute(
                    "UPDATE holdings SET quantity = quantity - ?1, cost = cost - ?1,
                       updated_at=datetime('now') WHERE id = ?2",
                    params![undo, cash],
                )?;
            }
        }
    }
    conn.execute("DELETE FROM option_trades WHERE id = ?1", [id])?;
    Ok(())
}

/// 仪表盘：把所有期权的 realized/open/margin 按币种换算成 CNY
#[tauri::command]
pub fn get_option_dashboard(db: State<'_, Db>) -> AppResult<OptionDashboard> {
    let conn = db.conn.lock().unwrap();

    // FX
    let mut fx: HashMap<String, f64> = HashMap::new();
    fx.insert("CNY".into(), 1.0);
    {
        let mut stmt = conn.prepare("SELECT base, rate FROM fx_rates WHERE quote='CNY'")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))?;
        for row in rows {
            let (b, r) = row?;
            fx.insert(b, r);
        }
    }

    // 遍历 trades
    let mut realized_cny = 0.0;
    let mut open_premium_cny = 0.0;
    let mut margin_cny = 0.0;
    let mut open_count = 0i64;
    let mut closed_count = 0i64;
    let mut win_count = 0i64;

    let mut stmt = conn.prepare(
        "SELECT t.status, t.strategy, t.strike, t.contracts, t.multiplier,
                t.premium_per_share, t.realized_pnl, t.currency,
                p.price
         FROM option_trades t
         LEFT JOIN prices p ON p.instrument_id = t.underlying_instrument_id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, f64>(2)?,
            r.get::<_, f64>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, f64>(5)?,
            r.get::<_, Option<f64>>(6)?,
            r.get::<_, String>(7)?,
            r.get::<_, Option<f64>>(8)?,
        ))
    })?;
    for row in rows {
        let (status, strategy, strike, contracts, mult, premium_ps, realized, ccy, price) = row?;
        let rate = *fx.get(&ccy).unwrap_or(&1.0);
        let sign = cash_flow_sign(&strategy);
        let premium_total = premium_ps * contracts * mult as f64 * rate;
        match status.as_str() {
            "open" => {
                // 卖方在途 +premium，买方在途 -premium（已付出未结算）
                open_premium_cny += sign * premium_total;
                open_count += 1;
                let margin = match strategy.as_str() {
                    "sell_put" => strike * contracts * mult as f64 * rate,
                    "covered_call" => {
                        let ref_p = price.unwrap_or(strike);
                        ref_p * contracts * mult as f64 * rate
                    }
                    _ => 0.0, // 买方无保证金占用
                };
                margin_cny += margin;
            }
            _ => {
                closed_count += 1;
                let r = realized.unwrap_or(0.0) * rate;
                realized_cny += r;
                if r > 0.0 {
                    win_count += 1;
                }
            }
        }
    }

    let win_rate = if closed_count > 0 {
        Some(win_count as f64 / closed_count as f64)
    } else {
        None
    };

    Ok(OptionDashboard {
        realized_pnl_cny: realized_cny,
        open_premium_cny,
        margin_hold_cny: margin_cny,
        open_count,
        win_rate,
        closed_count,
    })
}
