//! Antigravity provider implementation
//!
//! Fetches usage data from Antigravity's local language server probe
//! Uses Windows process detection to find CSRF token

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use regex_lite::Regex;
use serde::Deserialize;
use std::collections::HashMap;
use std::env;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;

use crate::core::{
    FetchContext, NamedRateWindow, OAuthCredentials, Provider, ProviderError, ProviderFetchResult,
    ProviderId, ProviderMetadata, RateWindow, SourceMode, UsageSnapshot,
};

const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const USER_INFO_ENDPOINT: &str = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";
const LOAD_CODE_ASSIST_ENDPOINTS: [&str; 3] = [
    "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist",
    "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
];
const ONBOARD_USER_ENDPOINTS: [&str; 2] = [
    "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:onboardUser",
    "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
];
const FETCH_AVAILABLE_MODELS_ENDPOINTS: [&str; 3] = [
    "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
    "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels",
    "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
];
const USER_AGENT: &str = "google-api-nodejs-client/9.15.1";
const X_GOOG_API_CLIENT: &str = "google-cloud-sdk vscode_cloudshelleditor/0.1";
const REMOTE_USER_AGENT: &str = "AntigravityQuotaWatcher/1.0";
const REMOTE_ANTIGRAVITY_USER_AGENT: &str = "antigravity/1.11.3 windows/amd64";
const DEFAULT_WINDOW_MINUTES: u32 = 24 * 60;

/// Antigravity provider
pub struct AntigravityProvider {
    metadata: ProviderMetadata,
}

impl AntigravityProvider {
    fn is_antigravity_command_line(command_line: &str) -> bool {
        let lower = command_line.to_lowercase();
        Regex::new(r"--app_data_dir[=\s]+antigravity\b")
            .expect("valid regex")
            .is_match(command_line)
            || lower.contains("\\antigravity\\")
            || lower.contains("/antigravity/")
    }

