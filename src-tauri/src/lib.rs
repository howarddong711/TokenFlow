mod browser;
mod commands;
mod core;
mod providers;
mod tracking;
mod tray_icon;

use commands::accounts;
use commands::anthropic;
use commands::antigravity;
use commands::claude;
use commands::copilot;
use commands::cursor;
use commands::gemini;
use commands::iflow;
use commands::kimi;
use commands::openai;
use commands::openai_oauth;
use commands::qwen;
use commands::system;
use commands::trae;
use commands::tray;
use commands::usage;
use commands::vertex;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            app.manage(system::PendingAppUpdate::default());

            fn show_main_window(app: &tauri::AppHandle) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            // Build tray menu
            let show_item = MenuItemBuilder::with_id("show", "Show TokenFlow").build(app)?;
            let refresh_item = MenuItemBuilder::with_id("refresh", "Quick refresh").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit TokenFlow").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show_item, &refresh_item, &quit_item])
                .build()?;

            // Build tray icon
            TrayIconBuilder::with_id("main-tray")
                .icon(
                    app.default_window_icon()
                        .ok_or("no default window icon")?
                        .clone(),
                )
                .tooltip("TokenFlow - Make Every Token Spend Traceable")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app: &tauri::AppHandle, event| match event.id().as_ref() {
                    "show" => {
                        show_main_window(app);
                    }
                    "refresh" => {
                        show_main_window(app);
                        let _ = app.emit("tray-command", "refresh");
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray: &TrayIcon, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        show_main_window(&app);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            accounts::list_accounts,
            accounts::list_provider_capabilities,
            accounts::add_account,
            accounts::remove_account,
            accounts::rename_account,
            accounts::set_default_account,
            accounts::fetch_account_usage,
            accounts::fetch_all_accounts_usage,
            accounts::repair_cursor_account_session,
            claude::start_claude_oauth_login,
            claude::poll_claude_oauth_login,
            copilot::start_device_flow,
            copilot::poll_device_flow,
            copilot::get_copilot_user,
            copilot::get_copilot_status,
            cursor::list_cursor_browser_profiles,
            cursor::import_cursor_browser_profile,
            cursor::import_cursor_local_session,
            trae::import_trae_local_session,
            openai::get_openai_status,
            openai_oauth::start_openai_chatgpt_oauth,
            openai_oauth::openai_wait_for_callback,
            openai_oauth::openai_exchange_chatgpt_token,
            openai_oauth::cancel_openai_chatgpt_oauth_wait,
            anthropic::get_anthropic_status,
            gemini::get_gemini_status,
            gemini::import_gemini_cli_oauth,
            qwen::get_qwen_status,
            kimi::get_kimi_status,
            vertex::get_vertex_status,
            vertex::validate_vertex_service_account,
            qwen::list_qwen_cli_oauth_accounts,
            qwen::import_qwen_cli_oauth,
            qwen::import_qwen_cli_oauth_from_path,
            antigravity::start_antigravity_oauth,
            antigravity::get_antigravity_oauth_availability,
            antigravity::import_antigravity_local_session,
            antigravity::antigravity_wait_for_callback,
            antigravity::antigravity_exchange_token,
            antigravity::get_antigravity_user_info,
            antigravity::get_antigravity_status,
            antigravity::antigravity_refresh_token,
            iflow::start_iflow_oauth,
            iflow::iflow_wait_for_callback,
            iflow::iflow_exchange_token,
            iflow::get_iflow_user_info,
            iflow::get_iflow_status,
            iflow::iflow_refresh_token,
            tray::update_tray_tooltip,
            tray::update_tray_icon,
            usage::fetch_provider_usage,
            usage::fetch_all_providers_usage,
            usage::get_local_cost_summary,
            usage::get_request_logs,
            usage::get_request_tracking_status,
            usage::get_provider_reported_summary,
            usage::extract_browser_cookie,
            system::quit_app,
            system::get_debug_log,
            system::clear_debug_log,
            system::get_debug_log_path,
            system::export_debug_log,
            system::check_for_app_update,
            system::install_pending_app_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
