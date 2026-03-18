use std::path::PathBuf;

use tauri::AppHandle;
use crate::core::{clear_debug_log as clear_app_debug_log, debug_log_path, read_debug_log};

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
