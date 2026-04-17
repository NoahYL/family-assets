use crate::db::Db;
use crate::error::AppResult;
use crate::models::{Account, AccountInput};
use rusqlite::params;
use tauri::State;

fn row_to_account(r: &rusqlite::Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: r.get(0)?,
        name: r.get(1)?,
        institution: r.get(2)?,
        kind: r.get(3)?,
        currency: r.get(4)?,
        owner: r.get(5)?,
        note: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

const SELECT_ACCOUNT: &str =
    "SELECT id, name, institution, type, currency, owner, note, created_at, updated_at
     FROM accounts WHERE id = ?1";

#[tauri::command]
pub fn list_accounts(db: State<'_, Db>) -> AppResult<Vec<Account>> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, name, institution, type, currency, owner, note, created_at, updated_at
         FROM accounts ORDER BY owner, id",
    )?;
    let rows = stmt
        .query_map([], row_to_account)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_account(db: State<'_, Db>, input: AccountInput) -> AppResult<Account> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO accounts (name, institution, type, currency, owner, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            input.name,
            input.institution,
            input.kind,
            input.currency,
            input.owner,
            input.note
        ],
    )?;
    let id = conn.last_insert_rowid();
    conn.query_row(SELECT_ACCOUNT, [id], row_to_account)
        .map_err(Into::into)
}

#[tauri::command]
pub fn update_account(
    db: State<'_, Db>,
    id: i64,
    input: AccountInput,
) -> AppResult<Account> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE accounts
         SET name=?1, institution=?2, type=?3, currency=?4, owner=?5, note=?6,
             updated_at=datetime('now')
         WHERE id=?7",
        params![
            input.name,
            input.institution,
            input.kind,
            input.currency,
            input.owner,
            input.note,
            id
        ],
    )?;
    conn.query_row(SELECT_ACCOUNT, [id], row_to_account)
        .map_err(Into::into)
}

#[tauri::command]
pub fn delete_account(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute("DELETE FROM accounts WHERE id = ?1", [id])?;
    Ok(())
}
