mod commands;
mod db;
mod error;
mod models;
mod quotes;

use db::Db;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("cannot resolve app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();
            let db_path = app_data_dir.join("family-assets.db");
            let db = Db::new(db_path).expect("init db");
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // accounts
            commands::accounts::list_accounts,
            commands::accounts::create_account,
            commands::accounts::update_account,
            commands::accounts::delete_account,
            // instruments
            commands::instruments::list_instruments,
            commands::instruments::create_instrument,
            commands::instruments::update_instrument,
            commands::instruments::delete_instrument,
            // holdings
            commands::holdings::list_holdings,
            commands::holdings::create_holding,
            commands::holdings::update_holding,
            commands::holdings::delete_holding,
            // dashboard / snapshots / refresh
            commands::dashboard::get_dashboard,
            commands::snapshots::list_snapshots,
            commands::snapshots::delete_snapshot,
            commands::refresh::refresh_all,
            // options
            commands::options::list_option_trades,
            commands::options::create_option_trade,
            commands::options::update_option_trade,
            commands::options::mark_option_expired,
            commands::options::close_option_trade,
            commands::options::mark_option_assigned,
            commands::options::mark_option_rolled,
            commands::options::delete_option_trade,
            commands::options::get_option_dashboard,
            // stock trades
            commands::stock_trades::list_stock_trades,
            commands::stock_trades::record_stock_buy,
            commands::stock_trades::record_stock_sell,
            commands::stock_trades::delete_stock_trade,
            // goals
            commands::goals::list_goals,
            commands::goals::create_goal,
            commands::goals::update_goal,
            commands::goals::delete_goal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
