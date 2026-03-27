use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::core::OAuthCredentials;

const QWEN_MODELS_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1/models";

#[derive(Debug, Serialize)]
pub struct QwenStatusMetric {
    pub name: String,
    pub used: f64,
    pub total: f64,
    pub unlimited: bool,
    pub resets_at: Option<String>,
    pub unit: String,
}

#[derive(Debug, Serialize)]
pub struct QwenStatusResponse {
    pub plan: String,
    pub username: Option<String>,
    pub quotas: Vec<QwenStatusMetric>,
}

#[derive(Debug, Serialize)]
pub struct QwenCliOAuthImportResponse {
    pub credentials: OAuthCredentials,
    pub email: Option<String>,
    pub resource_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct QwenCliOAuthCandidate {
    pub file_path: String,
    pub file_name: String,
    pub email: Option<String>,
    pub resource_url: Option<String>,
    pub expired: Option<String>,
    pub disabled: bool,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct QwenCliOAuthFile {
    access_token: Option<String>,
    refresh_token: Option<String>,
    email: Option<String>,
    expired: Option<String>,
    resource_url: Option<String>,
    disabled: Option<bool>,
    #[serde(rename = "type")]
    auth_type: Option<String>,
}

#[tauri::command]
pub async fn get_qwen_status(api_key: String) -> Result<QwenStatusResponse, String> {
    let client = Client::new();

    let response = client
        .get(QWEN_MODELS_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| format!("Failed to validate Qwen API key: {e}"))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Qwen models endpoint returned {status}: {body}"));
    }

    Ok(QwenStatusResponse {
        plan: "API Key".to_string(),
        username: Some("openai-compatible".to_string()),
        quotas: vec![QwenStatusMetric {
            name: "API Key Validation".to_string(),
            used: 1.0,
            total: 0.0,
            unlimited: false,
            resets_at: None,
            unit: "ok".to_string(),
        }],
    })
}

#[tauri::command]
pub async fn import_qwen_cli_oauth() -> Result<QwenCliOAuthImportResponse, String> {
    import_qwen_cli_oauth_from_path(None).await
}

#[tauri::command]
pub async fn list_qwen_cli_oauth_accounts() -> Result<Vec<QwenCliOAuthCandidate>, String> {
    let paths = qwen_credentials_paths()?;
    let mut candidates = Vec::new();

    for (path, modified) in paths {
        let content = std::fs::read_to_string(&path)
            .map_err(|err| format!("Failed to read Qwen OAuth credentials: {err}"))?;
        let file: QwenCliOAuthFile = serde_json::from_str(&content)
            .map_err(|err| format!("Failed to parse Qwen OAuth credentials: {err}"))?;

        candidates.push(QwenCliOAuthCandidate {
            file_path: path.to_string_lossy().to_string(),
            file_name: path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "qwen.json".to_string()),
            email: file.email,
            resource_url: file.resource_url,
            expired: file.expired,
            disabled: file.disabled.unwrap_or(false),
            last_modified: modified.map(|timestamp| DateTime::<Utc>::from(timestamp).to_rfc3339()),
        });
    }

    Ok(candidates)
}

#[tauri::command]
pub async fn import_qwen_cli_oauth_from_path(
    file_path: Option<String>,
) -> Result<QwenCliOAuthImportResponse, String> {
    let path = match file_path {
        Some(value) if !value.trim().is_empty() => PathBuf::from(value.trim()),
        _ => latest_qwen_credentials_path()?,
    };
    let content = std::fs::read_to_string(&path)
        .map_err(|err| format!("Failed to read Qwen OAuth credentials: {err}"))?;
    let file: QwenCliOAuthFile = serde_json::from_str(&content)
        .map_err(|err| format!("Failed to parse Qwen OAuth credentials: {err}"))?;

    if file.disabled.unwrap_or(false) {
        return Err("Qwen OAuth credentials are marked disabled.".to_string());
    }

    if file
        .auth_type
        .as_deref()
        .map(|value| value.trim().eq_ignore_ascii_case("qwen"))
        == Some(false)
    {
        return Err("Selected file is not a Qwen OAuth credential.".to_string());
    }

    let access_token = file
        .access_token
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "Qwen OAuth credentials do not contain an access token".to_string())?;

    let expires_at = file.expired.as_deref().and_then(parse_datetime);

    Ok(QwenCliOAuthImportResponse {
        credentials: OAuthCredentials {
            access_token,
            refresh_token: file.refresh_token,
            expires_at,
            scopes: vec![],
            rate_limit_tier: Some("Qwen OAuth".to_string()),
        },
        email: file.email,
        resource_url: file.resource_url,
    })
}

fn latest_qwen_credentials_path() -> Result<PathBuf, String> {
    qwen_credentials_paths()?
        .into_iter()
        .map(|item| item.0)
        .next()
        .ok_or_else(|| "No Qwen OAuth credential files were found.".to_string())
}

fn qwen_credentials_paths() -> Result<Vec<(PathBuf, Option<std::time::SystemTime>)>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not locate home directory".to_string())?;
    let base = home.join(".cli-proxy-api");
    if !base.exists() {
        return Err("Qwen OAuth credentials not found. Authenticate Qwen first.".to_string());
    }

    let mut matches = std::fs::read_dir(&base)
        .map_err(|err| format!("Failed to inspect local Qwen credential directory: {err}"))?
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy().to_string();
            if !path.is_file() || !name.starts_with("qwen-") || !name.ends_with(".json") {
                return None;
            }

            let modified = entry
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok());
            Some((path, modified))
        })
        .collect::<Vec<_>>();

    matches.sort_by(|left, right| right.1.cmp(&left.1));
    if matches.is_empty() {
        return Err("No Qwen OAuth credential files were found.".to_string());
    }

    Ok(matches)
}

fn parse_datetime(value: &str) -> Option<DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.with_timezone(&Utc))
}
