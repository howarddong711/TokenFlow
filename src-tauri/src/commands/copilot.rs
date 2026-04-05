//! GitHub Copilot Device Flow & User Commands
//!
//! Implements GitHub OAuth device flow (RFC 8628) and Copilot user info
//! fetching via Rust/reqwest to bypass CORS restrictions in the webview.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// GitHub OAuth app client ID (same one used by VS Code / Copilot CLI)
const GITHUB_CLIENT_ID: &str = "Iv1.b507a08c87ecfe98";
const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL: &str = "https://api.github.com/user";
const COPILOT_TOKEN_URL: &str = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_USER_URL: &str = "https://api.github.com/copilot_internal/user";

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenPollResponse {
    pub access_token: Option<String>,
    pub token_type: Option<String>,
    pub scope: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CopilotUserInfo {
    pub login: Option<String>,
    pub email: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CopilotTokenEnvelope {
    pub token: String,
    pub expires_at: u64,
    pub refresh_in: Option<u64>,
    pub sku: Option<String>,
    pub individual: Option<bool>,
    pub limited_user_quotas: Option<LimitedUserQuotas>,
    pub limited_user_reset_date: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LimitedUserQuotas {
    pub chat: Option<f64>,
    pub completions: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CopilotQuotaSnapshots {
    pub chat: Option<CopilotQuotaSnapshot>,
    pub completions: Option<CopilotQuotaSnapshot>,
    pub premium_interactions: Option<CopilotQuotaSnapshot>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CopilotQuotaSnapshot {
    pub entitlement: Option<f64>,
    pub remaining: Option<f64>,
    pub percent_remaining: Option<f64>,
    pub unlimited: Option<bool>,
    pub overage_count: Option<f64>,
    pub overage_permitted: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CopilotUsageInfo {
    pub access_type_sku: Option<String>,
    pub copilot_plan: Option<String>,
    pub quota_reset_date: Option<String>,
    pub monthly_quotas: Option<LimitedUserQuotas>,
    pub limited_user_quotas: Option<LimitedUserQuotas>,
    pub quota_snapshots: Option<CopilotQuotaSnapshots>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CopilotQuotaCategory {
    pub name: String,
    pub used: f64,
    pub total: f64,
    pub unlimited: bool,
    pub resets_at: Option<String>,
    pub unit: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CopilotStatusResponse {
    pub plan: String,
    pub access_type_sku: Option<String>,
    pub token_expires_at: Option<u64>,
    pub quotas: Vec<CopilotQuotaCategory>,
}

fn build_quota_from_snapshot(
    name: &str,
    snapshot: &CopilotQuotaSnapshot,
    reset_date: Option<&str>,
) -> CopilotQuotaCategory {
    let unlimited = snapshot.unlimited.unwrap_or(false);

    if unlimited {
        return CopilotQuotaCategory {
            name: name.to_string(),
            used: 0.0,
            total: 0.0,
            unlimited: true,
            resets_at: reset_date.map(str::to_string),
            unit: "requests".to_string(),
        };
    }

    if let Some(entitlement) = snapshot.entitlement {
        let remaining = snapshot.remaining.unwrap_or_else(|| {
            snapshot
                .percent_remaining
                .map(|percent| entitlement * (percent / 100.0))
                .unwrap_or(0.0)
        });

        return CopilotQuotaCategory {
            name: name.to_string(),
            used: (entitlement - remaining).max(0.0),
            total: entitlement.max(0.0),
            unlimited: false,
            resets_at: reset_date.map(str::to_string),
            unit: "requests".to_string(),
        };
    }

    let percent_remaining = snapshot.percent_remaining.unwrap_or(0.0).clamp(0.0, 100.0);
    CopilotQuotaCategory {
        name: name.to_string(),
        used: 100.0 - percent_remaining,
        total: 100.0,
        unlimited: false,
        resets_at: reset_date.map(str::to_string),
        unit: "%".to_string(),
    }
}

fn build_quota_from_limited(
    name: &str,
    monthly_total: Option<f64>,
    remaining: Option<f64>,
    reset_date: Option<String>,
) -> Option<CopilotQuotaCategory> {
    match (monthly_total, remaining) {
        (Some(total), Some(left)) if total > 0.0 => Some(CopilotQuotaCategory {
            name: name.to_string(),
            used: (total - left).max(0.0),
            total,
            unlimited: false,
            resets_at: reset_date,
            unit: "requests".to_string(),
        }),
        _ => None,
    }
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Step 1: Start the GitHub device flow by requesting a device code.
/// Returns a user_code the user must enter at verification_uri.
#[tauri::command]
pub async fn start_device_flow() -> Result<DeviceCodeResponse, String> {
    let client = Client::new();

    let mut params = HashMap::new();
    params.insert("client_id", GITHUB_CLIENT_ID);
    params.insert("scope", "read:user user:email");

    let res = client
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Failed to request device code: {e}"))?;

    if !res.status().is_success() {
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("GitHub returned {status}: {body}"));
    }

    res.json::<DeviceCodeResponse>()
        .await
        .map_err(|e| format!("Failed to parse device code response: {e}"))
}

/// Step 2: Poll GitHub for the access token (call repeatedly at `interval`).
/// Returns the raw response so the frontend can handle authorization_pending, etc.
#[tauri::command]
pub async fn poll_device_flow(device_code: String) -> Result<TokenPollResponse, String> {
    let client = Client::new();

    let mut params = HashMap::new();
    params.insert("client_id", GITHUB_CLIENT_ID);
    params.insert("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
    let device_code_ref = device_code.as_str();
    params.insert("device_code", device_code_ref);

    let res = client
        .post(ACCESS_TOKEN_URL)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Failed to poll for token: {e}"))?;

    res.json::<TokenPollResponse>()
        .await
        .map_err(|e| format!("Failed to parse token response: {e}"))
}

/// Step 3: Fetch the authenticated user's GitHub profile info.
#[tauri::command]
pub async fn get_copilot_user(access_token: String) -> Result<CopilotUserInfo, String> {
    let client = Client::new();

    let res = client
        .get(GITHUB_USER_URL)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .header("User-Agent", "TokenFlow/0.1.6")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch user info: {e}"))?;

    if !res.status().is_success() {
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("GitHub returned {status}: {body}"));
    }

    res.json::<CopilotUserInfo>()
        .await
        .map_err(|e| format!("Failed to parse user info: {e}"))
}

#[tauri::command]
pub async fn get_copilot_status(access_token: String) -> Result<CopilotStatusResponse, String> {
    let client = Client::new();

    let token_res = client
        .get(COPILOT_TOKEN_URL)
        .header("Authorization", format!("token {access_token}"))
        .header("Accept", "application/json")
        .header("User-Agent", "TokenFlow/0.1.6")
        .send()
        .await
        .map_err(|e| format!("Failed to exchange Copilot token: {e}"))?;

    if !token_res.status().is_success() {
        let status = token_res.status().as_u16();
        let body = token_res.text().await.unwrap_or_default();
        return Err(format!("Copilot token endpoint returned {status}: {body}"));
    }

    let token_info = token_res
        .json::<CopilotTokenEnvelope>()
        .await
        .map_err(|e| format!("Failed to parse Copilot token response: {e}"))?;

    let usage_res = client
        .get(COPILOT_USER_URL)
        .header("Authorization", format!("token {access_token}"))
        .header("Accept", "application/json")
        .header("Editor-Version", "vscode/1.96.2")
        .header("Editor-Plugin-Version", "copilot-chat/0.26.7")
        .header("User-Agent", "GitHubCopilotChat/0.26.7")
        .header("X-Github-Api-Version", "2025-04-01")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Copilot usage: {e}"))?;

    if !usage_res.status().is_success() {
        let status = usage_res.status().as_u16();
        let body = usage_res.text().await.unwrap_or_default();
        return Err(format!("Copilot usage endpoint returned {status}: {body}"));
    }

    let usage_info = usage_res
        .json::<CopilotUsageInfo>()
        .await
        .map_err(|e| format!("Failed to parse Copilot usage response: {e}"))?;

    let mut quotas = Vec::new();

    if let Some(snapshots) = &usage_info.quota_snapshots {
        if let Some(snapshot) = &snapshots.premium_interactions {
            quotas.push(build_quota_from_snapshot(
                "Premium Interactions",
                snapshot,
                usage_info.quota_reset_date.as_deref(),
            ));
        }
        if let Some(snapshot) = &snapshots.chat {
            quotas.push(build_quota_from_snapshot(
                "Chat",
                snapshot,
                usage_info.quota_reset_date.as_deref(),
            ));
        }
        if let Some(snapshot) = &snapshots.completions {
            quotas.push(build_quota_from_snapshot(
                "Completions",
                snapshot,
                usage_info.quota_reset_date.as_deref(),
            ));
        }
    }

    if quotas.is_empty() {
        if let Some(quota) = build_quota_from_limited(
            "Chat",
            usage_info.monthly_quotas.as_ref().and_then(|q| q.chat),
            usage_info.limited_user_quotas.as_ref().and_then(|q| q.chat),
            usage_info.quota_reset_date.clone(),
        ) {
            quotas.push(quota);
        }

        if let Some(quota) = build_quota_from_limited(
            "Completions",
            usage_info
                .monthly_quotas
                .as_ref()
                .and_then(|q| q.completions),
            usage_info
                .limited_user_quotas
                .as_ref()
                .and_then(|q| q.completions),
            usage_info.quota_reset_date.clone(),
        ) {
            quotas.push(quota);
        }
    }

    Ok(CopilotStatusResponse {
        plan: usage_info
            .copilot_plan
            .or(token_info.sku.clone())
            .unwrap_or_else(|| "Copilot".to_string()),
        access_type_sku: usage_info.access_type_sku.or(token_info.sku),
        token_expires_at: Some(token_info.expires_at),
        quotas,
    })
}
