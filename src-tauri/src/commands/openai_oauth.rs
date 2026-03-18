use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::{rngs::OsRng, RngCore};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::error::Error as _;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::timeout;

use crate::core::append_debug_log;

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_ENDPOINT: &str = "https://auth.openai.com/oauth/authorize";
const TOKEN_ENDPOINT: &str = "https://auth.openai.com/oauth/token";
const CALLBACK_PORT: u16 = 1455;
const CALLBACK_TIMEOUT_SECS: u64 = 300;
static OPENAI_OAUTH_CANCELLED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Serialize)]
pub struct OpenAIOAuthStartResponse {
    pub auth_url: String,
    pub state: String,
    pub code_verifier: String,
    pub port: u16,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenAICallbackResult {
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct OpenAIChatGPTTokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: i64,
    pub email: Option<String>,
    pub plan: String,
    pub account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAITokenApiResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
    id_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAIErrorResponse {
    error: Option<OpenAIErrorBody>,
}

#[derive(Debug, Deserialize)]
struct OpenAIErrorBody {
    message: Option<String>,
    #[serde(rename = "type")]
    error_type: Option<String>,
    code: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IdTokenClaims {
    email: Option<String>,
    #[serde(rename = "https://api.openai.com/auth")]
    openai_auth: Option<OpenAIAuthClaims>,
}

#[derive(Debug, Deserialize)]
struct OpenAIAuthClaims {
    chatgpt_plan_type: Option<String>,
    chatgpt_account_id: Option<String>,
}

fn generate_nonce() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn generate_code_verifier() -> String {
    let mut bytes = [0_u8; 96];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
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

fn build_code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn parse_id_token(id_token: &str) -> Result<(Option<String>, String, Option<String>), String> {
    let mut parts = id_token.split('.');
    let _header = parts.next();
    let payload = parts
        .next()
        .ok_or_else(|| "Invalid OpenAI id_token payload".to_string())?;

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|e| format!("Failed to decode OpenAI id_token: {e}"))?;

    let claims = serde_json::from_slice::<IdTokenClaims>(&payload_bytes)
        .map_err(|e| format!("Failed to parse OpenAI id_token: {e}"))?;

    let auth_claims = claims
        .openai_auth
        .ok_or_else(|| "Missing OpenAI auth claims in id_token".to_string())?;

    let plan = auth_claims
        .chatgpt_plan_type
        .unwrap_or_else(|| "free".to_string());

    Ok((claims.email, plan, auth_claims.chatgpt_account_id))
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

#[tauri::command]
pub async fn start_openai_chatgpt_oauth() -> Result<OpenAIOAuthStartResponse, String> {
    OPENAI_OAUTH_CANCELLED.store(false, Ordering::SeqCst);

    let state = generate_nonce();
    let code_verifier = generate_code_verifier();
    let code_challenge = build_code_challenge(&code_verifier);
    let redirect_uri = format!("http://localhost:{CALLBACK_PORT}/auth/callback");

    let auth_url = format!(
        "{AUTH_ENDPOINT}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256&prompt=login&id_token_add_organizations=true&codex_cli_simplified_flow=true",
        url_encode(CLIENT_ID),
        url_encode(&redirect_uri),
        url_encode("openid email profile offline_access"),
        url_encode(&state),
        url_encode(&code_challenge)
    );

    Ok(OpenAIOAuthStartResponse {
        auth_url,
        state,
        code_verifier,
        port: CALLBACK_PORT,
    })
}

#[tauri::command]
pub async fn openai_wait_for_callback(
    state: String,
    port: u16,
) -> Result<OpenAICallbackResult, String> {
    OPENAI_OAUTH_CANCELLED.store(false, Ordering::SeqCst);

    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("Failed to bind callback listener: {e}"))?;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(CALLBACK_TIMEOUT_SECS);

    loop {
        if OPENAI_OAUTH_CANCELLED.load(Ordering::SeqCst) {
            return Err("OpenAI OAuth cancelled".to_string());
        }

        let now = tokio::time::Instant::now();
        if now >= deadline {
            return Err("Timed out waiting for OpenAI OAuth callback".to_string());
        }

        let remaining = deadline.saturating_duration_since(now);
        let poll_window = remaining.min(Duration::from_secs(1));

        let accept_result = timeout(poll_window, listener.accept()).await;
        let (mut socket, _) = match accept_result {
            Ok(Ok(connection)) => connection,
            Ok(Err(e)) => return Err(format!("Failed to accept callback connection: {e}")),
            Err(_) => continue,
        };

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
        let path_with_query = request_line.split_whitespace().nth(1).unwrap_or_default();

        if !path_with_query.starts_with("/auth/callback") {
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

        let success_body = "<html><body><h2>OpenAI authentication complete.</h2><p>You can close this window and return to TokenFlow.</p></body></html>";
        let success_response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                success_body.len(),
                success_body
            );
        let _ = socket.write_all(success_response.as_bytes()).await;
        let _ = socket.shutdown().await;

        return Ok(OpenAICallbackResult { code });
    }
}

#[tauri::command]
pub async fn cancel_openai_chatgpt_oauth_wait() {
    OPENAI_OAUTH_CANCELLED.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn openai_exchange_chatgpt_token(
    app: AppHandle,
    code: String,
    code_verifier: String,
    port: u16,
) -> Result<OpenAIChatGPTTokenResponse, String> {
    append_debug_log(
        &app,
        "openai_oauth.exchange",
        format!(
            "Starting token exchange code_len={} verifier_len={} port={}",
            code.len(),
            code_verifier.len(),
            port
        ),
    );
    let client = Client::new();
    let redirect_uri = format!("http://localhost:{port}/auth/callback");

    let request_body = format!(
        "grant_type=authorization_code&code={}&redirect_uri={}&client_id={}&code_verifier={}",
        url_encode(code.as_str()),
        url_encode(redirect_uri.as_str()),
        url_encode(CLIENT_ID),
        url_encode(code_verifier.as_str())
    );

    let token_res = client
        .post(TOKEN_ENDPOINT)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .body(request_body)
        .send()
        .await
        .map_err(|e| {
            let message = format_reqwest_error(&e);
            append_debug_log(
                &app,
                "openai_oauth.exchange",
                format!("Token exchange transport failure: {message}"),
            );
            format!("Failed to exchange OpenAI OAuth token: {message}")
        })?;

    append_debug_log(
        &app,
        "openai_oauth.exchange",
        format!("Token exchange HTTP status={}", token_res.status()),
    );

    if !token_res.status().is_success() {
        let status = token_res.status().as_u16();
        let body = token_res.text().await.unwrap_or_default();
        let mut diagnostics = String::new();
        if let Ok(parsed) = serde_json::from_str::<OpenAIErrorResponse>(&body) {
            if let Some(err) = parsed.error {
                let code = err.code.unwrap_or_else(|| "unknown_code".to_string());
                let err_type = err.error_type.unwrap_or_else(|| "unknown_type".to_string());
                let message = err
                    .message
                    .unwrap_or_else(|| "Unknown OpenAI OAuth error".to_string());

                diagnostics = format!(" [code={code}, type={err_type}, message={message}]");

                if code == "token_exchange_user_error" {
                    diagnostics.push_str(
                        " Hint: OpenAI rejected this auth code exchange. Retry with a fresh login in the same browser profile, and ensure system time is correct.",
                    );
                }
            }
        }

        return Err(format!(
            "OpenAI OAuth token endpoint returned {status}: {body}{diagnostics}"
        ));
    }

    let tokens = token_res
        .json::<OpenAITokenApiResponse>()
        .await
        .map_err(|e| format!("Failed to parse OpenAI OAuth token response: {e}"))?;

    let (email, plan, account_id) = tokens
        .id_token
        .as_deref()
        .map(parse_id_token)
        .transpose()?
        .unwrap_or((None, "free".to_string(), None));

    Ok(OpenAIChatGPTTokenResponse {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        email,
        plan,
        account_id,
    })
}
