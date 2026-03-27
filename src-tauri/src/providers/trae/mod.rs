use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, ORIGIN, REFERER, USER_AGENT};
use serde::Deserialize;

use crate::core::{
    FetchContext, NamedRateWindow, Provider, ProviderError, ProviderFetchResult, ProviderId,
    ProviderMetadata, RateWindow, UsageSnapshot,
};

const STORAGE_AUTH_KEY: &str = "iCubeAuthInfo://icube.cloudide";
const DEFAULT_API_HOST: &str = "https://api-sg-central.trae.ai";

#[derive(Debug, Clone)]
pub struct TraeLocalSession {
    pub email: Option<String>,
    pub username: Option<String>,
    pub user_id: Option<String>,
    pub access_token: String,
    pub api_host: String,
}

#[derive(Debug, Deserialize)]
struct TraeStorageAuthInfo {
    #[serde(rename = "token")]
    access_token: Option<String>,
    #[serde(rename = "refreshToken")]
    _refresh_token: Option<String>,
    #[serde(rename = "userId")]
    user_id: Option<String>,
    #[serde(rename = "host")]
    api_host: Option<String>,
    account: Option<TraeStorageAccount>,
}

#[derive(Debug, Deserialize)]
struct TraeStorageAccount {
    email: Option<String>,
    username: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TraeEntitlementResponse {
    #[serde(default)]
    user_entitlement_pack_list: Vec<TraeEntitlement>,
}

#[derive(Debug, Deserialize)]
struct TraeEntitlement {
    #[serde(default)]
    status: i32,
    entitlement_base_info: Option<TraeEntitlementBaseInfo>,
    usage: Option<TraeUsageAmounts>,
}

#[derive(Debug, Deserialize)]
struct TraeEntitlementBaseInfo {
    quota: Option<TraeQuotaLimits>,
    product_type: Option<i32>,
    end_time: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct TraeQuotaLimits {
    advanced_model_request_limit: Option<i64>,
    auto_completion_limit: Option<i64>,
    premium_model_fast_request_limit: Option<i64>,
    premium_model_slow_request_limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct TraeUsageAmounts {
    advanced_model_amount: Option<i64>,
    auto_completion_amount: Option<i64>,
    premium_model_fast_amount: Option<i64>,
    premium_model_slow_amount: Option<i64>,
}

pub struct TraeProvider {
    metadata: ProviderMetadata,
    client: reqwest::Client,
}

impl TraeProvider {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .expect("create trae client");

        Self {
            metadata: ProviderMetadata {
                id: ProviderId::Trae,
                display_name: "Trae",
                session_label: "Quota",
                weekly_label: "Quota",
                supports_opus: false,
                supports_credits: false,
                default_enabled: true,
                is_primary: false,
                dashboard_url: Some("https://www.trae.ai"),
                status_page_url: None,
            },
            client,
        }
    }

    async fn fetch_entitlements(
        &self,
        session: &TraeLocalSession,
    ) -> Result<TraeEntitlementResponse, ProviderError> {
        let api_host = if session.api_host.trim().is_empty() {
            DEFAULT_API_HOST
        } else {
            session.api_host.as_str()
        };
        let endpoint = format!("{}/trae/api/v1/pay/user_current_entitlement_list", api_host);

        let response = self
            .client
            .post(endpoint)
            .header(
                USER_AGENT,
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            .header(
                AUTHORIZATION,
                format!("Cloud-IDE-JWT {}", session.access_token),
            )
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json, text/plain, */*")
            .header(ORIGIN, "https://www.trae.ai")
            .header(REFERER, "https://www.trae.ai/")
            .json(&serde_json::json!({ "require_usage": true }))
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(ProviderError::AuthRequired);
        }

        let status = response.status();
        let body = response.text().await?;
        if !status.is_success() {
            return Err(ProviderError::Other(format!(
                "Trae entitlement API returned {status}: {body}"
            )));
        }

        serde_json::from_str::<TraeEntitlementResponse>(&body)
            .map_err(|err| ProviderError::Parse(format!("Failed to parse Trae response: {err}")))
    }
}

impl Default for TraeProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Provider for TraeProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Trae
    }

    fn metadata(&self) -> &ProviderMetadata {
        &self.metadata
    }

    async fn fetch_usage(&self, _ctx: &FetchContext) -> Result<ProviderFetchResult, ProviderError> {
        let session = detect_local_session()?.ok_or(ProviderError::AuthRequired)?;
        let response = self.fetch_entitlements(&session).await?;

        let entitlement = response
            .user_entitlement_pack_list
            .iter()
            .find(|item| item.status == 1)
            .or_else(|| response.user_entitlement_pack_list.first())
            .ok_or_else(|| ProviderError::Parse("No Trae entitlement data found".to_string()))?;

        let base = entitlement.entitlement_base_info.as_ref().ok_or_else(|| {
            ProviderError::Parse("Trae entitlement base info missing".to_string())
        })?;
        let quota = base
            .quota
            .as_ref()
            .ok_or_else(|| ProviderError::Parse("Trae quota payload missing".to_string()))?;
        let usage = entitlement.usage.as_ref();
        let resets_at = base.end_time.and_then(timestamp_to_datetime);
        let (primary, extra_windows) = build_trae_windows(usage, quota, resets_at)
            .ok_or_else(|| ProviderError::Parse("Trae quota payload did not contain any usable windows".to_string()))?;

        let mut snapshot = UsageSnapshot::new(primary)
            .with_login_method(plan_label(base.product_type))
            .with_extra_windows(extra_windows);

        if let Some(email) = &session.email {
            snapshot = snapshot.with_email(email);
        }
        if let Some(user_id) = &session.user_id {
            snapshot = snapshot.with_organization(user_id);
        }

        Ok(ProviderFetchResult::new(snapshot, "local_session"))
    }
}

pub fn detect_local_session() -> Result<Option<TraeLocalSession>, ProviderError> {
    let path = local_storage_path().ok_or_else(|| {
        ProviderError::Other("Failed to resolve Trae local storage path".to_string())
    })?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = std::fs::read_to_string(&path)
        .map_err(|err| ProviderError::Other(format!("Failed to read Trae storage.json: {err}")))?;
    let storage = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&raw)
        .map_err(|err| ProviderError::Parse(format!("Failed to parse Trae storage.json: {err}")))?;

    let auth_blob = storage
        .get(STORAGE_AUTH_KEY)
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            ProviderError::Other("Trae auth blob was not found in storage.json".to_string())
        })?;

    let auth = serde_json::from_str::<TraeStorageAuthInfo>(auth_blob)
        .map_err(|err| ProviderError::Parse(format!("Failed to parse Trae auth blob: {err}")))?;

    let access_token = auth
        .access_token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let Some(access_token) = access_token else {
        return Ok(None);
    };

    Ok(Some(TraeLocalSession {
        email: auth
            .account
            .as_ref()
            .and_then(|account| account.email.clone()),
        username: auth.account.and_then(|account| account.username),
        user_id: auth.user_id,
        access_token,
        api_host: auth
            .api_host
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_API_HOST.to_string()),
    }))
}

fn local_storage_path() -> Option<std::path::PathBuf> {
    let base = dirs::data_dir()?;
    Some(
        base.join("Trae")
            .join("User")
            .join("globalStorage")
            .join("storage.json"),
    )
}

fn timestamp_to_datetime(timestamp: i64) -> Option<DateTime<Utc>> {
    Utc.timestamp_opt(timestamp, 0).single()
}

fn quota_window(used: u32, limit: u32, resets_at: Option<DateTime<Utc>>) -> Option<RateWindow> {
    if limit == 0 {
        return None;
    }

    Some(RateWindow::with_details(
        (used as f64 / limit as f64) * 100.0,
        None,
        resets_at,
        resets_at.map(|value| value.to_rfc3339()),
    ))
}

fn normalize_trae_limit(value: Option<i64>) -> Option<u32> {
    value
        .filter(|value| *value > 0)
        .and_then(|value| u32::try_from(value).ok())
}

fn normalize_trae_usage(value: Option<i64>) -> u32 {
    value
        .filter(|value| *value > 0)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(0)
}

fn build_trae_windows(
    usage: Option<&TraeUsageAmounts>,
    quota: &TraeQuotaLimits,
    resets_at: Option<DateTime<Utc>>,
) -> Option<(RateWindow, Vec<NamedRateWindow>)> {
    let mut windows = Vec::new();

    if let Some(window) = quota_window(
        usage.map(|value| normalize_trae_usage(value.advanced_model_amount)).unwrap_or(0),
        normalize_trae_limit(quota.advanced_model_request_limit).unwrap_or(0),
        resets_at,
    ) {
        windows.push(
            NamedRateWindow::new("advanced_model", "Advanced model usage", window)
                .with_kind("usage"),
        );
    }

    if let Some(window) = quota_window(
        usage.map(|value| normalize_trae_usage(value.auto_completion_amount)).unwrap_or(0),
        normalize_trae_limit(quota.auto_completion_limit).unwrap_or(0),
        resets_at,
    ) {
        windows.push(
            NamedRateWindow::new("auto_completion", "Auto-completion usage", window)
                .with_kind("usage"),
        );
    }

    if let Some(window) = quota_window(
        usage.map(|value| normalize_trae_usage(value.premium_model_fast_amount)).unwrap_or(0),
        normalize_trae_limit(quota.premium_model_fast_request_limit).unwrap_or(0),
        resets_at,
    ) {
        windows.push(
            NamedRateWindow::new("premium_fast", "Premium fast usage", window).with_kind("usage"),
        );
    }

    if let Some(window) = quota_window(
        usage.map(|value| normalize_trae_usage(value.premium_model_slow_amount)).unwrap_or(0),
        normalize_trae_limit(quota.premium_model_slow_request_limit).unwrap_or(0),
        resets_at,
    ) {
        windows.push(
            NamedRateWindow::new("premium_slow", "Premium slow usage", window).with_kind("usage"),
        );
    }

    let primary = windows.first().map(|window| window.window.clone())?;
    Some((primary, windows))
}

fn plan_label(product_type: Option<i32>) -> String {
    match product_type.unwrap_or(0) {
        0 => "Trae Free".to_string(),
        1 => "Trae Pro".to_string(),
        2 => "Trae Team".to_string(),
        3 => "Trae Builder".to_string(),
        other => format!("Trae Tier {}", other),
    }
}
