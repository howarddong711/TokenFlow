use std::path::Path;

use serde::Serialize;

use crate::providers::claude::ClaudeOAuthFetcher;

#[derive(Debug, Serialize)]
pub struct ClaudeOAuthStartResponse {
    pub previous_fingerprint: Option<String>,
    pub status_text: String,
}

#[derive(Debug, Serialize)]
pub struct ClaudeOAuthPollResponse {
    pub completed: bool,
    pub fingerprint: Option<String>,
    pub credentials: Option<crate::core::OAuthCredentials>,
}

#[tauri::command]
pub async fn start_claude_oauth_login() -> Result<ClaudeOAuthStartResponse, String> {
    let fetcher = ClaudeOAuthFetcher::new();
    let previous_fingerprint = fetcher
        .credentials_fingerprint()
        .map_err(|err| err.to_string())?;

    let claude_path = which::which("claude").map_err(|_| {
        "Claude CLI not found. Install Claude Code and make sure `claude` is in PATH.".to_string()
    })?;

    launch_claude_login(&claude_path)?;

    Ok(ClaudeOAuthStartResponse {
        previous_fingerprint,
        status_text: "Claude CLI login launched. Complete sign-in in the opened window/browser."
            .to_string(),
    })
}

#[cfg(windows)]
fn launch_claude_login(claude_path: &Path) -> Result<(), String> {
    let escaped_path = claude_path.display().to_string().replace('\'', "''");
    let command = format!(
        "Start-Process -FilePath '{}' -ArgumentList 'login'",
        escaped_path
    );

    std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &command])
        .spawn()
        .map_err(|err| format!("Failed to launch Claude login: {err}"))?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn launch_claude_login(claude_path: &Path) -> Result<(), String> {
    let command = format!("'{}' login", escape_shell_single_quoted(claude_path));
    let script = format!(
        "tell application \"Terminal\" to do script \"{}\"",
        escape_applescript_string(&command)
    );

    // Prefer launching in Terminal so interactive auth flows behave consistently.
    let launch_result = std::process::Command::new("osascript")
        .args(["-e", "tell application \"Terminal\" to activate"])
        .args(["-e", &script])
        .spawn();

    if launch_result.is_ok() {
        return Ok(());
    }

    // Fallback to direct process launch if AppleScript is unavailable.
    std::process::Command::new(claude_path)
        .arg("login")
        .spawn()
        .map_err(|err| format!("Failed to launch Claude login: {err}"))?;

    Ok(())
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn launch_claude_login(claude_path: &Path) -> Result<(), String> {
    std::process::Command::new(claude_path)
        .arg("login")
        .spawn()
        .map_err(|err| format!("Failed to launch Claude login: {err}"))?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn escape_applescript_string(input: &str) -> String {
    input.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(target_os = "macos")]
fn escape_shell_single_quoted(path: &Path) -> String {
    path.display().to_string().replace('\'', "'\\''")
}

#[tauri::command]
pub async fn poll_claude_oauth_login(
    previous_fingerprint: Option<String>,
) -> Result<ClaudeOAuthPollResponse, String> {
    let fetcher = ClaudeOAuthFetcher::new();
    let current_fingerprint = fetcher
        .credentials_fingerprint()
        .map_err(|err| err.to_string())?;

    if current_fingerprint.is_none() || current_fingerprint == previous_fingerprint {
        return Ok(ClaudeOAuthPollResponse {
            completed: false,
            fingerprint: current_fingerprint,
            credentials: None,
        });
    }

    let credentials = fetcher
        .load_core_credentials()
        .map_err(|err| err.to_string())?;

    Ok(ClaudeOAuthPollResponse {
        completed: true,
        fingerprint: current_fingerprint,
        credentials: Some(credentials),
    })
}
