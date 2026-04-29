//! 攒钱目标的 CRUD（MVP：允许多目标；前端暂时只展示第一个）
use crate::db::Db;
use crate::error::AppResult;
use crate::models::{Goal, GoalInput};
use rusqlite::params;
use tauri::State;

fn row_to_goal(r: &rusqlite::Row) -> rusqlite::Result<Goal> {
    Ok(Goal {
        id: r.get(0)?,
        name: r.get(1)?,
        target_amount: r.get(2)?,
        target_date: r.get(3)?,
        start_amount: r.get(4)?,
        start_date: r.get(5)?,
        expected_annual_return: r.get(6)?,
        realestate_annual_return: r.get(7)?,
        note: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
    })
}

const SELECT: &str = "SELECT id, name, target_amount, target_date, start_amount,
    start_date, expected_annual_return, realestate_annual_return,
    note, created_at, updated_at
    FROM goals";

#[tauri::command]
pub fn list_goals(db: State<'_, Db>) -> AppResult<Vec<Goal>> {
    let conn = db.conn.lock().unwrap();
    let sql = format!("{SELECT} ORDER BY id ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_goal)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_goal(db: State<'_, Db>, input: GoalInput) -> AppResult<Goal> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO goals (name, target_amount, target_date, start_amount,
            start_date, expected_annual_return, realestate_annual_return, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            input.name,
            input.target_amount,
            input.target_date,
            input.start_amount,
            input.start_date,
            input.expected_annual_return,
            input.realestate_annual_return,
            input.note,
        ],
    )?;
    let id = conn.last_insert_rowid();
    let sql = format!("{SELECT} WHERE id = ?1");
    Ok(conn.query_row(&sql, [id], row_to_goal)?)
}

#[tauri::command]
pub fn update_goal(db: State<'_, Db>, id: i64, input: GoalInput) -> AppResult<Goal> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE goals SET
           name=?1, target_amount=?2, target_date=?3, start_amount=?4,
           start_date=?5, expected_annual_return=?6,
           realestate_annual_return=?7, note=?8,
           updated_at=datetime('now')
         WHERE id=?9",
        params![
            input.name,
            input.target_amount,
            input.target_date,
            input.start_amount,
            input.start_date,
            input.expected_annual_return,
            input.realestate_annual_return,
            input.note,
            id,
        ],
    )?;
    let sql = format!("{SELECT} WHERE id = ?1");
    Ok(conn.query_row(&sql, [id], row_to_goal)?)
}

#[tauri::command]
pub fn delete_goal(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute("DELETE FROM goals WHERE id=?1", [id])?;
    Ok(())
}
