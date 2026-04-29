//! 股票/基金买卖交易日志
//!
//! 核心设计（保证总资产自洽）：
//! - 买入：stock holding.quantity += qty, cost += total；cash holding.quantity -= total, cost -= total（pnl 守恒）
//! - 卖出：先算当时 avg_cost = holding.cost / holding.quantity，记入 avg_cost_at_trade；
//!         stock holding.quantity -= qty, cost -= avg_cost × qty（按比例抽出成本）；
//!         若 quantity ≈ 0 则删除该 holding；
//!         cash holding.quantity += total, cost += total；
//!         realized_pnl = (price - avg_cost) × qty（原币种）
//! - 删除买入：逆向（stock 扣回, cash 补回）
//! - 删除卖出：逆向（stock 按 avg_cost_at_trade 补回, cash 扣回）；若 stock holding 已不存在则重建
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::{StockTrade, StockTradeInput, StockTradeView};
use rusqlite::params;
use tauri::State;

const QTY_EPS: f64 = 1e-9;

const SELECT_TRADE: &str = "SELECT id, account_id, instrument_id, side, quantity, price_per_share,
         trade_date, currency, cash_holding_id, realized_pnl, avg_cost_at_trade, note,
         created_at, updated_at
         FROM stock_trades WHERE id = ?1";

fn row_to_trade(r: &rusqlite::Row) -> rusqlite::Result<StockTrade> {
    Ok(StockTrade {
        id: r.get(0)?,
        account_id: r.get(1)?,
        instrument_id: r.get(2)?,
        side: r.get(3)?,
        quantity: r.get(4)?,
        price_per_share: r.get(5)?,
        trade_date: r.get(6)?,
        currency: r.get(7)?,
        cash_holding_id: r.get(8)?,
        realized_pnl: r.get(9)?,
        avg_cost_at_trade: r.get(10)?,
        note: r.get(11)?,
        created_at: r.get(12)?,
        updated_at: r.get(13)?,
    })
}

