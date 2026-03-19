use std::{path::PathBuf, sync::Mutex};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};
use crate::core::{clear_debug_log as clear_app_debug_log, debug_log_path, read_debug_log};

pub struct PendingAppUpdate(pub Mutex<Option<Update>>);

impl Default for PendingAppUpdate {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
    published_at: Option<String>,
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn get_debug_log(app: AppHandle) -> Result<String, String> {
    read_debug_log(&app)
}

#[tauri::command]
pub fn clear_debug_log(app: AppHandle) -> Result<(), String> {
    clear_app_debug_log(&app)
}

#[tauri::command]
pub fn get_debug_log_path(app: AppHandle) -> Result<String, String> {
    debug_log_path(&app).map(|path| path.display().to_string())
}

#[tauri::command]
pub fn export_debug_log(app: AppHandle, destination: String) -> Result<(), String> {
    let target = PathBuf::from(destination);

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    let content = read_debug_log(&app)?;
    std::fs::write(&target, content).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn check_for_app_update(
    app: AppHandle,
    pending_update: tauri::State<'_, PendingAppUpdate>,
) -> Result<Option<AppUpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|err| err.to_string())?
        .check()
        .await
        .map_err(|err| err.to_string())?;

    let info = update.as_ref().map(|update| AppUpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        published_at: update.date.map(|date| date.to_string()),
    });

    *pending_update.0.lock().map_err(|err| err.to_string())? = update;

    Ok(info)
}

#[tauri::command]
pub async fn install_pending_app_update(
    app: AppHandle,
    pending_update: tauri::State<'_, PendingAppUpdate>,
) -> Result<(), String> {
    let update = pending_update
        .0
        .lock()
        .map_err(|err| err.to_string())?
        .take()
        .ok_or_else(|| "No pending update. Please check for updates again.".to_string())?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|err| err.to_string())?;

    #[cfg(target_os = "windows")]
    let _ = app;

    #[cfg(not(target_os = "windows"))]
    app.restart();

    Ok(())
}
