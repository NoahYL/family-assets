use crate::db::Db;
use crate::error::AppResult;
use crate::models::{Holding, HoldingInput, HoldingView};
use rusqlite::params;
use std::collections::HashMap;
use tauri::State;

/// 获取持仓视图：含账户 / 品种 / 最新价 / 市值 / 浮盈亏（换算人民币）
#[tauri::command]
pub fn list_holdings(db: State<'_, Db>) -> AppResult<Vec<HoldingView>> {
    let conn = db.conn.lock().unwrap();

    // 读 fx 表
    let mut fx: HashMap<String, f64> = HashMap::new();
    fx.insert("CNY".to_string(), 1.0);
    {
        let mut stmt = conn.prepare("SELECT base, rate FROM fx_rates WHERE quote='CNY'")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))?;
        for row in rows {
            let (base, rate) = row?;
            fx.insert(base, rate);
        }
    }

    let sql = "
        SELECT h.id, h.account_id, a.name, a.institution,
               h.instrument_id, i.symbol, i.name, i.asset_class, i.market, i.currency,
               h.quantity, h.cost, h.multiplier, p.price, p.fetched_at,
               h.manual_price, h.note, h.monthly_accrual_cny, h.accrual_cursor
        FROM holdings h
        JOIN accounts a    ON a.id = h.account_id
        JOIN instruments i ON i.id = h.instrument_id
        LEFT JOIN prices p ON p.instrument_id = i.id
        ORDER BY i.asset_class, a.name, i.symbol
    ";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |r| {
        let asset_class: String = r.get(7)?;
        let currency: String = r.get(9)?;
        let quantity: f64 = r.get(10)?;
        let cost: f64 = r.get(11)?;
        let multiplier: f64 = r.get(12)?;
        let price_from_quote: Option<f64> = r.get(13)?;
        let price_fetched_at: Option<String> = r.get(14)?;
        let manual_price: Option<f64> = r.get(15)?;

        // 现金类永远 1:1 计价（1 美元恒等于 1 美元）。没有行情源、没手填 manual_price
        // 时给 1.0 兜底，避免 market_value=0 导致"持有多少就浮亏多少"的假盈亏。
        let price = manual_price.or(price_from_quote).or_else(|| {
            if asset_class == "cash" {
                Some(1.0)
            } else {
                None
            }
        });
        let market_value = price.map(|p| p * quantity * multiplier).unwrap_or(0.0);
        let fx_rate = *fx.get(&currency).unwrap_or(&1.0);
        let market_value_cny = market_value * fx_rate;
        let cost_cny = cost * fx_rate;
        let pnl_cny = market_value_cny - cost_cny;
        let pnl_pct = if cost_cny.abs() > 1e-6 {
            pnl_cny / cost_cny * 100.0
        } else {
            0.0
        };

        Ok(HoldingView {
            id: r.get(0)?,
            account_id: r.get(1)?,
            account_name: r.get(2)?,
            institution: r.get(3)?,
            instrument_id: r.get(4)?,
            symbol: r.get(5)?,
            instrument_name: r.get(6)?,
            asset_class,
            market: r.get(8)?,
            currency,
            quantity,
            cost,
            multiplier,
            price,
            price_fetched_at,
            market_value,
            market_value_cny,
            pnl_cny,
            pnl_pct,
            manual_price,
            note: r.get(16)?,
            monthly_accrual_cny: r.get(17)?,
            accrual_cursor: r.get(18)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn row_to_holding(r: &rusqlite::Row) -> rusqlite::Result<Holding> {
    Ok(Holding {
        id: r.get(0)?,
        account_id: r.get(1)?,
        instrument_id: r.get(2)?,
        quantity: r.get(3)?,
        cost: r.get(4)?,
        manual_price: r.get(5)?,
        multiplier: r.get(6)?,
        note: r.get(7)?,
        monthly_accrual_cny: r.get(8)?,
        accrual_cursor: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
    })
}

const SELECT_HOLDING: &str = "SELECT id, account_id, instrument_id, quantity, cost, \
                              manual_price, multiplier, note, \
                              monthly_accrual_cny, accrual_cursor, \
                              created_at, updated_at \
                              FROM holdings WHERE id=?1";

#[tauri::command]
pub fn create_holding(db: State<'_, Db>, input: HoldingInput) -> AppResult<Holding> {
    let conn = db.conn.lock().unwrap();
    let mult = if input.multiplier > 0.0 { input.multiplier } else { 1.0 };
    conn.execute(
        "INSERT INTO holdings
           (account_id, instrument_id, quantity, cost, manual_price, multiplier, note,
            monthly_accrual_cny, accrual_cursor)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            input.account_id,
            input.instrument_id,
            input.quantity,
            input.cost,
            input.manual_price,
            mult,
            input.note,
            input.monthly_accrual_cny,
            input.accrual_cursor,
        ],
    )?;
    let id = conn.last_insert_rowid();
    conn.query_row(SELECT_HOLDING, [id], row_to_holding)
        .map_err(Into::into)
}

#[tauri::command]
pub fn update_holding(
    db: State<'_, Db>,
    id: i64,
    input: HoldingInput,
) -> AppResult<Holding> {
    let conn = db.conn.lock().unwrap();
    let mult = if input.multiplier > 0.0 { input.multiplier } else { 1.0 };
    conn.execute(
        "UPDATE holdings
         SET account_id=?1, instrument_id=?2, quantity=?3, cost=?4,
             manual_price=?5, multiplier=?6, note=?7,
             monthly_accrual_cny=?8, accrual_cursor=?9,
             updated_at=datetime('now')
         WHERE id=?10",
        params![
            input.account_id,
            input.instrument_id,
            input.quantity,
            input.cost,
            input.manual_price,
            mult,
            input.note,
            input.monthly_accrual_cny,
            input.accrual_cursor,
            id,
        ],
    )?;
    conn.query_row(SELECT_HOLDING, [id], row_to_holding)
        .map_err(Into::into)
}

#[tauri::command]
pub fn delete_holding(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute("DELETE FROM holdings WHERE id=?1", [id])?;
    Ok(())
}
