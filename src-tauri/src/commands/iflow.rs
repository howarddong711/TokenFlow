use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::timeout;

const CALLBACK_PORT: u16 = 11451;
const AUTH_ENDPOINT: &str = "https://iflow.cn/oauth";
const TOKEN_ENDPOINT: &str = "https://iflow.cn/oauth/token";
const USER_INFO_ENDPOINT: &str = "https://iflow.cn/api/oauth/getUserInfo";
const SUCCESS_REDIRECT_URL: &str = "https://iflow.cn/oauth/success";
const CALLBACK_TIMEOUT_SECS: u64 = 300;

#[derive(Debug, Serialize)]
pub struct IflowOAuthStartResponse {
    pub auth_url: String,
    pub state: String,
    pub port: u16,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IflowCallbackResult {
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct IflowTokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

#[derive(Debug, Serialize)]
pub struct IflowUserInfoResponse {
    pub email: String,
    pub api_key: String,
}

#[derive(Debug, Serialize)]
pub struct IflowQuota {
    pub name: String,
    pub used: f64,
    pub total: f64,
    pub unlimited: bool,
    pub resets_at: Option<String>,
    pub unit: String,
}

#[derive(Debug, Serialize)]
pub struct IflowStatusResponse {
    pub plan: String,
    pub username: Option<String>,
    pub api_key: String,
    pub quotas: Vec<IflowQuota>,
}

#[derive(Debug, Serialize)]
pub struct IflowRefreshTokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

#[derive(Debug, Deserialize)]
struct IflowRawTokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct IflowUserInfoApiResponse {
    success: bool,
    data: Option<IflowUserInfoData>,
}

#[derive(Debug, Deserialize)]
struct IflowUserInfoData {
    #[serde(rename = "apiKey")]
    api_key: Option<String>,
    email: Option<String>,
    phone: Option<String>,
}

fn generate_state() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_nanos();
    format!("{nanos:x}")
}

fn extract_query_param(request_line: &str, param: &str) -> Option<String> {
    let path_and_query = request_line.split_whitespace().nth(1)?;
    let query = path_and_query.split_once('?')?.1;

    query.split('&').find_map(|pair| {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next()?;
        let value = parts.next().unwrap_or_default();

        if key == param {
            Some(decode_url_component(value))
        } else {
            None
        }
    })
}

fn decode_url_component(input: &str) -> String {
    let mut decoded = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0usize;

    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                decoded.push(' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hi = bytes[i + 1] as char;
                let lo = bytes[i + 2] as char;
                let value = match (hi.to_digit(16), lo.to_digit(16)) {
                    (Some(h), Some(l)) => Some(((h << 4) + l) as u8),
                    _ => None,
                };

                if let Some(v) = value {
                    decoded.push(v as char);
                    i += 3;
                } else {
                    decoded.push('%');
                    i += 1;
                }
            }
            b => {
                decoded.push(b as char);
                i += 1;
            }
        }
    }

    decoded
}

fn iflow_client_id() -> Result<String, String> {
    env::var("TOKENFLOW_IFLOW_CLIENT_ID")
        .map_err(|_| "Missing TOKENFLOW_IFLOW_CLIENT_ID".to_string())
}

fn iflow_client_secret() -> Result<String, String> {
    env::var("TOKENFLOW_IFLOW_CLIENT_SECRET")
        .map_err(|_| "Missing TOKENFLOW_IFLOW_CLIENT_SECRET".to_string())
}

fn make_basic_auth_header(client_id: &str, client_secret: &str) -> String {
    let source = format!("{client_id}:{client_secret}");
    let bytes = source.as_bytes();
    let table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut encoded = String::with_capacity(((bytes.len() + 2) / 3) * 4);
    let mut i = 0usize;

    while i < bytes.len() {
        let b0 = bytes[i];
        let b1 = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        let b2 = if i + 2 < bytes.len() { bytes[i + 2] } else { 0 };

        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);

        let c0 = table[((n >> 18) & 0x3f) as usize] as char;
        let c1 = table[((n >> 12) & 0x3f) as usize] as char;
        let c2 = table[((n >> 6) & 0x3f) as usize] as char;
        let c3 = table[(n & 0x3f) as usize] as char;

        encoded.push(c0);
        encoded.push(c1);

        if i + 1 < bytes.len() {
            encoded.push(c2);
        } else {
            encoded.push('=');
        }

        if i + 2 < bytes.len() {
            encoded.push(c3);
        } else {
            encoded.push('=');
        }

        i += 3;
    }

    encoded
}