    fn client_id() -> Result<String, ProviderError> {
        env::var("TOKENFLOW_ANTIGRAVITY_CLIENT_ID")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                ProviderError::Other("Missing TOKENFLOW_ANTIGRAVITY_CLIENT_ID".to_string())
            })
    }

    fn client_secret() -> Result<String, ProviderError> {
        env::var("TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                ProviderError::Other("Missing TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET".to_string())
            })
    }

    pub fn new() -> Self {
        Self {
            metadata: ProviderMetadata {
                id: ProviderId::Antigravity,
                display_name: "Antigravity",
                session_label: "Claude",
                weekly_label: "Gemini Pro",
                supports_opus: true,
                supports_credits: false,
                default_enabled: false,
                is_primary: false,
                dashboard_url: None,
                status_page_url: None,
            },
        }
    }

    /// Detect running Antigravity language server and extract connection info
    fn detect_process_info() -> Result<ProcessInfo, ProviderError> {
        #[cfg(windows)]
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let mut cmd = Command::new("powershell.exe");
        cmd.args([
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*language_server*' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
        ]);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd
            .output()
            .map_err(|e| ProviderError::Other(format!("Failed to run PowerShell: {}", e)))?;

        if !output.status.success() {
            return Err(ProviderError::NotInstalled(
                "Failed to detect Antigravity process".to_string(),
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let payload = stdout.trim();

        if payload.is_empty() {
            return Err(ProviderError::NotInstalled(
                "Antigravity language server not running".to_string(),
            ));
        }

        let value = serde_json::from_str::<serde_json::Value>(payload).map_err(|err| {
            ProviderError::Parse(format!(
                "Failed to parse Antigravity process list from PowerShell: {err}"
            ))
        })?;
        let processes = match value {
            serde_json::Value::Array(items) => items,
            serde_json::Value::Object(_) => vec![value],
            _ => {
                return Err(ProviderError::Parse(
                    "Unexpected Antigravity process list payload".to_string(),
                ));
            }
        };

        let csrf_regex = Regex::new(r"--csrf(?:_|-)token[=\s]+([a-f0-9-]+)").expect("valid regex");
        let extension_port_regex =
            Regex::new(r"--extension_server_port[=\s]+(\d+)").expect("valid regex");
        let connect_port_regex =
            Regex::new(r"--connect(?:_|-)port[=\s]+(\d+)").expect("valid regex");

        for process in processes {
            let command_line = process
                .get("CommandLine")
                .and_then(|value| value.as_str())
                .unwrap_or_default();

            if command_line.is_empty() || !Self::is_antigravity_command_line(command_line) {
                continue;
            }

            let pid = process
                .get("ProcessId")
                .and_then(|value| value.as_u64())
                .and_then(|value| u32::try_from(value).ok());
            let csrf_token = csrf_regex
                .captures(command_line)
                .and_then(|captures| captures.get(1))
                .map(|value| value.as_str().to_string());
            let extension_port = extension_port_regex
                .captures(command_line)
                .and_then(|captures| captures.get(1))
                .and_then(|value| value.as_str().parse::<u16>().ok());
            let connect_port = connect_port_regex
                .captures(command_line)
                .and_then(|captures| captures.get(1))
                .and_then(|value| value.as_str().parse::<u16>().ok());

            if let (Some(pid), Some(csrf_token)) = (pid, csrf_token) {
                return Ok(ProcessInfo {
                    pid,
                    csrf_token,
                    extension_port,
                    connect_port,
                });
            }
        }

        Err(ProviderError::NotInstalled(
            "Antigravity language server not running".to_string(),
        ))
    }

    fn list_listening_ports(pid: u32) -> Result<Vec<u16>, ProviderError> {
        #[cfg(windows)]
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let mut cmd = Command::new("netstat.exe");
        cmd.args(["-ano"]);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd
            .output()
            .map_err(|e| ProviderError::Other(format!("Failed to run netstat: {e}")))?;

        if !output.status.success() {
            return Err(ProviderError::Other(
                "Failed to inspect Antigravity listening ports".to_string(),
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let regex = Regex::new(r"(?i)^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$")
            .expect("valid regex");
        let mut ports = Vec::new();

        for line in stdout.lines() {
            let Some(captures) = regex.captures(line) else {
                continue;
            };
            let local_address = captures
                .get(1)
                .map(|value| value.as_str())
                .unwrap_or_default();
            let port = captures
                .get(2)
                .and_then(|value| value.as_str().parse::<u16>().ok());
            let line_pid = captures
                .get(3)
                .and_then(|value| value.as_str().parse::<u32>().ok());

            if line_pid != Some(pid) {
                continue;
            }

            if !local_address.starts_with("127.0.0.1")
                && !local_address.starts_with("0.0.0.0")
                && !local_address.starts_with("[::1]")
                && !local_address.starts_with("[::]")
            {
                continue;
            }

            if let Some(port) = port {
                if !ports.contains(&port) {
                    ports.push(port);
                }
            }
        }

        ports.sort_unstable();
        Ok(ports)
    }

    /// Find the actual API port by checking listening ports
    async fn find_api_port(process_info: &ProcessInfo) -> Result<u16, ProviderError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .danger_accept_invalid_certs(true)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        let mut candidate_ports = Vec::new();
        if let Some(connect_port) = process_info.connect_port {
            candidate_ports.push(connect_port);
        }
        candidate_ports.extend(Self::list_listening_ports(process_info.pid)?);
        if let Some(extension_port) = process_info.extension_port {
            for offset in 0..20 {
                let port = extension_port.saturating_add(offset);
                if !candidate_ports.contains(&port) {
                    candidate_ports.push(port);
                }
            }
        }
        for port in [53835, 53836, 53837, 53838, 53845, 53849] {
            if !candidate_ports.contains(&port) {
                candidate_ports.push(port);
            }
        }

        tracing::info!(
            "Antigravity local probe candidate ports for pid {}: {:?}",
            process_info.pid,
            candidate_ports
        );

        for port in candidate_ports {
            let url = format!(
                "https://127.0.0.1:{}/exa.language_server_pb.LanguageServerService/GetUnleashData",
                port
            );

            if let Ok(resp) = client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("Connect-Protocol-Version", "1")
                .header("X-Codeium-Csrf-Token", &process_info.csrf_token)
                .body("{}")
                .send()
                .await
            {
                if resp.status().is_success() {
                    return Ok(port);
                }
            }
        }

        Err(ProviderError::Other(
            "Could not find Antigravity API port".to_string(),
        ))
    }

    /// Fetch user status from Antigravity API
    async fn fetch_user_status(&self) -> Result<UsageSnapshot, ProviderError> {
        let process_info = Self::detect_process_info()?;
        tracing::info!(
            "Antigravity process detected: pid={} extension_port={:?} connect_port={:?}",
            process_info.pid,
            process_info.extension_port,
            process_info.connect_port
        );
        let api_port = Self::find_api_port(&process_info).await?;

        // SECURITY: TLS verification disabled for local language server (see find_api_port)
        let https_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .danger_accept_invalid_certs(true)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| ProviderError::Other(e.to_string()))?;
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        let url = format!(
            "https://127.0.0.1:{}/exa.language_server_pb.LanguageServerService/GetUserStatus",
            api_port
        );

        let body = serde_json::json!({
            "metadata": {
                "ideName": "antigravity",
                "extensionName": "antigravity",
                "ideVersion": "unknown",
                "locale": "en"
            }
        });

        let response = match https_client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Connect-Protocol-Version", "1")
            .header("X-Codeium-Csrf-Token", &process_info.csrf_token)
            .json(&body)
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => response,
            Ok(response) => {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                tracing::warn!(
                    "Antigravity HTTPS GetUserStatus failed on port {} with status {}: {}",
                    api_port,
                    status,
                    text
                );

                let fallback_port = process_info.extension_port.unwrap_or(api_port);
                let fallback_url = format!(
                    "http://127.0.0.1:{}/exa.language_server_pb.LanguageServerService/GetUserStatus",
                    fallback_port
                );
                http_client
                    .post(&fallback_url)
                    .header("Content-Type", "application/json")
                    .header("Connect-Protocol-Version", "1")
                    .header("X-Codeium-Csrf-Token", &process_info.csrf_token)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| {
                        ProviderError::Other(format!("HTTP fallback request failed: {e}"))
                    })?
            }
            Err(err) => {
                tracing::warn!(
                    "Antigravity HTTPS GetUserStatus transport failed on port {}: {}",
                    api_port,
                    err
                );

                let fallback_port = process_info.extension_port.unwrap_or(api_port);
                let fallback_url = format!(
                    "http://127.0.0.1:{}/exa.language_server_pb.LanguageServerService/GetUserStatus",
                    fallback_port
                );
                http_client
                    .post(&fallback_url)
                    .header("Content-Type", "application/json")
                    .header("Connect-Protocol-Version", "1")
                    .header("X-Codeium-Csrf-Token", &process_info.csrf_token)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| {
                        ProviderError::Other(format!("HTTP fallback request failed: {e}"))
                    })?
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(ProviderError::Other(format!(
                "Antigravity GetUserStatus returned {status}: {text}"
            )));
        }

        let json: UserStatusResponse = response
            .json()
            .await
            .map_err(|e| ProviderError::Other(format!("Failed to parse response: {}", e)))?;

        self.parse_user_status(json)
    }

    fn parse_user_status(
        &self,
        response: UserStatusResponse,
    ) -> Result<UsageSnapshot, ProviderError> {
        let user_status = response
            .user_status
            .ok_or_else(|| ProviderError::Other("Missing userStatus".to_string()))?;

        let model_configs = user_status
            .cascade_model_config_data
            .and_then(|d| d.client_model_configs)
            .unwrap_or_default();

        // Select models: prefer Claude (non-thinking), then Gemini Pro Low, then Gemini Flash
        let mut primary: Option<RateWindow> = None;
        let mut secondary: Option<RateWindow> = None;
        let mut tertiary: Option<RateWindow> = None;

        for config in &model_configs {
            let label_lower = config.label.to_lowercase();

            if primary.is_none()
                && label_lower.contains("claude")
                && !label_lower.contains("thinking")
            {
                if let Some(quota) = &config.quota_info {
                    let remaining = quota.remaining_fraction.unwrap_or(1.0);
                    let used_percent = (1.0 - remaining) * 100.0;
                    primary = Some(RateWindow::with_details(
                        used_percent,
                        None,
                        None,
                        quota.reset_time.clone(),
                    ));
                }
            } else if secondary.is_none()
                && label_lower.contains("pro")
                && label_lower.contains("low")
            {
                if let Some(quota) = &config.quota_info {
                    let remaining = quota.remaining_fraction.unwrap_or(1.0);
                    let used_percent = (1.0 - remaining) * 100.0;
                    secondary = Some(RateWindow::with_details(
                        used_percent,
                        None,
                        None,
                        quota.reset_time.clone(),
                    ));
                }
            } else if tertiary.is_none() && label_lower.contains("flash") {
                if let Some(quota) = &config.quota_info {
                    let remaining = quota.remaining_fraction.unwrap_or(1.0);
                    let used_percent = (1.0 - remaining) * 100.0;
                    tertiary = Some(RateWindow::with_details(
                        used_percent,
                        None,
                        None,
                        quota.reset_time.clone(),
                    ));
                }
            }
        }

        // If no primary found, use first available model
        if primary.is_none() {
            if let Some(first) = model_configs.first() {
                if let Some(quota) = &first.quota_info {
                    let remaining = quota.remaining_fraction.unwrap_or(1.0);
                    let used_percent = (1.0 - remaining) * 100.0;
                    primary = Some(RateWindow::with_details(
                        used_percent,
                        None,
                        None,
                        quota.reset_time.clone(),
                    ));
                }
            }
        }

        let primary = primary.unwrap_or_else(|| RateWindow::new(0.0));
        let extra_windows = model_configs.iter().filter_map(|config| {
            let quota = config.quota_info.as_ref()?;
            Some(
                NamedRateWindow::new(
                    format!(
                        "antigravity-local:{}",
                        config
                            .model_or_alias
                            .as_ref()
                            .and_then(|value| value.model.clone())
                            .unwrap_or_else(|| config.label.clone())
                    ),
                    config.label.clone(),
                    RateWindow::with_details(
                        (1.0 - quota.remaining_fraction.unwrap_or(1.0)) * 100.0,
                        None,
                        None,
                        quota.reset_time.clone(),
                    ),
                )
                .with_kind("model"),
            )
        });
        let mut snapshot = UsageSnapshot::new(primary).with_extra_windows(extra_windows);

        if let Some(sec) = secondary {
            snapshot = snapshot.with_secondary(sec);
        }
        if let Some(ter) = tertiary {
            snapshot = snapshot.with_model_specific(ter);
        }

        if let Some(email) = user_status
            .email
            .clone()
            .filter(|value| !value.trim().is_empty())
        {
            snapshot = snapshot.with_email(email);
        }

        let plan_name = user_status
            .user_tier
            .as_ref()
            .and_then(|tier| tier.name.clone())
            .or_else(|| {
                user_status
                    .plan_status
                    .and_then(|ps| ps.plan_info)
                    .and_then(|pi| pi.plan_display_name.or(pi.plan_name))
            });

        if let Some(plan) = plan_name {
            snapshot = snapshot.with_login_method(&plan);
        }

        Ok(snapshot)
    }

    fn build_remote_client() -> Result<reqwest::Client, ProviderError> {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .http1_only()
            .build()
            .map_err(|e| {
                ProviderError::Other(format!("Failed to build Anti-Gravity HTTP client: {e}"))
            })
    }

    async fn fetch_google_user_info(
        &self,
        access_token: &str,
    ) -> Result<GoogleUserInfo, ProviderError> {
        let response = Self::build_remote_client()?
            .get(USER_INFO_ENDPOINT)
            .bearer_auth(access_token)
            .send()
            .await?;

        if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            return Err(ProviderError::AuthRequired);
        }

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::Other(format!(
                "Google user info endpoint returned {status}: {body}"
            )));
        }

        response
            .json::<GoogleUserInfo>()
            .await
            .map_err(|err| ProviderError::Parse(format!("Failed to parse Google user info: {err}")))
    }

    async fn fetch_project_context(
        &self,
        access_token: &str,
    ) -> Result<ProjectContext, ProviderError> {
        let payload = serde_json::json!({
            "metadata": {
                "ideType": "ANTIGRAVITY"
            }
        });

        let client = Self::build_remote_client()?;
        let mut last_error = None;

        for endpoint in LOAD_CODE_ASSIST_ENDPOINTS {
            let response = client
                .post(endpoint)
                .bearer_auth(access_token)
                .header("Content-Type", "application/json")
                .header("User-Agent", REMOTE_USER_AGENT)
                .json(&payload)
                .send()
                .await;

            match response {
                Ok(response) => {
                    if response.status().as_u16() == 401 {
                        return Err(ProviderError::AuthRequired);
                    }

                    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
                        || response.status().is_server_error()
                    {
                        last_error = Some(ProviderError::Other(format!(
                            "Anti-Gravity loadCodeAssist returned {}",
                            response.status()
                        )));
                        continue;
                    }

                    if !response.status().is_success() {
                        let status = response.status().as_u16();
                        let body = response.text().await.unwrap_or_default();
                        last_error = Some(ProviderError::Other(format!(
                            "Anti-Gravity loadCodeAssist returned {status}: {body}"
                        )));
                        continue;
                    }

                    let data = response
                        .json::<LoadCodeAssistResponse>()
                        .await
                        .map_err(|err| {
                            ProviderError::Parse(format!(
                                "Failed to parse Anti-Gravity project context: {err}"
                            ))
                        })?;

                    let subscription_tier = data.resolve_subscription_tier();
                    let project_id = match data.project_id() {
                        Some(project_id) => Some(project_id),
                        None => {
                            let tier_id = data.default_onboard_tier_id();
                            if let Some(tier_id) = tier_id {
                                self.onboard_user(access_token, &tier_id).await?
                            } else {
                                None
                            }
                        }
                    };
                    tracing::info!(
                        "Anti-Gravity project context resolved: project_id_present={} tier={:?}",
                        project_id
                            .as_ref()
                            .is_some_and(|value| !value.trim().is_empty()),
                        subscription_tier
                    );
                    return Ok(ProjectContext {
                        project_id,
                        subscription_tier,
                    });
                }
                Err(err) => {
                    last_error = Some(ProviderError::Network(err));
                }
            }
        }

        if let Some(err) = last_error {
            tracing::warn!(
                "Anti-Gravity loadCodeAssist did not return a stable project context: {err}"
            );
        }

        Ok(ProjectContext::default())
    }

    async fn onboard_user(
        &self,
        access_token: &str,
        tier_id: &str,
    ) -> Result<Option<String>, ProviderError> {
        let client = Self::build_remote_client()?;
        let payload = serde_json::json!({
            "tierId": tier_id,
            "metadata": {
                "ideType": "ANTIGRAVITY",
                "platform": "PLATFORM_UNSPECIFIED",
                "pluginType": "GEMINI"
            }
        });

        for endpoint in ONBOARD_USER_ENDPOINTS {
            for attempt in 0..5 {
                let response = client
                    .post(endpoint)
                    .bearer_auth(access_token)
                    .header("Content-Type", "application/json")
                    .header("User-Agent", REMOTE_ANTIGRAVITY_USER_AGENT)
                    .json(&payload)
                    .send()
                    .await;

                match response {
                    Ok(response) => {
                        if response.status().as_u16() == 401 {
                            return Err(ProviderError::AuthRequired);
                        }

                        if !response.status().is_success() {
                            let status = response.status().as_u16();
                            let body = response.text().await.unwrap_or_default();
                            tracing::warn!(
                                "Anti-Gravity onboardUser returned {} on attempt {}: {}",
                                status,
                                attempt + 1,
                                body
                            );
                            break;
                        }

                        let data = response
                            .json::<OnboardUserResponse>()
                            .await
                            .map_err(|err| {
                                ProviderError::Parse(format!(
                                    "Failed to parse Anti-Gravity onboardUser response: {err}"
                                ))
                            })?;

                        if data.done.unwrap_or(false) {
                            return Ok(data.response.and_then(|value| value.project_id()));
                        }

                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    }
                    Err(err) => {
                        tracing::warn!(
                            "Anti-Gravity onboardUser transport failed on attempt {}: {}",
                            attempt + 1,
                            err
                        );
                        break;
                    }
                }
            }
        }

        Ok(None)
    }

    async fn fetch_available_models(
        &self,
        access_token: &str,
        project_id: Option<&str>,
    ) -> Result<FetchAvailableModelsResponse, ProviderError> {
        let payload = match project_id {
            Some(project_id) if !project_id.trim().is_empty() => {
                serde_json::json!({ "project": project_id })
            }
            _ => serde_json::json!({}),
        };

        let client = Self::build_remote_client()?;
        let mut last_error = None;

        for endpoint in FETCH_AVAILABLE_MODELS_ENDPOINTS {
            let response = client
                .post(endpoint)
                .bearer_auth(access_token)
                .header("Content-Type", "application/json")
                .header("User-Agent", REMOTE_USER_AGENT)
                .json(&payload)
                .send()
                .await;

            match response {
                Ok(response) => {
                    if response.status().as_u16() == 401 {
                        return Err(ProviderError::AuthRequired);
                    }

                    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
                        || response.status().is_server_error()
                    {
                        last_error = Some(ProviderError::Other(format!(
                            "Anti-Gravity fetchAvailableModels returned {}",
                            response.status()
                        )));
                        continue;
                    }

                    if !response.status().is_success() {
                        let status = response.status().as_u16();
                        let body = response.text().await.unwrap_or_default();
                        return Err(ProviderError::Other(format!(
                            "Anti-Gravity fetchAvailableModels returned {status}: {body}"
                        )));
                    }

                    return response
                        .json::<FetchAvailableModelsResponse>()
                        .await
                        .map(|parsed| {
                            tracing::info!(
                                "Anti-Gravity fetchAvailableModels returned {} raw models",
                                parsed.models.len()
                            );
                            parsed
                        })
                        .map_err(|err| {
                            ProviderError::Parse(format!(
                                "Failed to parse Anti-Gravity model quotas: {err}"
                            ))
                        });
                }
                Err(err) => {
                    last_error = Some(ProviderError::Network(err));
                }
            }
        }

        Err(last_error.unwrap_or_else(|| {
            ProviderError::Other("Failed to fetch Anti-Gravity model quotas".to_string())
        }))
    }

    fn parse_oauth_models_response(
        &self,
        response: FetchAvailableModelsResponse,
        login_method: Option<String>,
    ) -> Result<UsageSnapshot, ProviderError> {
        let mut models = response
            .models
            .into_iter()
            .filter_map(|(model_id, info)| {
                let quota_info = info.quota_info?;
                let remaining_fraction = quota_info.remaining_fraction?;

                let used_percent = ((1.0 - remaining_fraction).clamp(0.0, 1.0)) * 100.0;
                let label = info
                    .display_name
                    .unwrap_or_else(|| humanize_model_name(&model_id));
                let family = classify_model_family(info.supports_images.unwrap_or(false), &label);

                Some(ModelQuotaWindow {
                    id: model_id,
                    label,
                    remaining_fraction,
                    used_percent,
                    reset_time_raw: quota_info.reset_time.clone(),
                    resets_at: quota_info.reset_time.as_deref().and_then(parse_iso_date),
                    family,
                })
            })
            .collect::<Vec<_>>();

        tracing::info!(
            "Anti-Gravity usable quota windows after parsing: {}",
            models.len()
        );
        tracing::info!(
            "Anti-Gravity parsed model windows: {}",
            models
                .iter()
                .map(|model| format!(
                    "{} | {} | remaining={:.1}% | used={:.1}% | reset={}",
                    model.id,
                    model.label,
                    model.remaining_fraction * 100.0,
                    model.used_percent,
                    model
                        .reset_time_raw
                        .as_deref()
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or("n/a")
                ))
                .collect::<Vec<_>>()
                .join(" || ")
        );

        if models.is_empty() {
            return Err(ProviderError::Parse(
                "Anti-Gravity quota response did not contain any model windows".to_string(),
            ));
        }

        models.sort_by(|left, right| {
            right
                .used_percent
                .partial_cmp(&left.used_percent)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.label.cmp(&right.label))
        });

        let most_constrained = &models[0];
        let primary = RateWindow::with_details(
            most_constrained.used_percent,
            Some(DEFAULT_WINDOW_MINUTES),
            most_constrained.resets_at,
            Some(format!(
                "Most constrained model: {}",
                most_constrained.label
            )),
        );

        let model_specific = models
            .iter()
            .skip(1)
            .find(|model| model.family != most_constrained.family)
            .map(ModelQuotaWindow::to_rate_window);

        let extra_windows = models.iter().map(|model| {
            NamedRateWindow::new(
                format!("antigravity-model:{}", model.id),
                model.label.clone(),
                model.to_rate_window(),
            )
            .with_kind("model")
        });

        let mut usage = UsageSnapshot::new(primary).with_extra_windows(extra_windows);
        if let Some(model_specific) = model_specific {
            usage = usage.with_model_specific(model_specific);
        }
        if let Some(login_method) = login_method.or_else(|| Some("Free".to_string()))
        {
            usage = usage.with_login_method(login_method);
        }

        Ok(usage)
    }

    async fn refresh_access_token(
        &self,
        refresh_token: &str,
    ) -> Result<GoogleRefreshResponse, ProviderError> {
        let client_id = Self::client_id()?;
        let client_secret = Self::client_secret()?;
        let response = reqwest::Client::new()
            .post(TOKEN_ENDPOINT)
            .form(&[
                ("refresh_token", refresh_token),
                ("client_id", client_id.as_str()),
                ("client_secret", client_secret.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::Other(format!(
                "Google refresh endpoint returned {status}: {body}"
            )));
        }

        response
            .json::<GoogleRefreshResponse>()
            .await
            .map_err(|err| {
                ProviderError::Parse(format!("Failed to parse Google refresh response: {err}"))
            })
    }

    async fn fetch_usage_via_oauth(
        &self,
        credentials: &OAuthCredentials,
    ) -> Result<ProviderFetchResult, ProviderError> {
        let mut access_token = self.resolve_oauth_access_token(credentials).await?;

        let user = match self.fetch_google_user_info(&access_token).await {
            Ok(user) => user,
            Err(ProviderError::AuthRequired) => {
                access_token = self.refresh_oauth_access_token(credentials).await?;
                self.fetch_google_user_info(&access_token).await?
            }
            Err(err) => return Err(err),
        };

        let project_context = match self.fetch_project_context(&access_token).await {
            Ok(status) => status,
            Err(ProviderError::AuthRequired) => {
                access_token = self.refresh_oauth_access_token(credentials).await?;
                self.fetch_project_context(&access_token).await?
            }
            Err(err) => return Err(err),
        };

        let models = match self
            .fetch_available_models(&access_token, project_context.project_id.as_deref())
            .await
        {
            Ok(models) => models,
            Err(ProviderError::AuthRequired) => {
                access_token = self.refresh_oauth_access_token(credentials).await?;
                self.fetch_available_models(&access_token, project_context.project_id.as_deref())
                    .await?
            }
            Err(err) => return Err(err),
        };
        let mut usage =
            self.parse_oauth_models_response(models, project_context.subscription_tier)?;

        if let Some(email) = user.email.filter(|value| !value.trim().is_empty()) {
            usage = usage.with_email(email);
        }
        if let Some(project) = project_context
            .project_id
            .filter(|value| !value.trim().is_empty())
        {
            usage = usage.with_organization(project);
        }

        Ok(ProviderFetchResult::new(usage, "oauth"))
    }

    async fn resolve_oauth_access_token(
        &self,
        credentials: &OAuthCredentials,
    ) -> Result<String, ProviderError> {
        if credentials.refresh_token.is_some() {
            match self.refresh_oauth_access_token(credentials).await {
                Ok(access_token) => {
                    tracing::info!("Anti-Gravity OAuth access token refreshed before quota fetch");
                    return Ok(access_token);
                }
                Err(err) => {
                    tracing::warn!(
                        "Anti-Gravity OAuth proactive refresh failed, falling back to stored access token: {}",
                        err
                    );
                }
            }
        }

        if credentials.is_expired() {
            return Err(ProviderError::AuthRequired);
        }

        Ok(credentials.access_token.clone())
    }

    async fn refresh_oauth_access_token(
        &self,
        credentials: &OAuthCredentials,
    ) -> Result<String, ProviderError> {
        let refresh_token = credentials
            .refresh_token
            .as_deref()
            .ok_or(ProviderError::AuthRequired)?;
        self.refresh_access_token(refresh_token)
            .await
            .map(|response| response.access_token)
    }
}

