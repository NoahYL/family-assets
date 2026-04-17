//! 天天基金行情源（适用于公募基金）。
//!
//! 1) 盘中估值（有限制，盘后无）：
//!    https://fundgz.1234567.com.cn/js/<code>.js
//!    返回 `jsonpgz({"fundcode":"000001","name":"...","jzrq":"...","dwjz":"...","gsz":"...","gszzl":"...","gztime":"..."});`
//!
//! 2) 盘后备选（最新单位净值）：
//!    https://api.fund.eastmoney.com/f10/lsjz?fundCode=<code>&pageIndex=1&pageSize=1
//!    （需要 referer=http://fundf10.eastmoney.com/）
//!
//! MVP 简化：只用 1)；若 gsz 缺失则用 dwjz。

use crate::error::{AppError, AppResult};
use crate::models::Quote;
use crate::quotes::HTTP;
use regex::Regex;

pub async fn fetch(code: &str) -> AppResult<Quote> {
    let url = format!("https://fundgz.1234567.com.cn/js/{code}.js");
    let resp = HTTP
        .get(&url)
        .header("Referer", "https://fund.eastmoney.com/")
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::Msg(format!(
            "tiantian {}: HTTP {}",
            code,
            resp.status()
        )));
    }
    let text = resp.text().await?;
    // jsonpgz({...});  or jsonpgz();  (停牌/无数据时)
    let re = Regex::new(r"jsonpgz\((.*)\);").unwrap();
    let caps = re
        .captures(&text)
        .ok_or_else(|| AppError::Msg(format!("tiantian {code}: 解析失败")))?;
    let body = caps.get(1).unwrap().as_str().trim();
    if body.is_empty() {
        return Err(AppError::Msg(format!("tiantian {code}: 无数据")));
    }
    let v: serde_json::Value = serde_json::from_str(body)?;
    let price = v
        .get("gsz")
        .and_then(|x| x.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .or_else(|| {
            v.get("dwjz")
                .and_then(|x| x.as_str())
                .and_then(|s| s.parse::<f64>().ok())
        })
        .ok_or_else(|| AppError::Msg(format!("tiantian {code}: 无价格字段")))?;

    Ok(Quote {
        symbol: code.to_string(),
        price,
        currency: "CNY".to_string(),
    })
}
