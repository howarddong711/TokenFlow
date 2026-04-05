use std::{path::PathBuf, sync::Mutex};

use crate::core::{clear_debug_log as clear_app_debug_log, debug_log_path, read_debug_log};
use crate::platform::{current_release_channel, ReleaseChannel};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};

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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdatePolicy {
    channel: String,
    in_app_updates_enabled: bool,
}

fn app_update_policy_for_channel(channel: ReleaseChannel) -> AppUpdatePolicy {
    AppUpdatePolicy {
        channel: channel.as_str().to_string(),
        in_app_updates_enabled: channel.in_app_updates_enabled(),
    }
}

fn updater_disabled_reason(channel: ReleaseChannel) -> String {
    if matches!(channel, ReleaseChannel::MacAppStore) {
        return "This build is distributed via the Mac App Store. Please update TokenFlow through the App Store.".to_string();
    }

    "In-app updates are disabled for this build channel.".to_string()
}

pub fn app_update_policy() -> AppUpdatePolicy {
    app_update_policy_for_channel(current_release_channel())
}

pub fn in_app_updater_enabled() -> bool {
    app_update_policy().in_app_updates_enabled
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn get_app_update_policy() -> AppUpdatePolicy {
    app_update_policy()
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
    let channel = current_release_channel();
    if !channel.in_app_updates_enabled() {
        return Err(updater_disabled_reason(channel));
    }

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
    let channel = current_release_channel();
    if !channel.in_app_updates_enabled() {
        return Err(updater_disabled_reason(channel));
    }

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
    {
        let _ = app;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        app.restart();
    }
}

#[cfg(test)]
mod tests {
    use super::app_update_policy_for_channel;
    use crate::platform::ReleaseChannel;

    #[test]
    fn github_channel_keeps_in_app_updates() {
        let policy = app_update_policy_for_channel(ReleaseChannel::GitHub);
        assert_eq!(policy.channel, "github");
        assert!(policy.in_app_updates_enabled);
    }

    #[test]
    fn app_store_channel_disables_in_app_updates() {
        let policy = app_update_policy_for_channel(ReleaseChannel::MacAppStore);
        assert_eq!(policy.channel, "mac_app_store");
        assert!(!policy.in_app_updates_enabled);
    }
}
