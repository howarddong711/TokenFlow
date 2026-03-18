//! Antigravity provider implementation
//!
//! Fetches usage data from Antigravity's local language server probe
//! Uses Windows process detection to find CSRF token

use async_trait::async_trait;
use regex_lite::Regex;
use serde::Deserialize;
use std::env;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;

use crate::core::{
    FetchContext, OAuthCredentials, Provider, ProviderError, ProviderFetchResult, ProviderId,
    ProviderMetadata, RateWindow, SourceMode, UsageSnapshot,
};

const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const USER_INFO_ENDPOINT: &str = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";
const API_ENDPOINT: &str = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";

/// Antigravity provider
pub struct AntigravityProvider {
    metadata: ProviderMetadata,
}

impl AntigravityProvider {
    fn client_id() -> Result<String, ProviderError> {
        env::var("TOKENFLOW_ANTIGRAVITY_CLIENT_ID").map_err(|_| {
            ProviderError::Other("Missing TOKENFLOW_ANTIGRAVITY_CLIENT_ID".to_string())
        })
    }

    fn client_secret() -> Result<String, ProviderError> {
        env::var("TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET").map_err(|_| {
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
        // Use PowerShell to get process command lines
        #[cfg(windows)]
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let mut cmd = Command::new("powershell.exe");
        cmd.args([
                "-ExecutionPolicy", "Bypass",
                "-Command",
                "Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*language_server_windows*' } | Select-Object -ExpandProperty CommandLine"
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

        // Parse command line for CSRF token and port
        let csrf_regex = Regex::new(r"--csrf_token\s+([a-f0-9-]+)").unwrap();
        let port_regex = Regex::new(r"--extension_server_port\s+(\d+)").unwrap();

        for line in stdout.lines() {
            if line.contains("language_server_windows") && line.contains("--csrf_token") {
                let csrf_token = csrf_regex
                    .captures(line)
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().to_string());

                let port = port_regex
                    .captures(line)
                    .and_then(|c| c.get(1))
                    .and_then(|m| m.as_str().parse::<u16>().ok());

                if let (Some(token), Some(p)) = (csrf_token, port) {
                    return Ok(ProcessInfo {
                        csrf_token: token,
                        extension_port: p,
                    });
                }
            }
        }

        Err(ProviderError::NotInstalled(
            "Antigravity language server not running".to_string(),
        ))
    }

    /// Find the actual API port by checking listening ports
    async fn find_api_port(extension_port: u16) -> Result<u16, ProviderError> {
        // The language server listens on multiple ports near the extension port
        // Try ports in range extension_port to extension_port + 20
        // SECURITY: TLS verification is disabled because the local language server uses
        // self-signed certificates. This is scoped to 127.0.0.1 only and the port range
        // is limited. We verify the server responds with the expected gRPC endpoint.
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .danger_accept_invalid_certs(true)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        for offset in 0..20 {
            let port = extension_port + offset;
            let url = format!(
                "https://127.0.0.1:{}/exa.language_server_pb.LanguageServerService/GetUnleashData",
                port
            );

            // Just check if the port responds (even with error)
            if let Ok(resp) = client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("Connect-Protocol-Version", "1")
                .body("{}")
                .send()
                .await
            {
                // If we get any response (even error), this is the API port
                if resp.status().as_u16() == 200 || resp.status().as_u16() == 401 {
                    return Ok(port);
                }
            }
        }

        // Fallback: try common ports
        for port in [53835, 53836, 53837, 53838, 53845, 53849] {
            let url = format!(
                "https://127.0.0.1:{}/exa.language_server_pb.LanguageServerService/GetUnleashData",
                port
            );
            if let Ok(resp) = client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("Connect-Protocol-Version", "1")
                .body("{}")
                .send()
                .await
            {
                if resp.status().as_u16() == 200 || resp.status().as_u16() == 401 {
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
        let api_port = Self::find_api_port(process_info.extension_port).await?;

        // SECURITY: TLS verification disabled for local language server (see find_api_port)
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .danger_accept_invalid_certs(true)
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

        let resp = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Connect-Protocol-Version", "1")
            .header("X-Codeium-Csrf-Token", &process_info.csrf_token)
            .json(&body)
            .send()
            .await
            .map_err(|e| ProviderError::Other(format!("API request failed: {}", e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Other(format!(
                "API error {}: {}",
                status, text
            )));
        }

        let json: UserStatusResponse = resp
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
        let mut snapshot = UsageSnapshot::new(primary);

        if let Some(sec) = secondary {
            snapshot = snapshot.with_secondary(sec);
        }
        if let Some(ter) = tertiary {
            snapshot = snapshot.with_model_specific(ter);
        }

        // Add plan info
        let plan_name = user_status
            .plan_status
            .and_then(|ps| ps.plan_info)
            .and_then(|pi| pi.plan_display_name.or(pi.plan_name));

        if let Some(plan) = plan_name {
            snapshot = snapshot.with_login_method(&plan);
        }

        Ok(snapshot)
    }

    async fn fetch_google_user_info(&self, access_token: &str) -> Result<GoogleUserInfo, ProviderError> {
        let response = reqwest::Client::new()
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

    async fn fetch_oauth_status(
        &self,
        access_token: &str,
    ) -> Result<CodeAssistResponse, ProviderError> {
        let response = reqwest::Client::new()
            .post(API_ENDPOINT)
            .bearer_auth(access_token)
            .header("User-Agent", "google-api-nodejs-client/9.15.1")
            .header(
                "X-Goog-Api-Client",
                "google-cloud-sdk vscode_cloudshelleditor/0.1",
            )
            .json(&serde_json::json!({
                "metadata": {
                    "ideType": "ANTIGRAVITY",
                    "platform": "PLATFORM_UNSPECIFIED",
                    "pluginType": "GEMINI"
                }
            }))
            .send()
            .await?;

        if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            return Err(ProviderError::AuthRequired);
        }

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::Other(format!(
                "Anti-Gravity status endpoint returned {status}: {body}"
            )));
        }

        response
            .json::<CodeAssistResponse>()
            .await
            .map_err(|err| ProviderError::Parse(format!("Failed to parse Anti-Gravity status: {err}")))
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
            .map_err(|err| ProviderError::Parse(format!("Failed to parse Google refresh response: {err}")))
    }

    async fn fetch_usage_via_oauth(
        &self,
        credentials: &OAuthCredentials,
    ) -> Result<ProviderFetchResult, ProviderError> {
        let access_token = if credentials.is_expired() {
            let refresh_token = credentials
                .refresh_token
                .as_deref()
                .ok_or(ProviderError::AuthRequired)?;
            self.refresh_access_token(refresh_token).await?.access_token
        } else {
            credentials.access_token.clone()
        };

        let user = self.fetch_google_user_info(&access_token).await?;
        let status = match self.fetch_oauth_status(&access_token).await {
            Ok(status) => status,
            Err(ProviderError::AuthRequired) => {
                let refresh_token = credentials
                    .refresh_token
                    .as_deref()
                    .ok_or(ProviderError::AuthRequired)?;
                let refreshed = self.refresh_access_token(refresh_token).await?;
                self.fetch_oauth_status(&refreshed.access_token).await?
            }
            Err(err) => return Err(err),
        };

        let mut usage = UsageSnapshot::new(RateWindow::new(0.0)).with_login_method("Anti-Gravity OAuth");
        if let Some(email) = user.email.filter(|value| !value.trim().is_empty()) {
            usage = usage.with_email(email);
        }
        if let Some(project) = status
            .billing_project_number
            .filter(|value| !value.trim().is_empty())
        {
            usage = usage.with_organization(project);
        }

        Ok(ProviderFetchResult::new(usage, "oauth"))
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
        if let Some(credentials) = ctx.oauth_credentials.as_ref() {
            tracing::debug!("Fetching Antigravity usage via OAuth");
            return self.fetch_usage_via_oauth(credentials).await;
        }

        tracing::debug!("Fetching Antigravity usage via local probe");

        match self.fetch_user_status().await {
            Ok(usage) => Ok(ProviderFetchResult::new(usage, "local")),
            Err(e) => {
                tracing::warn!("Antigravity probe failed: {}", e);
                Err(e)
            }
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
    csrf_token: String,
    extension_port: u16,
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
struct CodeAssistResponse {
    #[serde(rename = "billingProjectNumber")]
    billing_project_number: Option<String>,
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
    quota_info: Option<QuotaInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuotaInfo {
    remaining_fraction: Option<f64>,
    reset_time: Option<String>,
}