impl Default for AntigravityProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Provider for AntigravityProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Antigravity
    }

    fn metadata(&self) -> &ProviderMetadata {
        &self.metadata
    }

    async fn fetch_usage(&self, ctx: &FetchContext) -> Result<ProviderFetchResult, ProviderError> {
        if matches!(ctx.source_mode, SourceMode::OAuth) {
            let credentials = ctx
                .oauth_credentials
                .as_ref()
                .ok_or(ProviderError::AuthRequired)?;
            tracing::debug!("Fetching Anti-Gravity usage via explicit OAuth source");
            return self.fetch_usage_via_oauth(credentials).await;
        }

        if let Some(credentials) = ctx.oauth_credentials.as_ref() {
            tracing::debug!("Fetching Anti-Gravity usage via OAuth (remote-first)");
            match self.fetch_usage_via_oauth(credentials).await {
                Ok(result) => return Ok(result),
                Err(err) => {
                    tracing::warn!("Anti-Gravity OAuth fetch failed: {}", err);
                    if matches!(ctx.source_mode, SourceMode::Cli) {
                        return Err(err);
                    }
                }
            }
        }

        tracing::debug!("Fetching Anti-Gravity usage via local probe fallback");
        match self.fetch_user_status().await {
            Ok(usage) => Ok(ProviderFetchResult::new(usage, "local")),
            Err(e) => Err(e),
        }
    }

    fn available_sources(&self) -> Vec<SourceMode> {
        vec![SourceMode::Auto, SourceMode::OAuth, SourceMode::Cli]
    }

    fn supports_oauth(&self) -> bool {
        true
    }

    fn supports_cli(&self) -> bool {
        true
    }
}