#[tauri::command]
pub fn list_stock_trades(db: State<'_, Db>) -> AppResult<Vec<StockTradeView>> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT t.id, t.account_id, a.name, a.owner,
                t.instrument_id, i.symbol, i.name,
                t.side, t.quantity, t.price_per_share, t.trade_date, t.currency,
                t.cash_holding_id, t.realized_pnl, t.avg_cost_at_trade,
                t.note, t.created_at, t.updated_at
         FROM stock_trades t
         JOIN accounts a ON a.id = t.account_id
         JOIN instruments i ON i.id = t.instrument_id
         ORDER BY t.trade_date DESC, t.id DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let qty: f64 = r.get(8)?;
            let price: f64 = r.get(9)?;
            Ok(StockTradeView {
                id: r.get(0)?,
                account_id: r.get(1)?,
                account_name: r.get(2)?,
                account_owner: r.get(3)?,
                instrument_id: r.get(4)?,
                instrument_symbol: r.get(5)?,
                instrument_name: r.get(6)?,
                side: r.get(7)?,
                quantity: qty,
                price_per_share: price,
                total: qty * price,
                trade_date: r.get(10)?,
                currency: r.get(11)?,
                cash_holding_id: r.get(12)?,
                realized_pnl: r.get(13)?,
                avg_cost_at_trade: r.get(14)?,
                note: r.get(15)?,
                created_at: r.get(16)?,
                updated_at: r.get(17)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// 买入：记录 + 增股 + 扣现金
#[tauri::command]
pub fn record_stock_buy(db: State<'_, Db>, input: StockTradeInput) -> AppResult<StockTrade> {
    let conn = db.conn.lock().unwrap();
    if input.quantity <= 0.0 || input.price_per_share < 0.0 {
        return Err(AppError::Msg("数量必须 > 0，价格必须 ≥ 0".into()));
    }
    let total = input.quantity * input.price_per_share;

    // 币种：从标的拿
    let currency: String = conn.query_row(
        "SELECT currency FROM instruments WHERE id = ?1",
        [input.instrument_id],
        |r| r.get(0),
    )?;

    // 必须联动现金持仓（同账户同币种），且余额要够
    let cash_id = input
        .cash_holding_id
        .ok_or_else(|| AppError::Msg("买入必须选择联动现金持仓".into()))?;
    let (cash_qty, cash_acct): (f64, i64) = conn.query_row(
        "SELECT quantity, account_id FROM holdings WHERE id = ?1",
        [cash_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).map_err(|_| AppError::Msg("联动的现金持仓不存在".into()))?;
    if cash_acct != input.account_id {
        return Err(AppError::Msg(
            "联动的现金持仓必须属于同一个账户".into(),
        ));
    }
    if cash_qty + QTY_EPS < total {
        return Err(AppError::Msg(format!(
            "现金余额 {:.2} 不足以买入（需要 {:.2}）",
            cash_qty, total
        )));
    }

    // 插交易
    conn.execute(
        "INSERT INTO stock_trades
          (account_id, instrument_id, side, quantity, price_per_share, trade_date,
           currency, cash_holding_id, note)
         VALUES (?1,?2,'buy',?3,?4,?5,?6,?7,?8)",
        params![
            input.account_id,
            input.instrument_id,
            input.quantity,
            input.price_per_share,
            input.trade_date,
            currency,
            input.cash_holding_id,
            input.note,
        ],
    )?;
    let id = conn.last_insert_rowid();

    // 股票 holding：upsert
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM holdings WHERE account_id = ?1 AND instrument_id = ?2",
            params![input.account_id, input.instrument_id],
            |r| r.get(0),
        )
        .ok();
    match existing {
        Some(hid) => {
            conn.execute(
                "UPDATE holdings
                   SET quantity = quantity + ?1,
                       cost     = cost + ?2,
                       updated_at = datetime('now')
                 WHERE id = ?3",
                params![input.quantity, total, hid],
            )?;
        }
        None => {
            conn.execute(
                "INSERT INTO holdings
                   (account_id, instrument_id, quantity, cost, multiplier)
                 VALUES (?1, ?2, ?3, ?4, 1)",
                params![input.account_id, input.instrument_id, input.quantity, total],
            )?;
        }
    }

    // 扣现金（上面已确认 cash_id 存在且余额足够）
    conn.execute(
        "UPDATE holdings
           SET quantity = quantity - ?1,
               cost     = cost - ?1,
               updated_at = datetime('now')
         WHERE id = ?2",
        params![total, cash_id],
    )?;

    conn.query_row(SELECT_TRADE, [id], row_to_trade)
        .map_err(Into::into)
}

/// 卖出：记录 + 减股（按比例抽成本）+ 加现金 + 记 realized_pnl
#[tauri::command]
pub fn record_stock_sell(db: State<'_, Db>, input: StockTradeInput) -> AppResult<StockTrade> {
    let conn = db.conn.lock().unwrap();
    if input.quantity <= 0.0 || input.price_per_share < 0.0 {
        return Err(AppError::Msg("数量必须 > 0，价格必须 ≥ 0".into()));
    }

    // 读现持仓
    let (hid, cur_qty, cur_cost): (i64, f64, f64) = conn.query_row(
        "SELECT id, quantity, cost FROM holdings
         WHERE account_id = ?1 AND instrument_id = ?2",
        params![input.account_id, input.instrument_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).map_err(|_| AppError::Msg("该账户下没有这个品种的持仓，无法卖出".into()))?;

    if input.quantity > cur_qty + QTY_EPS {
        return Err(AppError::Msg(format!(
            "卖出数量 {} 超过持仓 {}", input.quantity, cur_qty
        )));
    }

    let avg_cost = if cur_qty > 0.0 { cur_cost / cur_qty } else { 0.0 };
    let cost_out = avg_cost * input.quantity;
    let total = input.quantity * input.price_per_share;
    let realized = (input.price_per_share - avg_cost) * input.quantity;

    let currency: String = conn.query_row(
        "SELECT currency FROM instruments WHERE id = ?1",
        [input.instrument_id],
        |r| r.get(0),
    )?;

    // 卖出也必须联动现金（收款）
    let cash_id = input
        .cash_holding_id
        .ok_or_else(|| AppError::Msg("卖出必须选择联动现金持仓".into()))?;
    let cash_acct: i64 = conn.query_row(
        "SELECT account_id FROM holdings WHERE id = ?1",
        [cash_id],
        |r| r.get(0),
    ).map_err(|_| AppError::Msg("联动的现金持仓不存在".into()))?;
    if cash_acct != input.account_id {
        return Err(AppError::Msg(
            "联动的现金持仓必须属于同一个账户".into(),
        ));
    }

    // 插交易（记下 avg_cost_at_trade，未来撤销时要用）
    conn.execute(
        "INSERT INTO stock_trades
          (account_id, instrument_id, side, quantity, price_per_share, trade_date,
           currency, cash_holding_id, realized_pnl, avg_cost_at_trade, note)
         VALUES (?1,?2,'sell',?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            input.account_id,
            input.instrument_id,
            input.quantity,
            input.price_per_share,
            input.trade_date,
            currency,
            input.cash_holding_id,
            realized,
            avg_cost,
            input.note,
        ],
    )?;
    let id = conn.last_insert_rowid();

    // 减股
    let new_qty = cur_qty - input.quantity;
    if new_qty.abs() < QTY_EPS {
        conn.execute("DELETE FROM holdings WHERE id = ?1", [hid])?;
    } else {
        conn.execute(
            "UPDATE holdings
               SET quantity = ?1,
                   cost     = ?2,
                   updated_at = datetime('now')
             WHERE id = ?3",
            params![new_qty, cur_cost - cost_out, hid],
        )?;
    }

    // 加现金（卖出收款）
    conn.execute(
        "UPDATE holdings
           SET quantity = quantity + ?1,
               cost     = cost + ?1,
               updated_at = datetime('now')
         WHERE id = ?2",
        params![total, cash_id],
    )?;

    conn.query_row(SELECT_TRADE, [id], row_to_trade)
        .map_err(Into::into)
}

/// 删除交易：逆向所有影响
#[tauri::command]
pub fn delete_stock_trade(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    let (account_id, instrument_id, side, qty, price, cash_id, avg_cost_at_trade):
        (i64, i64, String, f64, f64, Option<i64>, Option<f64>) = conn.query_row(
            "SELECT account_id, instrument_id, side, quantity, price_per_share,
                    cash_holding_id, avg_cost_at_trade
             FROM stock_trades WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )?;
    let total = qty * price;

    match side.as_str() {
        "buy" => {
            // 逆向：减股 + 加现金
            let existing: Option<(i64, f64, f64)> = conn
                .query_row(
                    "SELECT id, quantity, cost FROM holdings
                     WHERE account_id = ?1 AND instrument_id = ?2",
                    params![account_id, instrument_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .ok();
            if let Some((hid, cur_q, cur_c)) = existing {
                let new_q = cur_q - qty;
                // 按原单成本回退（价格 × 数量），和买入时一致
                let new_c = cur_c - total;
                if new_q.abs() < QTY_EPS {
                    conn.execute("DELETE FROM holdings WHERE id = ?1", [hid])?;
                } else if new_q < 0.0 {
                    return Err(AppError::Msg(
                        "无法撤销：当前持仓数量已少于该笔买入".into(),
                    ));
                } else {
                    conn.execute(
                        "UPDATE holdings SET quantity=?1, cost=?2,
                           updated_at=datetime('now') WHERE id=?3",
                        params![new_q, new_c, hid],
                    )?;
                }
            }
            if let Some(cash) = cash_id {
                conn.execute(
                    "UPDATE holdings SET quantity = quantity + ?1, cost = cost + ?1,
                       updated_at=datetime('now') WHERE id = ?2",
                    params![total, cash],
                )?;
            }
        }
        "sell" => {
            // 逆向：加股（按当时 avg_cost）+ 扣现金
            let avg = avg_cost_at_trade.unwrap_or(0.0);
            let cost_back = avg * qty;
            let existing: Option<i64> = conn
                .query_row(
                    "SELECT id FROM holdings
                     WHERE account_id = ?1 AND instrument_id = ?2",
                    params![account_id, instrument_id],
                    |r| r.get(0),
                )
                .ok();
            match existing {
                Some(hid) => {
                    conn.execute(
                        "UPDATE holdings SET quantity = quantity + ?1, cost = cost + ?2,
                           updated_at=datetime('now') WHERE id = ?3",
                        params![qty, cost_back, hid],
                    )?;
                }
                None => {
                    conn.execute(
                        "INSERT INTO holdings
                           (account_id, instrument_id, quantity, cost, multiplier)
                         VALUES (?1, ?2, ?3, ?4, 1)",
                        params![account_id, instrument_id, qty, cost_back],
                    )?;
                }
            }
            if let Some(cash) = cash_id {
                conn.execute(
                    "UPDATE holdings SET quantity = quantity - ?1, cost = cost - ?1,
                       updated_at=datetime('now') WHERE id = ?2",
                    params![total, cash],
                )?;
            }
        }
        _ => return Err(AppError::Msg(format!("未知交易方向: {}", side))),
    }

    conn.execute("DELETE FROM stock_trades WHERE id = ?1", [id])?;
    Ok(())
}
