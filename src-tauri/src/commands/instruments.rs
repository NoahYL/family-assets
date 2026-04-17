use crate::db::Db;
use crate::error::AppResult;
use crate::models::{Instrument, InstrumentInput};
use rusqlite::params;
use tauri::State;

fn row_to_instrument(r: &rusqlite::Row) -> rusqlite::Result<Instrument> {
    Ok(Instrument {
        id: r.get(0)?,
        symbol: r.get(1)?,
        name: r.get(2)?,
        asset_class: r.get(3)?,
        market: r.get(4)?,
        currency: r.get(5)?,
        quote_source: r.get(6)?,
        created_at: r.get(7)?,
    })
}

#[tauri::command]
pub fn list_instruments(db: State<'_, Db>) -> AppResult<Vec<Instrument>> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, symbol, name, asset_class, market, currency, quote_source, created_at
         FROM instruments ORDER BY asset_class, symbol",
    )?;
    let rows = stmt
        .query_map([], row_to_instrument)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_instrument(
    db: State<'_, Db>,
    input: InstrumentInput,
) -> AppResult<Instrument> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO instruments (symbol, name, asset_class, market, currency, quote_source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            input.symbol,
            input.name,
            input.asset_class,
            input.market,
            input.currency,
            input.quote_source
        ],
    )?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, symbol, name, asset_class, market, currency, quote_source, created_at
         FROM instruments WHERE id=?1",
        [id],
        row_to_instrument,
    )
    .map_err(Into::into)
}

#[tauri::command]
pub fn update_instrument(
    db: State<'_, Db>,
    id: i64,
    input: InstrumentInput,
) -> AppResult<Instrument> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE instruments
         SET symbol=?1, name=?2, asset_class=?3, market=?4, currency=?5, quote_source=?6
         WHERE id=?7",
        params![
            input.symbol,
            input.name,
            input.asset_class,
            input.market,
            input.currency,
            input.quote_source,
            id
        ],
    )?;
    conn.query_row(
        "SELECT id, symbol, name, asset_class, market, currency, quote_source, created_at
         FROM instruments WHERE id=?1",
        [id],
        row_to_instrument,
    )
    .map_err(Into::into)
}

#[tauri::command]
pub fn delete_instrument(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute("DELETE FROM instruments WHERE id=?1", [id])?;
    Ok(())
}
