use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use reqwest::Client;
use rusqlite::Connection;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::env;
use std::error::Error as _;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::timeout;

use crate::core::{append_debug_log, OAuthCredentials};

const CALLBACK_PORT: u16 = 51121;
const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const USER_INFO_ENDPOINT: &str = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";
const API_ENDPOINT: &str = "https://cloudcode-pa.googleapis.com";
const API_VERSION: &str = "v1internal";
const SCOPES: &str = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs";
const CALLBACK_TIMEOUT_SECS: u64 = 300;

#[derive(Debug, Serialize)]
pub struct OAuthStartResponse {
    pub auth_url: String,
    pub state: String,
    pub port: u16,
}

#[derive(Debug, Serialize)]
pub struct OAuthAvailabilityResponse {
    pub configured: bool,
    pub missing: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CallbackResult {
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

#[derive(Debug, Serialize)]
pub struct UserInfoResponse {
    pub email: String,
}

#[derive(Debug, Serialize)]
pub struct AntigravityQuota {
    pub name: String,
    pub used: f64,
    pub total: f64,
    pub unlimited: bool,
    pub resets_at: Option<String>,
    pub unit: String,
}

#[derive(Debug, Serialize)]
pub struct AntigravityStatusResponse {
    pub plan: String,
    pub project_id: Option<String>,
    pub quotas: Vec<AntigravityQuota>,
}

#[derive(Debug, Serialize)]
pub struct RefreshTokenResponse {
    pub access_token: String,
    pub expires_in: i64,
}

#[derive(Debug, Serialize)]
pub struct AntigravityLocalSessionImportResponse {
    pub credentials: OAuthCredentials,
    pub email: Option<String>,
    pub username: Option<String>,
    pub plan: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
}

#[derive(Debug, Deserialize)]
struct GoogleUserInfo {
    email: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodeAssistResponse {
    #[serde(rename = "cloudaicompanionProject")]
    project_id: Option<String>,
    #[serde(rename = "billingProjectNumber")]
    billing_project_number: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleRefreshResponse {
    access_token: String,
    expires_in: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AntigravityStoredOAuthToken {
    access_token: String,
    refresh_token: Option<String>,
    expiry_date_seconds: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct AntigravityAuthStatus {
    name: Option<String>,
    email: Option<String>,
}

fn format_reqwest_error(err: &reqwest::Error) -> String {
    let mut details = vec![err.to_string()];
    let mut source = err.source();
    while let Some(item) = source {
        details.push(item.to_string());
        source = item.source();
    }
    details.join(" | caused by: ")
}

fn build_http_client() -> Result<Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .http1_only()
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

#[cfg(windows)]
fn run_powershell_json<T: DeserializeOwned>(
    script: &str,
    envs: &[(&str, &str)],
) -> Result<T, String> {
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-Command", script]);
    cmd.creation_flags(CREATE_NO_WINDOW);
    for (key, value) in envs {
        cmd.env(key, value);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run PowerShell fallback: {e}"))?;

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("PowerShell exited with status {}", output.status)
        };
        return Err(detail);
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    serde_json::from_str::<T>(&stdout)
        .map_err(|e| format!("Failed to parse PowerShell fallback response: {e}; body={stdout}"))
}

#[cfg(windows)]
fn exchange_token_via_powershell(
    code: &str,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
) -> Result<GoogleTokenResponse, String> {
    let script = r#"
$ProgressPreference = 'SilentlyContinue'
$body = @{
  code = $env:TOKENFLOW_OAUTH_CODE
  client_id = $env:TOKENFLOW_OAUTH_CLIENT_ID
  client_secret = $env:TOKENFLOW_OAUTH_CLIENT_SECRET
  redirect_uri = $env:TOKENFLOW_OAUTH_REDIRECT_URI
  grant_type = 'authorization_code'
}
$resp = Invoke-RestMethod -Uri 'https://oauth2.googleapis.com/token' -Method Post -Body $body -ContentType 'application/x-www-form-urlencoded'
$resp | ConvertTo-Json -Compress
"#;

    run_powershell_json(
        script,
        &[
            ("TOKENFLOW_OAUTH_CODE", code),
            ("TOKENFLOW_OAUTH_CLIENT_ID", client_id),
            ("TOKENFLOW_OAUTH_CLIENT_SECRET", client_secret),
            ("TOKENFLOW_OAUTH_REDIRECT_URI", redirect_uri),
        ],
    )
}

#[cfg(windows)]
fn get_user_info_via_powershell(access_token: &str) -> Result<GoogleUserInfo, String> {
    let script = r#"
$ProgressPreference = 'SilentlyContinue'
$headers = @{ Authorization = "Bearer $env:TOKENFLOW_OAUTH_ACCESS_TOKEN" }
$resp = Invoke-RestMethod -Uri 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json' -Headers $headers -Method Get
$resp | ConvertTo-Json -Compress
"#;

    run_powershell_json(script, &[("TOKENFLOW_OAUTH_ACCESS_TOKEN", access_token)])
}

#[cfg(windows)]
fn refresh_token_via_powershell(
    refresh_token: &str,
    client_id: &str,
    client_secret: &str,
) -> Result<GoogleRefreshResponse, String> {
    let script = r#"
$ProgressPreference = 'SilentlyContinue'
$body = @{
  refresh_token = $env:TOKENFLOW_OAUTH_REFRESH_TOKEN
  client_id = $env:TOKENFLOW_OAUTH_CLIENT_ID
  client_secret = $env:TOKENFLOW_OAUTH_CLIENT_SECRET
  grant_type = 'refresh_token'
}
$resp = Invoke-RestMethod -Uri 'https://oauth2.googleapis.com/token' -Method Post -Body $body -ContentType 'application/x-www-form-urlencoded'
$resp | ConvertTo-Json -Compress
"#;

    run_powershell_json(
        script,
        &[
            ("TOKENFLOW_OAUTH_REFRESH_TOKEN", refresh_token),
            ("TOKENFLOW_OAUTH_CLIENT_ID", client_id),
            ("TOKENFLOW_OAUTH_CLIENT_SECRET", client_secret),
        ],
    )
}

fn generate_state() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_nanos(0))
        .as_nanos();
    format!("{nanos:x}")
}

fn url_encode(s: &str) -> String {
    let mut encoded = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~' {
            encoded.push(char::from(b));
        } else {
            encoded.push_str(&format!("%{b:02X}"));
        }
    }
    encoded
}

fn percent_decode(value: &str) -> String {
    let mut decoded = String::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &value[i + 1..i + 3];
            if let Ok(parsed) = u8::from_str_radix(hex, 16) {
                decoded.push(char::from(parsed));
                i += 3;
                continue;
            }
        }

        if bytes[i] == b'+' {
            decoded.push(' ');
        } else {
            decoded.push(char::from(bytes[i]));
        }
        i += 1;
    }