struct ProcessInfo {
    pid: u32,
    csrf_token: String,
    extension_port: Option<u16>,
    connect_port: Option<u16>,
}

// API Response types

#[derive(Debug, Deserialize)]
struct GoogleUserInfo {
    email: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleRefreshResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct LoadCodeAssistResponse {
    #[serde(rename = "cloudaicompanionProject")]
    project_id: Option<String>,
    #[serde(rename = "billingProjectNumber")]
    billing_project_number: Option<String>,
    #[serde(rename = "currentTier")]
    current_tier: Option<Tier>,
    #[serde(rename = "paidTier")]
    paid_tier: Option<Tier>,
    #[serde(rename = "allowedTiers")]
    allowed_tiers: Option<Vec<Tier>>,
    #[serde(rename = "ineligibleTiers")]
    ineligible_tiers: Option<Vec<serde_json::Value>>,
}

impl LoadCodeAssistResponse {
    fn resolve_subscription_tier(&self) -> Option<String> {
        if let Some(tier) = self.paid_tier.as_ref().and_then(Tier::display_name) {
            return Some(tier);
        }

        let is_ineligible = self
            .ineligible_tiers
            .as_ref()
            .is_some_and(|tiers| !tiers.is_empty());

        if !is_ineligible {
            if let Some(tier) = self.current_tier.as_ref().and_then(Tier::display_name) {
                return Some(tier);
            }
        }

        self.allowed_tiers
            .as_ref()
            .and_then(|tiers| tiers.iter().find(|tier| tier.is_default == Some(true)))
            .and_then(Tier::display_name)
            .map(|tier| {
                if is_ineligible {
                    format!("{tier} (Restricted)")
                } else {
                    tier
                }
            })
    }

