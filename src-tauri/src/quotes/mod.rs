pub mod sina;
pub mod tiantian;

use crate::error::{AppError, AppResult};
use crate::models::Quote;
use once_cell::sync::Lazy;
use reqwest::{header, Client};
use std::time::Duration;

pub static HTTP: Lazy<Client> = Lazy::new(|| {
    let mut headers = header::HeaderMap::new();
    headers.insert(
        header::USER_AGENT,
        header::HeaderValue::from_static(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        ),
    );
    Client::builder()
        .default_headers(headers)
        .timeout(Duration::from_secs(10))
        .build()
        .expect("build http client")
});

/// 根据 quote_source + symbol 拉取最新价
pub async fn fetch_quote(source: &str, symbol: &str) -> AppResult<Quote> {
    match source {
        "sina_cn" | "sina_hk" | "sina_us" | "sina_fx" | "sina_gold" => {
            sina::fetch(source, symbol).await
        }
        "tiantian" => tiantian::fetch(symbol).await,
        "manual" => Err(AppError::Msg(format!(
            "{symbol} 为手动估值品种，无法自动刷新"
        ))),
        other => Err(AppError::Msg(format!("未知行情源: {other}"))),
    }
}

/// 刷新常用汇率：USD→CNY / HKD→CNY
pub async fn fetch_common_fx() -> Vec<(String, String, f64)> {
    let mut out = Vec::new();
    for (sym, base) in [("fx_susdcny", "USD"), ("fx_shkdcny", "HKD")] {
        if let Ok(q) = sina::fetch("sina_fx", sym).await {
            out.push((base.to_string(), "CNY".to_string(), q.price));
        }
    }
    // CNY 自身
    out.push(("CNY".to_string(), "CNY".to_string(), 1.0));
    out
}
