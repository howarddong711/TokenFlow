use base64::Engine;
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::core::OAuthCredentials;

const GEMINI_MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

#[derive(Debug, Serialize)]
pub struct GeminiStatusMetric {
    pub name: String,
    pub used: f64,
    pub total: f64,
    pub unlimited: bool,
    pub resets_at: Option<String>,
    pub unit: String,
}

#[derive(Debug, Serialize)]
pub struct GeminiStatusResponse {
    pub plan: String,
    pub username: Option<String>,
    pub quotas: Vec<GeminiStatusMetric>,
}

#[derive(Debug, Serialize)]
pub struct GeminiCliOAuthImportResponse {
    pub credentials: OAuthCredentials,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct GeminiCliOAuthCredentialsFile {
    access_token: Option<String>,
    id_token: Option<String>,
    refresh_token: Option<String>,
    expiry_date: Option<f64>,
}

#[tauri::command]
pub async fn get_gemini_status(api_key: String) -> Result<GeminiStatusResponse, String> {
    let client = Client::new();

    let validate_res = client
        .get(GEMINI_MODELS_URL)
        .query(&[("key", api_key.clone())])
        .send()
        .await
        .map_err(|e| format!("Failed to validate Gemini API key: {e}"))?;

    if !validate_res.status().is_success() {
        let status = validate_res.status().as_u16();
        let body = validate_res.text().await.unwrap_or_default();
        return Err(format!("Gemini API returned {status}: {body}"));
    }

    Ok(GeminiStatusResponse {
        plan: "AI Studio Key".to_string(),
        username: Some("static tier limits".to_string()),
        quotas: vec![
            GeminiStatusMetric {
                name: "Typical Free Tier RPM Limit".to_string(),
                used: 15.0,
                total: 0.0,
                unlimited: false,
                resets_at: None,
                unit: "rpm".to_string(),
            },
            GeminiStatusMetric {
                name: "Typical Free Tier TPM Limit".to_string(),
                used: 1_000_000.0,
                total: 0.0,
                unlimited: false,
                resets_at: None,
                unit: "tokens/min".to_string(),
            },
            GeminiStatusMetric {
                name: "Typical Free Tier RPD Limit".to_string(),
                used: 1_500.0,
                total: 0.0,
                unlimited: false,
                resets_at: None,
                unit: "requests/day".to_string(),
            },
        ],
    })
}

#[tauri::command]
pub async fn import_gemini_cli_oauth() -> Result<GeminiCliOAuthImportResponse, String> {
    let path = gemini_cli_credentials_path()?;
    let content = std::fs::read_to_string(&path)
        .map_err(|err| format!("Failed to read Gemini CLI credentials: {err}"))?;
    let file: GeminiCliOAuthCredentialsFile = serde_json::from_str(&content)
        .map_err(|err| format!("Failed to parse Gemini CLI credentials: {err}"))?;

    let access_token = file
        .access_token
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "Gemini CLI credentials do not contain an access token".to_string())?;

    let expires_at = file.expiry_date.and_then(expiry_millis_to_datetime);
    let email = file.id_token.as_deref().and_then(extract_email_from_jwt);

    Ok(GeminiCliOAuthImportResponse {
        credentials: OAuthCredentials {
            access_token,
            refresh_token: file.refresh_token,
            expires_at,
            scopes: vec![],
            rate_limit_tier: Some("Gemini CLI OAuth".to_string()),
        },
        email,
    })
}

fn gemini_cli_credentials_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not locate home directory".to_string())?;
    let path = home.join(".gemini").join("oauth_creds.json");
    if !path.exists() {
        return Err(
            "Gemini CLI credentials not found. Run `gemini` to authenticate first.".to_string(),
        );
    }
    Ok(path)
}

fn expiry_millis_to_datetime(expiry_millis: f64) -> Option<DateTime<Utc>> {
    let expiry_secs = (expiry_millis / 1000.0) as i64;
    DateTime::from_timestamp(expiry_secs, 0)
}

fn extract_email_from_jwt(token: &str) -> Option<String> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }

    let mut payload = parts[1].replace('-', "+").replace('_', "/");
    let remainder = payload.len() % 4;
    if remainder > 0 {
        payload.push_str(&"=".repeat(4 - remainder));
    }

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .ok()?;
    let json: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    json.get("email")
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}
