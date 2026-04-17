use crate::db::Db;
use crate::error::AppResult;
use crate::models::{BucketItem, DashboardSummary};
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn get_dashboard(db: State<'_, Db>) -> AppResult<DashboardSummary> {
    let conn = db.conn.lock().unwrap();

    // fx
    let mut fx: HashMap<String, f64> = HashMap::new();
    fx.insert("CNY".to_string(), 1.0);
    {
        let mut stmt = conn.prepare("SELECT base, rate FROM fx_rates WHERE quote='CNY'")?;
        let rows =
            stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))?;
        for row in rows {
            let (base, rate) = row?;
            fx.insert(base, rate);
        }
    }

    // 最后刷新时间
    let last_refreshed_at: Option<String> = conn
        .query_row(
            "SELECT MAX(fetched_at) FROM prices",
            [],
            |r| r.get::<_, Option<String>>(0),
        )
        .unwrap_or(None);

    let mut stmt = conn.prepare(
        "SELECT i.asset_class, a.name, i.currency, a.owner,
                h.quantity, h.cost, h.multiplier, p.price, h.manual_price
         FROM holdings h
         JOIN accounts a    ON a.id = h.account_id
         JOIN instruments i ON i.id = h.instrument_id
         LEFT JOIN prices p ON p.instrument_id = i.id",
    )?;

    let mut total_cny = 0.0;
    let mut total_cost_cny = 0.0;
    let mut by_class: HashMap<String, f64> = HashMap::new();
    let mut by_account: HashMap<String, f64> = HashMap::new();
    let mut by_currency: HashMap<String, f64> = HashMap::new();
    let mut by_owner: HashMap<String, f64> = HashMap::new();

    let rows = stmt.query_map([], |r| {
        let asset_class: String = r.get(0)?;
        let account_name: String = r.get(1)?;
        let currency: String = r.get(2)?;
        let owner: String = r.get(3)?;
        let quantity: f64 = r.get(4)?;
        let cost: f64 = r.get(5)?;
        let multiplier: f64 = r.get(6)?;
        let price_quote: Option<f64> = r.get(7)?;
        let manual_price: Option<f64> = r.get(8)?;
        Ok((
            asset_class,
            account_name,
            currency,
            owner,
            quantity,
            cost,
            multiplier,
            price_quote,
            manual_price,
        ))
    })?;

    for row in rows {
        let (
            asset_class,
            account_name,
            currency,
            owner,
            quantity,
            cost,
            multiplier,
            price_quote,
            manual_price,
        ) = row?;
        // 现金类永远 1:1 计价，给 1.0 兜底，避免市值为 0 造成假浮亏
        let price = manual_price
            .or(price_quote)
            .unwrap_or_else(|| if asset_class == "cash" { 1.0 } else { 0.0 });
        let market_value = price * quantity * multiplier;
        let rate = *fx.get(&currency).unwrap_or(&1.0);
        let mv_cny = market_value * rate;
        let cost_cny = cost * rate;

        total_cny += mv_cny;
        total_cost_cny += cost_cny;
        *by_class.entry(asset_class).or_default() += mv_cny;
        *by_account.entry(account_name).or_default() += mv_cny;
        *by_currency.entry(currency).or_default() += mv_cny;
        *by_owner.entry(owner).or_default() += mv_cny;
    }

    let pnl_cny = total_cny - total_cost_cny;
    let pnl_pct = if total_cost_cny.abs() > 1e-6 {
        pnl_cny / total_cost_cny * 100.0
    } else {
        0.0
    };

    Ok(DashboardSummary {
        total_cny,
        total_cost_cny,
        pnl_cny,
        pnl_pct,
        by_class: map_to_bucket(&by_class, label_class),
        by_account: map_to_bucket(&by_account, |k| k.to_string()),
        by_currency: map_to_bucket(&by_currency, |k| k.to_string()),
        by_owner: map_to_bucket(&by_owner, |k| k.to_string()),
        last_refreshed_at,
    })
}

fn map_to_bucket<F: Fn(&str) -> String>(
    m: &HashMap<String, f64>,
    labeler: F,
) -> Vec<BucketItem> {
    let mut v: Vec<BucketItem> = m
        .iter()
        .map(|(k, &v)| BucketItem {
            key: k.clone(),
            label: labeler(k),
            value: v,
        })
        .collect();
    v.sort_by(|a, b| b.value.partial_cmp(&a.value).unwrap_or(std::cmp::Ordering::Equal));
    v
}

fn label_class(k: &str) -> String {
    match k {
        "cash" => "现金",
        "stock" => "股票",
        "fund" => "基金",
        "bond" => "债券",
        "option" => "期权",
        "gold" => "黄金",
        "realestate" => "房产",
        "insurance" => "保单",
        "loan" => "贷款",
        _ => "其他",
    }
    .to_string()
}
