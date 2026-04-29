use crate::error::AppResult;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Db {
    pub conn: Mutex<Connection>,
}

impl Db {
    pub fn new(db_path: PathBuf) -> AppResult<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&db_path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             PRAGMA synchronous=NORMAL;",
        )?;
        let db = Db {
            conn: Mutex::new(conn),
        };
        db.run_migrations()?;
        db.seed_defaults()?;
        Ok(db)
    }

    fn run_migrations(&self) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(MIGRATION_V1)?;

        // v2: holdings 加 multiplier 列（期权合约乘数，股票填 1）
        let has_multiplier: bool = conn
            .prepare("PRAGMA table_info(holdings)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .any(|name| name == "multiplier");
        if !has_multiplier {
            conn.execute_batch(
                "ALTER TABLE holdings ADD COLUMN multiplier REAL NOT NULL DEFAULT 1;",
            )?;
        }

        // v3: accounts 加 owner 列（柳哥 / 刘总 / 共有）
        let has_owner: bool = conn
            .prepare("PRAGMA table_info(accounts)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .any(|name| name == "owner");
        if !has_owner {
            conn.execute_batch(
                "ALTER TABLE accounts ADD COLUMN owner TEXT NOT NULL DEFAULT '共有';",
            )?;
        }

        // v4: holdings 加"月度自动累积"相关列
        //   monthly_accrual_cny: 每月净增/净减（CNY），>0 表示按月注入，<0 按月扣减
        //   accrual_cursor:       上次结算的月份（'YYYY-MM'），刷新时推进到今月
        let hold_cols: Vec<String> = conn
            .prepare("PRAGMA table_info(holdings)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();
        if !hold_cols.iter().any(|n| n == "monthly_accrual_cny") {
            conn.execute_batch(
                "ALTER TABLE holdings ADD COLUMN monthly_accrual_cny REAL NOT NULL DEFAULT 0;",
            )?;
        }
        if !hold_cols.iter().any(|n| n == "accrual_cursor") {
            conn.execute_batch("ALTER TABLE holdings ADD COLUMN accrual_cursor TEXT;")?;
        }

        // v5: snapshots 改为"一月一点"——加 snapshot_month TEXT UNIQUE 列，
        //     刷新时按月份 UPSERT，避免同月多次刷新出现锯齿曲线
        let snap_cols: Vec<String> = conn
            .prepare("PRAGMA table_info(snapshots)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();
        // v7: 股票/基金买卖交易日志表 stock_trades
        //   每笔买卖记一行永久存档；系统根据交易自动联动 holdings（持仓）和现金 holding
        //   总资产永远自洽：买入时 现金↓股票↑；卖出时 股票↓现金↑ + 记录已实现盈亏
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS stock_trades (
                id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id              INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                instrument_id           INTEGER NOT NULL REFERENCES instruments(id),
                side                    TEXT NOT NULL,          -- buy | sell
                quantity                REAL NOT NULL,
                price_per_share         REAL NOT NULL,
                trade_date              TEXT NOT NULL,
                currency                TEXT NOT NULL,
                cash_holding_id         INTEGER REFERENCES holdings(id),
                realized_pnl            REAL,                   -- 仅 sell 有；原币种
                avg_cost_at_trade       REAL,                   -- 仅 sell 有；当时的平均成本/股
                note                    TEXT,
                created_at              TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_stock_trades_account ON stock_trades(account_id);
            CREATE INDEX IF NOT EXISTS idx_stock_trades_instrument ON stock_trades(instrument_id);
            CREATE INDEX IF NOT EXISTS idx_stock_trades_date ON stock_trades(trade_date);",
        )?;

        // v6: 期权交易日志表 option_trades（Wheel 策略专用）
        //   单独记录 sell_put / covered_call 每一笔的生命周期：open → expired/closed/assigned/rolled
        //   开仓/平仓/被行权时通过"现金 holding + 标的 holding"联动，所以总资产永远自洽。
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS option_trades (
                id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id              INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                underlying_instrument_id INTEGER REFERENCES instruments(id),
                underlying_symbol       TEXT NOT NULL,
                strategy                TEXT NOT NULL,              -- sell_put | covered_call
                option_type             TEXT NOT NULL,              -- put | call
                strike                  REAL NOT NULL,
                expiration              TEXT NOT NULL,              -- YYYY-MM-DD
                contracts               REAL NOT NULL,
                multiplier              INTEGER NOT NULL DEFAULT 100,
                premium_per_share       REAL NOT NULL,              -- 开仓权利金/股
                open_date               TEXT NOT NULL,
                currency                TEXT NOT NULL DEFAULT 'USD',
                cash_holding_id         INTEGER REFERENCES holdings(id),
                status                  TEXT NOT NULL DEFAULT 'open', -- open|expired|assigned|closed|rolled
                close_date              TEXT,
                close_price_per_share   REAL,
                realized_pnl            REAL,
                note                    TEXT,
                created_at              TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_option_trades_account ON option_trades(account_id);
            CREATE INDEX IF NOT EXISTS idx_option_trades_status  ON option_trades(status);",
        )?;

        if !snap_cols.iter().any(|n| n == "snapshot_month") {
            conn.execute_batch("ALTER TABLE snapshots ADD COLUMN snapshot_month TEXT;")?;
            // 回填已有记录：从 snapshot_at 前 7 位 'YYYY-MM-DD HH:MM:SS' 取出 'YYYY-MM'
            conn.execute_batch(
                "UPDATE snapshots SET snapshot_month = substr(snapshot_at, 1, 7)
                 WHERE snapshot_month IS NULL;",
            )?;
            // 建 UNIQUE 索引（历史若重复，保留 id 最大的那条）
            conn.execute_batch(
                "DELETE FROM snapshots
                 WHERE id NOT IN (
                    SELECT MAX(id) FROM snapshots GROUP BY snapshot_month
                 );
                 CREATE UNIQUE INDEX IF NOT EXISTS uq_snapshots_month
                   ON snapshots(snapshot_month);",
            )?;
        }

        // v10: 目标表加"房产年化变化率"列（默认 -0.01，反映房价可能贬值）
        //       原 expected_annual_return 保留，语义收窄为"生息资产年化"
        let goal_cols: Vec<String> = conn
            .prepare("PRAGMA table_info(goals)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();
        if !goal_cols.is_empty()
            && !goal_cols.iter().any(|n| n == "realestate_annual_return")
        {
            conn.execute_batch(
                "ALTER TABLE goals
                   ADD COLUMN realestate_annual_return REAL NOT NULL DEFAULT -0.01;",
            )?;
        }

        // v9: 攒钱目标表 goals
        //   target_amount：目标金额（CNY）
        //   target_date：期望达成日期（YYYY-MM-DD）
        //   start_amount/start_date：起算点（建目标时从当前总资产快照）
        //   expected_annual_return：假设年化（小数，0.045 表示 4.5%）
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS goals (
                id                        INTEGER PRIMARY KEY AUTOINCREMENT,
                name                      TEXT NOT NULL,
                target_amount             REAL NOT NULL,
                target_date               TEXT NOT NULL,
                start_amount              REAL NOT NULL,
                start_date                TEXT NOT NULL,
                expected_annual_return    REAL NOT NULL DEFAULT 0.06,   -- 生息资产年化
                realestate_annual_return  REAL NOT NULL DEFAULT -0.01,  -- 房产年化变化率（可负）
                note                      TEXT,
                created_at                TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )?;

        // v8: 快照改为"一日一点"——加 snapshot_date TEXT UNIQUE 列；
        //     放弃按月唯一（同月可以多行，只要不同日），refresh 按日期 UPSERT
        let snap_cols2: Vec<String> = conn
            .prepare("PRAGMA table_info(snapshots)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();
        if !snap_cols2.iter().any(|n| n == "snapshot_date") {
            conn.execute_batch("ALTER TABLE snapshots ADD COLUMN snapshot_date TEXT;")?;
            // 回填：'YYYY-MM-DD HH:MM:SS' 前 10 位
            conn.execute_batch(
                "UPDATE snapshots SET snapshot_date = substr(snapshot_at, 1, 10)
                 WHERE snapshot_date IS NULL;",
            )?;
            // 放弃月度唯一约束（每月可以多行）
            conn.execute_batch("DROP INDEX IF EXISTS uq_snapshots_month;")?;
            // 日级去重：同一天只保留 id 最大的一条，然后加 UNIQUE
            conn.execute_batch(
                "DELETE FROM snapshots
                 WHERE id NOT IN (
                    SELECT MAX(id) FROM snapshots GROUP BY snapshot_date
                 );
                 CREATE UNIQUE INDEX IF NOT EXISTS uq_snapshots_date
                   ON snapshots(snapshot_date);",
            )?;
        }
        Ok(())
    }

    fn seed_defaults(&self) -> AppResult<()> {
        // 预置常用 instruments：CNY / USD / HKD 现金、实物黄金、房产、保单
        let conn = self.conn.lock().unwrap();
        let presets: &[(&str, &str, &str, Option<&str>, &str, &str)] = &[
            ("CNY.CASH", "人民币现金", "cash", None, "CNY", "manual"),
            ("USD.CASH", "美元现金", "cash", None, "USD", "manual"),
            ("HKD.CASH", "港币现金", "cash", None, "HKD", "manual"),
            ("GOLD.AU9999", "实物黄金(AU99.99)", "gold", None, "CNY", "gold"),
            ("REALESTATE", "房产", "realestate", None, "CNY", "manual"),
            ("INSURANCE", "商业保单", "insurance", None, "CNY", "manual"),
        ];
        for (symbol, name, class, market, currency, source) in presets {
            conn.execute(
                "INSERT OR IGNORE INTO instruments
                   (symbol, name, asset_class, market, currency, quote_source, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
                rusqlite::params![symbol, name, class, market, currency, source],
            )?;
        }
        Ok(())
    }
}

const MIGRATION_V1: &str = r#"
CREATE TABLE IF NOT EXISTS accounts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    institution  TEXT NOT NULL,
    type         TEXT NOT NULL,
    currency     TEXT NOT NULL DEFAULT 'CNY',
    owner        TEXT NOT NULL DEFAULT '共有',
    note         TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS instruments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol        TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    asset_class   TEXT NOT NULL,
    market        TEXT,
    currency      TEXT NOT NULL DEFAULT 'CNY',
    quote_source  TEXT NOT NULL DEFAULT 'manual',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holdings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    instrument_id  INTEGER NOT NULL REFERENCES instruments(id),
    quantity       REAL NOT NULL,
    cost           REAL NOT NULL DEFAULT 0,
    manual_price   REAL,
    multiplier     REAL NOT NULL DEFAULT 1,
    note           TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id);
CREATE INDEX IF NOT EXISTS idx_holdings_instrument ON holdings(instrument_id);

CREATE TABLE IF NOT EXISTS prices (
    instrument_id  INTEGER PRIMARY KEY REFERENCES instruments(id) ON DELETE CASCADE,
    price          REAL NOT NULL,
    currency       TEXT NOT NULL,
    fetched_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fx_rates (
    base        TEXT NOT NULL,
    quote       TEXT NOT NULL,
    rate        REAL NOT NULL,
    fetched_at  TEXT NOT NULL,
    PRIMARY KEY (base, quote)
);

CREATE TABLE IF NOT EXISTS snapshots (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_at             TEXT NOT NULL,
    total_cny               REAL NOT NULL,
    total_by_class_json     TEXT NOT NULL,
    total_by_account_json   TEXT NOT NULL,
    total_by_currency_json  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_at ON snapshots(snapshot_at);
"#;