    fn project_id(&self) -> Option<String> {
        self.project_id
            .clone()
            .or_else(|| self.billing_project_number.clone())
    }

    fn default_onboard_tier_id(&self) -> Option<String> {
        if let Some(default_tier) = self
            .allowed_tiers
            .as_ref()
            .and_then(|tiers| tiers.iter().find(|tier| tier.is_default == Some(true)))
        {
            return default_tier
                .id
                .clone()
                .or_else(|| default_tier.name.clone());
        }

        if self
            .allowed_tiers
            .as_ref()
            .is_some_and(|tiers| !tiers.is_empty())
        {
            return Some("LEGACY".to_string());
        }

        None
    }
}

#[derive(Debug, Default)]
struct ProjectContext {
    project_id: Option<String>,
    subscription_tier: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Tier {
    is_default: Option<bool>,
    id: Option<String>,
    name: Option<String>,
}

impl Tier {
    fn display_name(&self) -> Option<String> {
        self.name.clone().or_else(|| self.id.clone())
    }
}

#[derive(Debug, Deserialize)]
struct FetchAvailableModelsResponse {
    models: HashMap<String, OAuthModelInfo>,
}

#[derive(Debug, Deserialize)]
struct OnboardUserResponse {
    done: Option<bool>,
    response: Option<OnboardUserInnerResponse>,
}

#[derive(Debug, Deserialize)]
struct OnboardUserInnerResponse {
    #[serde(rename = "cloudaicompanionProject")]
    project_id: Option<String>,
    #[serde(rename = "billingProjectNumber")]
    billing_project_number: Option<String>,
}

impl OnboardUserInnerResponse {
    fn project_id(self) -> Option<String> {
        self.project_id.or(self.billing_project_number)
    }
}

#[derive(Debug, Deserialize)]
struct OAuthModelInfo {
    #[serde(rename = "quotaInfo")]
    quota_info: Option<QuotaInfo>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "supportsImages")]
    supports_images: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ModelFamily {
    Pro,
    Flash,
    Image,
    Other,
}

#[derive(Debug, Clone)]
struct ModelQuotaWindow {
    id: String,
    label: String,
    remaining_fraction: f64,
    used_percent: f64,
    reset_time_raw: Option<String>,
    resets_at: Option<DateTime<Utc>>,
    family: ModelFamily,
}

impl ModelQuotaWindow {
    fn to_rate_window(&self) -> RateWindow {
        RateWindow::with_details(
            self.used_percent,
            Some(DEFAULT_WINDOW_MINUTES),
            self.resets_at,
            None,
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserStatusResponse {
    user_status: Option<UserStatus>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserStatus {
    #[allow(dead_code)]
    email: Option<String>,
    plan_status: Option<PlanStatus>,
    cascade_model_config_data: Option<ModelConfigData>,
    user_tier: Option<UserTier>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanStatus {
    plan_info: Option<PlanInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanInfo {
    plan_name: Option<String>,
    plan_display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelConfigData {
    client_model_configs: Option<Vec<ModelConfig>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelConfig {
    label: String,
    model_or_alias: Option<ModelOrAlias>,
    quota_info: Option<QuotaInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelOrAlias {
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserTier {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuotaInfo {
    remaining_fraction: Option<f64>,
    reset_time: Option<String>,
}

fn parse_iso_date(value: &str) -> Option<DateTime<Utc>> {
    if let Ok(date) = DateTime::parse_from_rfc3339(value) {
        return Some(date.with_timezone(&Utc));
    }

    if let Ok(date) = chrono::DateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%SZ") {
        return Some(date.with_timezone(&Utc));
    }

    None
}

fn classify_model_family(supports_images: bool, label: &str) -> ModelFamily {
    let normalized = label.to_ascii_lowercase();
    if supports_images || normalized.contains("image") || normalized.contains("imagen") {
        return ModelFamily::Image;
    }
    if normalized.contains("flash") {
        return ModelFamily::Flash;
    }
    if normalized.contains("pro") || normalized.contains("claude") {
        return ModelFamily::Pro;
    }
    ModelFamily::Other
}

fn humanize_model_name(model_id: &str) -> String {
    model_id
        .split(['-', '_', '.'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            if part.chars().all(|ch| ch.is_ascii_digit()) {
                part.to_string()
            } else {
                let mut chars = part.chars();
                match chars.next() {
                    Some(first) => {
                        first.to_ascii_uppercase().to_string()
                            + &chars.as_str().to_ascii_lowercase()
                    }
                    None => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
