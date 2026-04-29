use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::{RefreshFailure, RefreshReport};
use crate::quotes::{fetch_common_fx, fetch_quote};
use chrono::Local;
use std::collections::HashMap;
use tauri::State;

/// 一键刷新：月度累积推进 → 拉行情 → 更新 prices → 拉 FX → 写 snapshot
#[tauri::command]
pub async fn refresh_all(db: State<'_, Db>) -> AppResult<RefreshReport> {
    // 0. 月度累积推进：公积金 / 定投 / 保单保费 等按月净变化的持仓
    advance_monthly_accruals(&db)?;

    // 1. 读取需要刷新的 instruments（仅被持有的，避免无谓请求）
    let targets: Vec<(i64, String, String, String)> = {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT i.id, i.symbol, i.quote_source, i.currency
             FROM instruments i
             JOIN holdings h ON h.instrument_id = i.id
             WHERE i.quote_source != 'manual'",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let mut refreshed = 0usize;
    let mut failed: Vec<RefreshFailure> = Vec::new();

    // 统一用 Rust 端的本地时间戳（北京时间），避免 SQLite 的 datetime('now') 返回 UTC
    // 和前端展示的"上次刷新时间"错 8 小时
    let fetched_at_local = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 2. 并发拉行情（简单分批，每批 8 个）
    for chunk in targets.chunks(8) {
        let mut handles = Vec::new();
        for (id, symbol, source, currency) in chunk {
            let id = *id;
            let symbol = symbol.clone();
            let source = source.clone();
            let currency = currency.clone();
            handles.push(tokio::spawn(async move {
                let res = fetch_quote(&source, &symbol).await;
                (id, symbol, currency, res)
            }));
        }
        for h in handles {
            let (id, symbol, currency, res) = h.await.map_err(|e| AppError::Msg(e.to_string()))?;
            match res {
                Ok(q) => {
                    let conn = db.conn.lock().unwrap();
                    conn.execute(
                        "INSERT INTO prices (instrument_id, price, currency, fetched_at)
                         VALUES (?1, ?2, ?3, ?4)
                         ON CONFLICT(instrument_id) DO UPDATE SET
                           price=excluded.price,
                           currency=excluded.currency,
                           fetched_at=excluded.fetched_at",
                        rusqlite::params![id, q.price, currency, fetched_at_local],
                    )?;
                    refreshed += 1;
                }
                Err(e) => failed.push(RefreshFailure {
                    symbol,
                    reason: e.to_string(),
                }),
            }
        }
    }

    // 3. 拉 FX
    let fx_rows = fetch_common_fx().await;
    {
        let conn = db.conn.lock().unwrap();
        for (base, quote, rate) in fx_rows {
            conn.execute(
                "INSERT INTO fx_rates (base, quote, rate, fetched_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(base, quote) DO UPDATE SET
                   rate=excluded.rate, fetched_at=excluded.fetched_at",
                rusqlite::params![base, quote, rate, fetched_at_local],
            )?;
        }
    }

    // 4. 汇总 + 写 snapshot
    let (total_cny, by_class, by_account, by_currency) = compute_totals(&db)?;

    let now = Local::now();
    let snapshot_at = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let snapshot_month = now.format("%Y-%m").to_string();
    let snapshot_date = now.format("%Y-%m-%d").to_string();
    let by_class_json = serde_json::to_string(&by_class)?;
    let by_account_json = serde_json::to_string(&by_account)?;
    let by_currency_json = serde_json::to_string(&by_currency)?;

    // 一日一点：同一天已存在则覆盖（取当日最新一次刷新作为当日收盘），否则插入
    let snapshot_id = {
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO snapshots
               (snapshot_at, snapshot_month, snapshot_date, total_cny,
                total_by_class_json, total_by_account_json, total_by_currency_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(snapshot_date) DO UPDATE SET
               snapshot_at             = excluded.snapshot_at,
               snapshot_month          = excluded.snapshot_month,
               total_cny               = excluded.total_cny,
               total_by_class_json     = excluded.total_by_class_json,
               total_by_account_json   = excluded.total_by_account_json,
               total_by_currency_json  = excluded.total_by_currency_json",
            rusqlite::params![
                snapshot_at,
                snapshot_month,
                snapshot_date,
                total_cny,
                by_class_json,
                by_account_json,
                by_currency_json
            ],
        )?;
        conn.query_row(
            "SELECT id FROM snapshots WHERE snapshot_date = ?1",
            [&snapshot_date],
            |r| r.get::<_, i64>(0),
        )?
    };

    Ok(RefreshReport {
        refreshed,
        failed,
        snapshot_id,
        total_cny,
        at: snapshot_at,
    })
}

type Totals = (
    f64,
    HashMap<String, f64>,
    HashMap<String, f64>,
    HashMap<String, f64>,
);

/// 月度累积推进：
/// 对每笔 `monthly_accrual_cny != 0` 且 `accrual_cursor IS NOT NULL` 的持仓，
/// 计算从 cursor 到"本月"已经跨越的月份数，按月份数 × 每月净额 同时加到
/// quantity 和 cost 上（保持 pnl=0），再把 cursor 更新到本月。
/// 约定：持仓必须为 CNY 计价的 cash 类（这是公积金/工资定投的典型形态）。
fn advance_monthly_accruals(db: &State<'_, Db>) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    let now_month = Local::now().format("%Y-%m").to_string();

    // 取出所有启用了累积的持仓
    let rows: Vec<(i64, f64, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, monthly_accrual_cny, accrual_cursor
             FROM holdings
             WHERE monthly_accrual_cny != 0 AND accrual_cursor IS NOT NULL",
        )?;
        let it = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, f64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        it.collect::<Result<Vec<_>, _>>()?
    };

    for (id, monthly, cursor) in rows {
        let months = months_between(&cursor, &now_month);
        if months <= 0 {
            continue;
        }
        let delta = months as f64 * monthly;
        conn.execute(
            "UPDATE holdings
               SET quantity = quantity + ?1,
                   cost     = cost + ?1,
                   accrual_cursor = ?2,
                   updated_at = datetime('now')
             WHERE id = ?3",
            rusqlite::params![delta, now_month, id],
        )?;
    }
    Ok(())
}