    decoded
}

fn extract_query_param(request_line: &str, param: &str) -> Option<String> {
    let mut parts = request_line.split_whitespace();
    let _method = parts.next()?;
    let target = parts.next()?;

    let query = target.split_once('?')?.1;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if key == param {
            return Some(percent_decode(value));
        }
    }

    None
}

fn runtime_antigravity_client_id() -> Option<String> {
    env::var("TOKENFLOW_ANTIGRAVITY_CLIENT_ID")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn compiled_antigravity_client_id() -> Option<String> {
    option_env!("TOKENFLOW_ANTIGRAVITY_CLIENT_ID")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn antigravity_client_id() -> Result<String, String> {
    runtime_antigravity_client_id()
        .or_else(compiled_antigravity_client_id)
        .ok_or_else(|| "Missing TOKENFLOW_ANTIGRAVITY_CLIENT_ID".to_string())
}

fn runtime_antigravity_client_secret() -> Option<String> {
    env::var("TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn compiled_antigravity_client_secret() -> Option<String> {
    option_env!("TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn antigravity_client_secret() -> Result<String, String> {
    runtime_antigravity_client_secret()
        .or_else(compiled_antigravity_client_secret)
        .ok_or_else(|| "Missing TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET".to_string())
}

fn antigravity_state_db_path() -> Result<std::path::PathBuf, String> {
    let appdata =
        env::var("APPDATA").map_err(|_| "Could not resolve APPDATA for Anti-Gravity".to_string())?;
    let path = std::path::PathBuf::from(appdata)
        .join("Antigravity")
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");
    if !path.exists() {
        return Err(
            "Anti-Gravity local session not found. Sign in with the Anti-Gravity desktop app first."
                .to_string(),
        );
    }
    Ok(path)
}

fn extract_json_from_embedded_base64(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut start = None;

    for (index, byte) in bytes.iter().enumerate() {
        let is_base64 = byte.is_ascii_alphanumeric() || matches!(*byte, b'+' | b'/' | b'=');
        match (start, is_base64) {
            (None, true) => start = Some(index),
            (Some(chunk_start), false) => {
                if index.saturating_sub(chunk_start) >= 80 {
                    let candidate = &raw[chunk_start..index];
                    if let Ok(decoded) = STANDARD.decode(candidate) {
                        let text = String::from_utf8_lossy(&decoded);
                        if let (Some(json_start), Some(json_end)) = (text.find('{'), text.rfind('}'))
                        {
                            return Some(text[json_start..=json_end].to_string());
                        }
                    }
                }
                start = None;
            }
            _ => {}
        }
    }

    if let Some(chunk_start) = start {
        let candidate = &raw[chunk_start..];
        if candidate.len() >= 80 {
            if let Ok(decoded) = STANDARD.decode(candidate) {
                let text = String::from_utf8_lossy(&decoded);
                if let (Some(json_start), Some(json_end)) = (text.find('{'), text.rfind('}')) {
                    return Some(text[json_start..=json_end].to_string());
                }
            }
        }
    }

    None
}

fn read_antigravity_local_session() -> Result<AntigravityLocalSessionImportResponse, String> {
    let db_path = antigravity_state_db_path()?;
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open Anti-Gravity local storage: {e}"))?;

    let raw_oauth: String = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken'",
            [],
            |row| row.get(0),
        )
        .map_err(|_| {
            "Anti-Gravity OAuth session not found. Sign in with the Anti-Gravity desktop app first."
                .to_string()
        })?;

    let oauth_json = extract_json_from_embedded_base64(&raw_oauth)
        .ok_or_else(|| "Failed to decode Anti-Gravity OAuth session".to_string())?;
    let token: AntigravityStoredOAuthToken = serde_json::from_str(&oauth_json)
        .map_err(|e| format!("Failed to parse Anti-Gravity OAuth session: {e}"))?;

    if token.access_token.trim().is_empty() {
        return Err("Anti-Gravity local session does not contain an access token".to_string());
    }

    let auth_status = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = 'antigravityAuthStatus'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|raw| serde_json::from_str::<AntigravityAuthStatus>(&raw).ok());

    let expires_at = token
        .expiry_date_seconds
        .and_then(|seconds| chrono::DateTime::<chrono::Utc>::from_timestamp(seconds, 0));

    Ok(AntigravityLocalSessionImportResponse {
        credentials: OAuthCredentials {
            access_token: token.access_token,
            refresh_token: token
                .refresh_token
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            expires_at,
            scopes: vec![],
            rate_limit_tier: Some("Antigravity Local Session".to_string()),
        },
        email: auth_status.as_ref().and_then(|status| status.email.clone()),
        username: auth_status.as_ref().and_then(|status| status.name.clone()),
        plan: None,
    })
}

#[tauri::command]
pub fn get_antigravity_oauth_availability(app: AppHandle) -> OAuthAvailabilityResponse {
    let mut missing = Vec::new();
    let has_client_id = runtime_antigravity_client_id().is_some() || compiled_antigravity_client_id().is_some();
    let has_client_secret =
        runtime_antigravity_client_secret().is_some() || compiled_antigravity_client_secret().is_some();

    if !has_client_id {
        missing.push("TOKENFLOW_ANTIGRAVITY_CLIENT_ID".to_string());
    }
    if !has_client_secret {
        missing.push("TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET".to_string());
    }

    let configured = missing.is_empty();
    append_debug_log(
        &app,
        "antigravity.oauth",
        format!(
            "availability configured={configured} missing={missing:?} runtime_client_id={} compiled_client_id={} runtime_client_secret={} compiled_client_secret={}",
            runtime_antigravity_client_id().is_some(),
            compiled_antigravity_client_id().is_some(),
            runtime_antigravity_client_secret().is_some(),
            compiled_antigravity_client_secret().is_some(),
        ),
    );

    OAuthAvailabilityResponse {
        configured,
        missing,
    }
}

#[tauri::command]
pub fn import_antigravity_local_session(
    app: AppHandle,
) -> Result<AntigravityLocalSessionImportResponse, String> {
    let result = read_antigravity_local_session();
    match &result {
        Ok(session) => append_debug_log(
            &app,
            "antigravity.oauth",
            format!(
                "import_local_session success email_present={} refresh_present={} expires_at={}",
                session.email.as_ref().is_some_and(|value| !value.is_empty()),
                session
                    .credentials
                    .refresh_token
                    .as_ref()
                    .is_some_and(|value| !value.is_empty()),
                session
                    .credentials
                    .expires_at
                    .map(|value| value.to_rfc3339())
                    .unwrap_or_else(|| "none".to_string())
            ),
        ),
        Err(err) => append_debug_log(
            &app,
            "antigravity.oauth",
            format!("import_local_session failed error={err}"),
        ),
    }
    result
}

#[tauri::command]
pub async fn start_antigravity_oauth(app: AppHandle) -> Result<OAuthStartResponse, String> {
    let client_id = antigravity_client_id()?;
    let state = generate_state();
    let redirect_uri = format!("http://localhost:{CALLBACK_PORT}/oauth-callback");

    let auth_url = format!(
        "{AUTH_ENDPOINT}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&access_type=offline&prompt=consent",
        url_encode(&client_id),
        url_encode(&redirect_uri),
        url_encode(SCOPES),
        url_encode(&state)
    );

    Ok(OAuthStartResponse {
        auth_url,
        state,
        port: CALLBACK_PORT,
    })
    .inspect(|response| {
        append_debug_log(
            &app,
            "antigravity.oauth",
            format!(
                "start state_len={} callback_port={} redirect_uri={}",
                response.state.len(),
                response.port,
                redirect_uri
            ),
        );
    })
}

#[tauri::command]
pub async fn antigravity_wait_for_callback(
    app: AppHandle,
    state: String,
    port: u16,
) -> Result<CallbackResult, String> {
    append_debug_log(
        &app,
        "antigravity.oauth",
        format!("waiting for callback state_len={} port={port}", state.len()),
    );
    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("Failed to bind callback listener: {e}"))?;

    let wait_result = timeout(Duration::from_secs(CALLBACK_TIMEOUT_SECS), async {
        loop {
            let (mut socket, _) = listener
                .accept()
                .await
                .map_err(|e| format!("Failed to accept callback connection: {e}"))?;

            let mut buf = vec![0_u8; 8192];
            let bytes_read = socket
                .read(&mut buf)
                .await
                .map_err(|e| format!("Failed to read callback request: {e}"))?;

            if bytes_read == 0 {
                continue;
            }

            let request = String::from_utf8_lossy(&buf[..bytes_read]).into_owned();
            let request_line = request.lines().next().unwrap_or_default();
            let mut request_parts = request_line.split_whitespace();
            let _method = request_parts.next().unwrap_or_default();
            let path_with_query = request_parts.next().unwrap_or_default();

            if !path_with_query.starts_with("/oauth-callback") {
                let not_found_response = "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nNot Found";
                let _ = socket.write_all(not_found_response.as_bytes()).await;
                let _ = socket.shutdown().await;
                continue;
            }

            let incoming_state = extract_query_param(request_line, "state").unwrap_or_default();
            if incoming_state != state {
                append_debug_log(
                    &app,
                    "antigravity.oauth",
                    format!(
                        "callback state mismatch incoming_len={} expected_len={}",
                        incoming_state.len(),
                        state.len()
                    ),
                );
                let bad_request_response = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nInvalid OAuth state.";
                let _ = socket.write_all(bad_request_response.as_bytes()).await;
                let _ = socket.shutdown().await;
                return Err("OAuth state validation failed".to_string());
            }

            let code = extract_query_param(request_line, "code").unwrap_or_default();
            if code.is_empty() {
                append_debug_log(
                    &app,
                    "antigravity.oauth",
                    "callback arrived without authorization code",
                );
                let bad_request_response = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nMissing authorization code.";
                let _ = socket.write_all(bad_request_response.as_bytes()).await;
                let _ = socket.shutdown().await;
                return Err("Missing authorization code in callback".to_string());
            }
            append_debug_log(
                &app,
                "antigravity.oauth",
                format!("callback received code_len={}", code.len()),
            );

            let success_body = "<html><body><h2>Anti-Gravity authentication complete.</h2><p>You can close this window and return to TokenFlow.</p></body></html>";
            let success_response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                success_body.len(),
                success_body
            );
            let _ = socket.write_all(success_response.as_bytes()).await;
            let _ = socket.shutdown().await;

            return Ok(CallbackResult { code });
        }
    })
    .await;

    match wait_result {
        Ok(result) => result,
        Err(_) => Err("Timed out waiting for OAuth callback".to_string()),
    }
}

