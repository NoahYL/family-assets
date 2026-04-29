//! 新浪财经行情源。
//!
//! 单接口：`https://hq.sinajs.cn/list=<symbols>`
//! - A 股：sh600519 / sz000001
//! - 港股：hk00700
//! - 美股：gb_aapl
//! - 汇率：fx_susdcny / fx_shkdcny
//! - 上金所：gds_AU9999 (元/克)
//!
//! 返回 GBK，格式 `var hq_str_<sym>="字段1,字段2,..."`
//! 需要 Referer: finance.sina.com.cn 否则 403。

use crate::error::{AppError, AppResult};
use crate::models::Quote;
use crate::quotes::HTTP;
use encoding_rs::GBK;
use regex::Regex;

pub async fn fetch(source: &str, symbol: &str) -> AppResult<Quote> {
    let url = format!("https://hq.sinajs.cn/list={symbol}");
    let resp = HTTP
        .get(&url)
        .header("Referer", "https://finance.sina.com.cn/")
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::Msg(format!(
            "sina {}: HTTP {}",
            symbol,
            resp.status()
        )));
    }
    let bytes = resp.bytes().await?;
    let (text, _, _) = GBK.decode(&bytes);
    let text = text.to_string();

    let re = Regex::new(r#"var hq_str_[^=]+="([^"]*)";"#).unwrap();
    let caps = re
        .captures(&text)
        .ok_or_else(|| AppError::Msg(format!("sina {symbol}: 解析失败")))?;
    let payload = caps.get(1).unwrap().as_str();
    if payload.trim().is_empty() {
        return Err(AppError::Msg(format!("sina {symbol}: 返回为空")));
    }
    let parts: Vec<&str> = payload.split(',').collect();

    let price = match source {
        "sina_cn" => {
            // 0:名称 1:今开 2:昨收 3:当前 4:最高 5:最低 ...
            // 盘前（9:30 前）当前价=0，回退昨收，避免覆盖价表为 0
            let cur = parse_f64(parts.get(3), symbol).unwrap_or(0.0);
            if cur > 0.0 {
                cur
            } else {
                parse_f64(parts.get(2), symbol)?
            }
        }
        "sina_hk" => {
            // 0:英文名 1:中文名 2:今开 3:昨收 4:最高 5:最低 6:当前 ...
            let cur = parse_f64(parts.get(6), symbol).unwrap_or(0.0);
            if cur > 0.0 {
                cur
            } else {
                parse_f64(parts.get(3), symbol)?
            }
        }
        "sina_us" => {
            // 0:名称 1:当前 ...
            parse_f64(parts.get(1), symbol)?
        }
        "sina_fx" => {
            // 新浪外汇：fx_susdcny
            // 字段大致：0:时间 1:买价 2:卖价 3:... 8:中间价
            // 实践中 parts[8] 多为中间价，取它；失败退回 parts[1]
            parse_f64(parts.get(8), symbol)
                .or_else(|_| parse_f64(parts.get(1), symbol))?
        }
        "sina_gold" => {
            // gds_AU9999: 0:名称? 1:现价 2:开盘 3:最高 4:最低 ...
            // 实际返回如 "2026-04-16 15:30:21,750.50,751.00,..." → 取第 1 个数值字段
            parts
                .iter()
                .find_map(|s| s.trim().parse::<f64>().ok())
                .ok_or_else(|| AppError::Msg(format!("sina {symbol}: 无法提取金价")))?
        }
        _ => return Err(AppError::Msg(format!("未知 sina 源: {source}"))),
    };

    let currency = match source {
        "sina_cn" | "sina_fx" | "sina_gold" => "CNY",
        "sina_hk" => "HKD",
        "sina_us" => "USD",
        _ => "CNY",
    };

    Ok(Quote {
        symbol: symbol.to_string(),
        price,
        currency: currency.to_string(),
    })
}

fn parse_f64(opt: Option<&&str>, symbol: &str) -> AppResult<f64> {
    opt.and_then(|s| s.trim().parse::<f64>().ok())
        .ok_or_else(|| AppError::Msg(format!("sina {symbol}: 解析价格失败")))
}