/// 两个 'YYYY-MM' 之间相差的整月数（b - a）
fn months_between(a: &str, b: &str) -> i32 {
    fn parse(s: &str) -> Option<(i32, i32)> {
        let mut it = s.split('-');
        let y: i32 = it.next()?.parse().ok()?;
        let m: i32 = it.next()?.parse().ok()?;
        Some((y, m))
    }
    let (ya, ma) = match parse(a) {
        Some(v) => v,
        None => return 0,
    };
    let (yb, mb) = match parse(b) {
        Some(v) => v,
        None => return 0,
    };
    (yb - ya) * 12 + (mb - ma)
}

fn compute_totals(db: &State<'_, Db>) -> AppResult<Totals> {
    let conn = db.conn.lock().unwrap();
    let mut fx: HashMap<String, f64> = HashMap::new();
    fx.insert("CNY".to_string(), 1.0);
    {
        let mut stmt = conn.prepare("SELECT base, rate FROM fx_rates WHERE quote='CNY'")?;
        let rows =
            stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))?;
        for row in rows {
            let (b, r) = row?;
            fx.insert(b, r);
        }
    }

    let mut stmt = conn.prepare(
        "SELECT i.asset_class, a.name, i.currency,
                h.quantity, h.multiplier, p.price, h.manual_price
         FROM holdings h
         JOIN accounts a    ON a.id = h.account_id
         JOIN instruments i ON i.id = h.instrument_id
         LEFT JOIN prices p ON p.instrument_id = i.id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, f64>(3)?,
            r.get::<_, f64>(4)?,
            r.get::<_, Option<f64>>(5)?,
            r.get::<_, Option<f64>>(6)?,
        ))
    })?;

    let mut total = 0.0;
    let mut by_class = HashMap::new();
    let mut by_account = HashMap::new();
    let mut by_currency = HashMap::new();

    for row in rows {
        let (class, acct, ccy, qty, mult, price_q, manual) = row?;
        let price = manual.or(price_q).unwrap_or(0.0);
        let rate = *fx.get(&ccy).unwrap_or(&1.0);
        let mv = price * qty * mult * rate;
        total += mv;
        *by_class.entry(class).or_insert(0.0) += mv;
        *by_account.entry(acct).or_insert(0.0) += mv;
        *by_currency.entry(ccy).or_insert(0.0) += mv;
    }

    Ok((total, by_class, by_account, by_currency))
}