#[tauri::command]
pub async fn start_iflow_oauth() -> Result<IflowOAuthStartResponse, String> {
    let client_id = iflow_client_id()?;
    let state = generate_state();
    let auth_url = format!(
        "{AUTH_ENDPOINT}?loginMethod=phone&type=phone&redirect=http://localhost:{CALLBACK_PORT}/oauth2callback&state={state}&client_id={client_id}"
    );

    Ok(IflowOAuthStartResponse {
        auth_url,
        state,
        port: CALLBACK_PORT,
    })
}

#[tauri::command]
pub async fn iflow_wait_for_callback(
    state: String,
    port: u16,
) -> Result<IflowCallbackResult, String> {
    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("Failed to bind callback listener on port {port}: {e}"))?;

    let callback_result = timeout(Duration::from_secs(CALLBACK_TIMEOUT_SECS), async {
        loop {
            let (mut socket, _) = listener
                .accept()
                .await
                .map_err(|e| format!("Failed to accept callback connection: {e}"))?;

            let mut buffer = vec![0u8; 4096];
            let read_size = socket
                .read(&mut buffer)
                .await
                .map_err(|e| format!("Failed to read callback request: {e}"))?;

            if read_size == 0 {
                continue;
            }

            let request = String::from_utf8_lossy(&buffer[..read_size]);
            let request_line = request.lines().next().unwrap_or_default();
            let path_and_query = request_line.split_whitespace().nth(1).unwrap_or("/");
            let path = path_and_query.split('?').next().unwrap_or(path_and_query);

            if path != "/oauth2callback" {
                let not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                socket
                    .write_all(not_found.as_bytes())
                    .await
                    .map_err(|e| format!("Failed to write 404 response: {e}"))?;
                continue;
            }

            let callback_state = extract_query_param(request_line, "state");
            let callback_code = extract_query_param(request_line, "code");

            let (callback_state, callback_code) = match (callback_state, callback_code) {
                (Some(s), Some(c)) => (s, c),
                _ => {
                    let bad_request = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                    socket
                        .write_all(bad_request.as_bytes())
                        .await
                        .map_err(|e| format!("Failed to write 400 response: {e}"))?;
                    continue;
                }
            };

            if callback_state != state {
                let bad_request = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                socket
                    .write_all(bad_request.as_bytes())
                    .await
                    .map_err(|e| format!("Failed to write state mismatch response: {e}"))?;
                continue;
            }

            let redirect = format!(
                "HTTP/1.1 302 Found\r\nLocation: {SUCCESS_REDIRECT_URL}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            socket
                .write_all(redirect.as_bytes())
                .await
                .map_err(|e| format!("Failed to write redirect response: {e}"))?;

            return Ok(IflowCallbackResult {
                code: callback_code,
            });
        }
    })
    .await
    .map_err(|_| "Timed out waiting for iFlow OAuth callback".to_string())?;

    callback_result
}