#[tauri::command]
pub async fn antigravity_exchange_token(
    app: AppHandle,
    code: String,
    port: u16,
) -> Result<TokenResponse, String> {
    let client = build_http_client()?;
    let client_id = antigravity_client_id()?;
    let client_secret = antigravity_client_secret()?;
    let redirect_uri = format!("http://localhost:{port}/oauth-callback");
    append_debug_log(
        &app,
        "antigravity.oauth",
        format!(
            "exchange start code_len={} redirect_uri={redirect_uri} client_id_len={}",
            code.len(),
            client_id.len()
        ),
    );

    let token_res = match client
        .post(TOKEN_ENDPOINT)
        .form(&[
            ("code", code.as_str()),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
    {
        Ok(response) => response,
        Err(err) => {
            #[cfg(windows)]
            {
                let fallback =
                    exchange_token_via_powershell(&code, &client_id, &client_secret, &redirect_uri);
                match fallback {
                    Ok(token_data) => {
                        append_debug_log(
                            &app,
                            "antigravity.oauth",
                            format!(
                                "exchange used PowerShell fallback access_len={} refresh_present={}",
                                token_data.access_token.len(),
                                token_data.refresh_token.as_ref().is_some_and(|value| !value.is_empty())
                            ),
                        );
                        return Ok(TokenResponse {
                            access_token: token_data.access_token,
                            refresh_token: token_data.refresh_token.unwrap_or_default(),
                            expires_in: token_data.expires_in,
                        });
                    }
                    Err(fallback_err) => {
                        return Err(format!(
                            "Failed to exchange OAuth code for token: {} ; PowerShell fallback failed: {}",
                            format_reqwest_error(&err),
                            fallback_err
                        ));
                    }
                }
            }
            #[cfg(not(windows))]
            {
                return Err(format!(
                    "Failed to exchange OAuth code for token: {}",
                    format_reqwest_error(&err)
                ));
            }
        }
    };

    if !token_res.status().is_success() {
        let status = token_res.status().as_u16();
        let body = token_res.text().await.unwrap_or_default();
        append_debug_log(
            &app,
            "antigravity.oauth",
            format!("exchange http_status={status} body={body}"),
        );
        return Err(format!("Google token endpoint returned {status}: {body}"));
    }
    append_debug_log(
        &app,
        "antigravity.oauth",
        format!("exchange http_status={}", token_res.status()),
    );

    let token_data = token_res
        .json::<GoogleTokenResponse>()
        .await
        .map_err(|e| format!("Failed to parse Google token response: {e}"))?;

    Ok(TokenResponse {
        access_token: token_data.access_token,
        refresh_token: token_data.refresh_token.unwrap_or_default(),
        expires_in: token_data.expires_in,
    })
    .inspect(|tokens| {
        append_debug_log(
            &app,
            "antigravity.oauth",
            format!(
                "exchange success access_len={} refresh_present={} expires_in={}",
                tokens.access_token.len(),
                !tokens.refresh_token.is_empty(),
                tokens.expires_in
            ),
        );
    })
}

#[tauri::command]
pub async fn get_antigravity_user_info(
    app: AppHandle,
    access_token: String,
) -> Result<UserInfoResponse, String> {
    let client = build_http_client()?;
    append_debug_log(
        &app,
        "antigravity.oauth",
        format!("user_info start access_len={}", access_token.len()),
    );

    let user_res = match client
        .get(USER_INFO_ENDPOINT)
        .bearer_auth(&access_token)
        .send()
        .await
    {
        Ok(response) => response,
        Err(err) => {
            #[cfg(windows)]
            {
                let user_info =
                    get_user_info_via_powershell(&access_token).map_err(|fallback| {
                        format!(
                            "Failed to fetch Google user info: {} ; PowerShell fallback failed: {}",
                            format_reqwest_error(&err),
                            fallback
                        )
                    })?;

                let email = user_info.email.ok_or_else(|| {
                    "Google user info response did not include an email".to_string()
                })?;
                append_debug_log(
                    &app,
                    "antigravity.oauth",
                    format!("user_info used PowerShell fallback email={email}"),
                );

                return Ok(UserInfoResponse { email });
            }
            #[cfg(not(windows))]
            {
                return Err(format!(
                    "Failed to fetch Google user info: {}",
                    format_reqwest_error(&err)
                ));
            }
        }
    };

    if !user_res.status().is_success() {
        let status = user_res.status().as_u16();
        let body = user_res.text().await.unwrap_or_default();
        append_debug_log(
            &app,
            "antigravity.oauth",
            format!("user_info http_status={status} body={body}"),
        );
        return Err(format!(
            "Google user info endpoint returned {status}: {body}"
        ));
    }

    let user_info = user_res
        .json::<GoogleUserInfo>()
        .await
        .map_err(|e| format!("Failed to parse Google user info response: {e}"))?;

    let email = user_info
        .email
        .ok_or_else(|| "Google user info response did not include an email".to_string())?;
    append_debug_log(
        &app,
        "antigravity.oauth",
        format!("user_info success email={email}"),
    );

    Ok(UserInfoResponse { email })
}

#[tauri::command]
pub async fn get_antigravity_status(
    app: AppHandle,
    access_token: String,
) -> Result<AntigravityStatusResponse, String> {
    let client = build_http_client()?;
    let endpoint = format!("{API_ENDPOINT}/{API_VERSION}:loadCodeAssist");
    append_debug_log(
        &app,
        "antigravity.oauth",
        format!(
            "status start access_len={} endpoint={endpoint}",
            access_token.len()
        ),
    );

    let status_res = client
        .post(endpoint)
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
        .await
        .map_err(|e| format!("Failed to fetch Anti-Gravity status: {e}"))?;

    if !status_res.status().is_success() {
        let status = status_res.status().as_u16();
        let body = status_res.text().await.unwrap_or_default();
        append_debug_log(
            &app,
            "antigravity.oauth",
            format!("status http_status={status} body={body}"),
        );
        return Err(format!(
            "Anti-Gravity status endpoint returned {status}: {body}"
        ));
    }

    let status_data = status_res
        .json::<CodeAssistResponse>()
        .await
        .map_err(|e| format!("Failed to parse Anti-Gravity status response: {e}"))?;

    Ok(AntigravityStatusResponse {
        plan: "Anti-Gravity".to_string(),
        project_id: status_data
            .project_id
            .or(status_data.billing_project_number),
        quotas: Vec::new(),
    })
    .inspect(|status| {
        append_debug_log(
            &app,
            "antigravity.oauth",
            format!(
                "status success project_present={}",
                status
                    .project_id
                    .as_ref()
                    .is_some_and(|value| !value.trim().is_empty())
            ),
        );
    })
}

#[tauri::command]
pub async fn antigravity_refresh_token(
    app: AppHandle,
    refresh_token: String,
) -> Result<RefreshTokenResponse, String> {
    let client = build_http_client()?;
    let client_id = antigravity_client_id()?;
    let client_secret = antigravity_client_secret()?;
    append_debug_log(
        &app,
        "antigravity.oauth",
        format!(
            "refresh start refresh_len={} client_id_len={}",
            refresh_token.len(),
            client_id.len()
        ),
    );

    let refresh_res = match client
        .post(TOKEN_ENDPOINT)
        .form(&[
            ("refresh_token", refresh_token.as_str()),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
    {
        Ok(response) => response,
        Err(err) => {
            #[cfg(windows)]
            {
                let refresh_data =
                    refresh_token_via_powershell(&refresh_token, &client_id, &client_secret)
                        .map_err(|fallback| {
                            format!(
                        "Failed to refresh OAuth token: {} ; PowerShell fallback failed: {}",
                        format_reqwest_error(&err),
                        fallback
                    )
                        })?;

                return Ok(RefreshTokenResponse {
                    access_token: refresh_data.access_token,
                    expires_in: refresh_data.expires_in,
                });
            }
            #[cfg(not(windows))]
            {
                return Err(format!(
                    "Failed to refresh OAuth token: {}",
                    format_reqwest_error(&err)
                ));
            }
        }
    };

    if !refresh_res.status().is_success() {
        let status = refresh_res.status().as_u16();
        let body = refresh_res.text().await.unwrap_or_default();
        append_debug_log(
            &app,
            "antigravity.oauth",
            format!("refresh http_status={status} body={body}"),
        );
        return Err(format!("Google refresh endpoint returned {status}: {body}"));
    }

    let refresh_data = refresh_res
        .json::<GoogleRefreshResponse>()
        .await
        .map_err(|e| format!("Failed to parse refresh token response: {e}"))?;

    Ok(RefreshTokenResponse {
        access_token: refresh_data.access_token,
        expires_in: refresh_data.expires_in,
    })
    .inspect(|tokens| {
        append_debug_log(
            &app,
            "antigravity.oauth",
            format!(
                "refresh success access_len={} expires_in={}",
                tokens.access_token.len(),
                tokens.expires_in
            ),
        );
    })
}
