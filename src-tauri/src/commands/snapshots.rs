use crate::db::Db;
use crate::error::AppResult;
use crate::models::Snapshot;
use tauri::State;

#[tauri::command]
pub fn list_snapshots(db: State<'_, Db>, limit: Option<i64>) -> AppResult<Vec<Snapshot>> {
    let limit = limit.unwrap_or(180);
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, snapshot_at, snapshot_date, snapshot_month, total_cny,
                total_by_class_json, total_by_account_json, total_by_currency_json
         FROM snapshots
         ORDER BY COALESCE(snapshot_date, substr(snapshot_at, 1, 10)) DESC, id DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit], |r| {
        Ok(Snapshot {
            id: r.get(0)?,
            snapshot_at: r.get(1)?,
            snapshot_date: r.get(2)?,
            snapshot_month: r.get(3)?,
            total_cny: r.get(4)?,
            total_by_class_json: r.get(5)?,
            total_by_account_json: r.get(6)?,
            total_by_currency_json: r.get(7)?,
        })
    })?;
    let mut v = rows.collect::<Result<Vec<_>, _>>()?;
    v.reverse(); // 按时间升序方便前端画线
    Ok(v)
}

#[tauri::command]
pub fn delete_snapshot(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute("DELETE FROM snapshots WHERE id=?1", [id])?;
    Ok(())
}
