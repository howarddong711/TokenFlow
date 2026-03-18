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

    let claude_path = which::which("claude")
        .map_err(|_| "Claude CLI not found. Install Claude Code and make sure `claude` is in PATH.".to_string())?;

    #[cfg(windows)]
    {
        let command = format!(
            "Start-Process -FilePath '{}' -ArgumentList 'login'",
            claude_path.display().to_string().replace('"', "\"")
        );
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &command])
            .spawn()
            .map_err(|err| format!("Failed to launch Claude login: {err}"))?;
    }

    #[cfg(not(windows))]
    {
        return Err("Claude OAuth login launch is only implemented for Windows in this phase.".to_string());
    }

    Ok(ClaudeOAuthStartResponse {
        previous_fingerprint,
        status_text: "Claude CLI login launched. Complete sign-in in the opened window/browser.".to_string(),
    })
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