#[tauri::command]
pub async fn iflow_exchange_token(code: String, port: u16) -> Result<IflowTokenResponse, String> {
    let client = Client::new();
    let client_id = iflow_client_id()?;
    let client_secret = iflow_client_secret()?;
    let redirect_uri = format!("http://localhost:{port}/oauth2callback");

    let params = vec![
        ("grant_type".to_string(), "authorization_code".to_string()),
        ("code".to_string(), code),
        ("redirect_uri".to_string(), redirect_uri),
        ("client_id".to_string(), client_id.clone()),
        ("client_secret".to_string(), client_secret.clone()),
    ];

    let response = client
        .post(TOKEN_ENDPOINT)
        .header(
            "Authorization",
            format!(
                "Basic {}",
                make_basic_auth_header(&client_id, &client_secret)
            ),
        )
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Failed to exchange iFlow token: {e}"))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("iFlow token endpoint returned {status}: {body}"));
    }

    let raw = response
        .json::<IflowRawTokenResponse>()
        .await
        .map_err(|e| format!("Failed to parse iFlow token response: {e}"))?;

    Ok(IflowTokenResponse {
        access_token: raw.access_token.unwrap_or_default(),
        refresh_token: raw.refresh_token.unwrap_or_default(),
        expires_in: raw.expires_in.unwrap_or(0),
    })
}

#[tauri::command]
pub async fn get_iflow_user_info(access_token: String) -> Result<IflowUserInfoResponse, String> {
    let client = Client::new();

    let response = client
        .get(USER_INFO_ENDPOINT)
        .query(&[("accessToken", access_token)])
        .send()
        .await
        .map_err(|e| format!("Failed to fetch iFlow user info: {e}"))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "iFlow user info endpoint returned {status}: {body}"
        ));
    }

    let payload = response
        .json::<IflowUserInfoApiResponse>()
        .await
        .map_err(|e| format!("Failed to parse iFlow user info response: {e}"))?;

    if !payload.success {
        return Err("iFlow user info API reported an unsuccessful response".to_string());
    }

    let data = payload
        .data
        .ok_or_else(|| "iFlow user info response did not include data".to_string())?;

    let _phone = data.phone;

    Ok(IflowUserInfoResponse {
        email: data.email.unwrap_or_default(),
        api_key: data.api_key.unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn get_iflow_status(access_token: String) -> Result<IflowStatusResponse, String> {
    let client = Client::new();

    let response = client
        .get(USER_INFO_ENDPOINT)
        .query(&[("accessToken", access_token)])
        .send()
        .await
        .map_err(|e| format!("Failed to fetch iFlow status: {e}"))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("iFlow status endpoint returned {status}: {body}"));
    }

    let payload = response
        .json::<IflowUserInfoApiResponse>()
        .await
        .map_err(|e| format!("Failed to parse iFlow status response: {e}"))?;

    if !payload.success {
        return Err("iFlow status API reported an unsuccessful response".to_string());
    }

    let data = payload
        .data
        .ok_or_else(|| "iFlow status response did not include data".to_string())?;

    let _phone = data.phone;

    Ok(IflowStatusResponse {
        plan: "iFlow".to_string(),
        username: data.email,
        api_key: data.api_key.unwrap_or_default(),
        quotas: Vec::new(),
    })
}

#[tauri::command]
pub async fn iflow_refresh_token(
    refresh_token: String,
) -> Result<IflowRefreshTokenResponse, String> {
    let client = Client::new();
    let client_id = iflow_client_id()?;
    let client_secret = iflow_client_secret()?;

    let params = vec![
        ("grant_type".to_string(), "refresh_token".to_string()),
        ("refresh_token".to_string(), refresh_token),
        ("client_id".to_string(), client_id.clone()),
        ("client_secret".to_string(), client_secret.clone()),
    ];

    let response = client
        .post(TOKEN_ENDPOINT)
        .header(
            "Authorization",
            format!(
                "Basic {}",
                make_basic_auth_header(&client_id, &client_secret)
            ),
        )
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Failed to refresh iFlow token: {e}"))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("iFlow refresh endpoint returned {status}: {body}"));
    }

    let raw = response
        .json::<IflowRawTokenResponse>()
        .await
        .map_err(|e| format!("Failed to parse iFlow refresh response: {e}"))?;

    Ok(IflowRefreshTokenResponse {
        access_token: raw.access_token.unwrap_or_default(),
        refresh_token: raw.refresh_token.unwrap_or_default(),
        expires_in: raw.expires_in.unwrap_or(0),
    })
}
