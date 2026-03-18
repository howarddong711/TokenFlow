use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::timeout;

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
    #[serde(rename = "billingProjectNumber")]
    billing_project_number: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleRefreshResponse {
    access_token: String,
    expires_in: i64,
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

fn antigravity_client_id() -> Result<String, String> {
    env::var("TOKENFLOW_ANTIGRAVITY_CLIENT_ID")
        .map_err(|_| "Missing TOKENFLOW_ANTIGRAVITY_CLIENT_ID".to_string())
}

fn antigravity_client_secret() -> Result<String, String> {
    env::var("TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET")
        .map_err(|_| "Missing TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET".to_string())
}

#[tauri::command]
pub async fn start_antigravity_oauth() -> Result<OAuthStartResponse, String> {
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
}

#[tauri::command]
pub async fn antigravity_wait_for_callback(
    state: String,
    port: u16,
) -> Result<CallbackResult, String> {
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
                let bad_request_response = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nInvalid OAuth state.";
                let _ = socket.write_all(bad_request_response.as_bytes()).await;
                let _ = socket.shutdown().await;
                return Err("OAuth state validation failed".to_string());
            }

            let code = extract_query_param(request_line, "code").unwrap_or_default();
            if code.is_empty() {
                let bad_request_response = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nMissing authorization code.";
                let _ = socket.write_all(bad_request_response.as_bytes()).await;
                let _ = socket.shutdown().await;
                return Err("Missing authorization code in callback".to_string());
            }

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
pub async fn antigravity_exchange_token(code: String, port: u16) -> Result<TokenResponse, String> {
    let client = Client::new();
    let client_id = antigravity_client_id()?;
    let client_secret = antigravity_client_secret()?;
    let redirect_uri = format!("http://localhost:{port}/oauth-callback");

    let token_res = client
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
        .map_err(|e| format!("Failed to exchange OAuth code for token: {e}"))?;

    if !token_res.status().is_success() {
        let status = token_res.status().as_u16();
        let body = token_res.text().await.unwrap_or_default();
        return Err(format!("Google token endpoint returned {status}: {body}"));
    }

    let token_data = token_res
        .json::<GoogleTokenResponse>()
        .await
        .map_err(|e| format!("Failed to parse Google token response: {e}"))?;

    Ok(TokenResponse {
        access_token: token_data.access_token,
        refresh_token: token_data.refresh_token.unwrap_or_default(),
        expires_in: token_data.expires_in,
    })
}

#[tauri::command]
pub async fn get_antigravity_user_info(access_token: String) -> Result<UserInfoResponse, String> {
    let client = Client::new();

    let user_res = client
        .get(USER_INFO_ENDPOINT)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Google user info: {e}"))?;

    if !user_res.status().is_success() {
        let status = user_res.status().as_u16();
        let body = user_res.text().await.unwrap_or_default();
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

    Ok(UserInfoResponse { email })
}

#[tauri::command]
pub async fn get_antigravity_status(
    access_token: String,
) -> Result<AntigravityStatusResponse, String> {
    let client = Client::new();
    let endpoint = format!("{API_ENDPOINT}/{API_VERSION}:loadCodeAssist");

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
        project_id: status_data.billing_project_number,
        quotas: Vec::new(),
    })
}

#[tauri::command]
pub async fn antigravity_refresh_token(
    refresh_token: String,
) -> Result<RefreshTokenResponse, String> {
    let client = Client::new();
    let client_id = antigravity_client_id()?;
    let client_secret = antigravity_client_secret()?;

    let refresh_res = client
        .post(TOKEN_ENDPOINT)
        .form(&[
            ("refresh_token", refresh_token.as_str()),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to refresh OAuth token: {e}"))?;

    if !refresh_res.status().is_success() {
        let status = refresh_res.status().as_u16();
        let body = refresh_res.text().await.unwrap_or_default();
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
}
