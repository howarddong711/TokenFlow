use tauri::AppHandle;

use crate::tray_icon;

/// Update the tray icon tooltip with a summary of connected providers
#[tauri::command]
pub async fn update_tray_tooltip(app: AppHandle, summary: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_tooltip(Some(&summary))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn update_tray_icon(
    app: AppHandle,
    session_percent: f64,
    weekly_percent: f64,
    is_error: bool,
) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let rgba = tray_icon::create_usage_icon(session_percent, weekly_percent, is_error);
        let image = tauri::image::Image::new_owned(rgba, 32, 32);
        tray.set_icon(Some(image)).map_err(|e| e.to_string())?;
    }

    Ok(())
}
