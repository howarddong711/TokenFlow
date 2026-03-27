use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use chrono::Utc;
use tauri::{AppHandle, Manager, Runtime};

pub fn debug_log_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app data dir: {err}"))?;
    fs::create_dir_all(&base_dir).map_err(|err| {
        format!(
            "Failed to create app data dir {}: {err}",
            base_dir.display()
        )
    })?;
    Ok(base_dir.join("tokenflow-debug.log"))
}

pub fn append_debug_log<R: Runtime>(app: &AppHandle<R>, scope: &str, message: impl AsRef<str>) {
    let Ok(path) = debug_log_path(app) else {
        return;
    };

    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) else {
        return;
    };

    let line = format!(
        "[{}] [{}] {}\n",
        Utc::now().to_rfc3339(),
        scope,
        message.as_ref()
    );
    let _ = file.write_all(line.as_bytes());
}

pub fn read_debug_log<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let path = debug_log_path(app)?;
    match fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(format!(
            "Failed to read debug log {}: {err}",
            path.display()
        )),
    }
}

pub fn clear_debug_log<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let path = debug_log_path(app)?;
    fs::write(&path, "")
        .map_err(|err| format!("Failed to clear debug log {}: {err}", path.display()))
}
