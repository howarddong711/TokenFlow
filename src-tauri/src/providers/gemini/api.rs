//! Gemini API client for fetching live quota information.
//!
//! Uses the same Google OAuth credentials that Gemini CLI stores in
//! `~/.gemini/oauth_creds.json`, refreshes them when needed, resolves the Cloud
//! Code project context, and then fetches per-model remaining quota windows.

use crate::core::{
    FetchContext, NamedRateWindow, OAuthCredentials as CoreOAuthCredentials, ProviderError,
    RateWindow,
};
use chrono::{DateTime, Utc};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;

const FETCH_AVAILABLE_MODELS_ENDPOINTS: [&str; 3] = [
    "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels",
    "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
    "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
];
const LOAD_CODE_ASSIST_ENDPOINTS: [&str; 3] = [
    "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist",
    "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
];
const TOKEN_REFRESH_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const USER_AGENT: &str = "TokenFlow/0.1.2";
const DEFAULT_WINDOW_MINUTES: u32 = 24 * 60;

#[derive(Debug, Clone)]
pub struct GeminiQuotaSnapshot {
    pub primary: RateWindow,
    pub model_specific: Option<RateWindow>,
    pub extra_windows: Vec<NamedRateWindow>,
    pub email: Option<String>,
    pub login_method: Option<String>,
}

/// Gemini API client
pub struct GeminiApi {
    client: Client,
    home_dir: PathBuf,
}

impl GeminiApi {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            home_dir: dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
        }
    }

    pub async fn fetch_quota(
        &self,
        _ctx: &FetchContext,
    ) -> Result<GeminiQuotaSnapshot, ProviderError> {
        let mut creds = self.load_credentials()?;
        self.fetch_snapshot(&mut creds, true).await
    }

    pub async fn fetch_quota_with_oauth(
        &self,
        credentials: &CoreOAuthCredentials,
    ) -> Result<GeminiQuotaSnapshot, ProviderError> {
        let mut creds = OAuthCredentials::from_core_credentials(credentials);
        self.fetch_snapshot(&mut creds, false).await
    }

    async fn fetch_snapshot(
        &self,
        creds: &mut OAuthCredentials,
        persist_credentials: bool,
    ) -> Result<GeminiQuotaSnapshot, ProviderError> {
        if creds.is_expired() {
            *creds = self
                .refresh_and_optionally_persist(creds, persist_credentials)
                .await?;
        }

        match self.fetch_snapshot_with_access_token(creds).await {
            Ok(snapshot) => Ok(snapshot),
            Err(ProviderError::AuthRequired) if creds.refresh_token.is_some() => {
                *creds = self
                    .refresh_and_optionally_persist(creds, persist_credentials)
                    .await?;
                self.fetch_snapshot_with_access_token(creds).await
            }
            Err(err) => Err(err),
        }
    }

    async fn refresh_and_optionally_persist(
        &self,
        creds: &OAuthCredentials,
        persist_credentials: bool,
    ) -> Result<OAuthCredentials, ProviderError> {
        let refreshed = self.refresh_token(creds).await?;
        if persist_credentials {
            self.save_credentials(&refreshed)?;
        }
        Ok(refreshed)
    }

    async fn fetch_snapshot_with_access_token(
        &self,
        creds: &OAuthCredentials,
    ) -> Result<GeminiQuotaSnapshot, ProviderError> {
        let access_token = creds
            .access_token
            .as_ref()
            .ok_or(ProviderError::AuthRequired)?;

        let project_context = self.fetch_project_context(access_token).await?;
        let models = self
            .fetch_available_models(access_token, project_context.project_id.as_deref())
            .await?;

        self.parse_models_response(models, creds, project_context.subscription_tier)
    }

    fn load_credentials(&self) -> Result<OAuthCredentials, ProviderError> {
        let creds_path = self.home_dir.join(".gemini").join("oauth_creds.json");

        if !creds_path.exists() {
            return Err(ProviderError::NotInstalled(
                "Not logged in to Gemini. Run `gemini` in Terminal to authenticate.".to_string(),
            ));
        }

        let content = std::fs::read_to_string(&creds_path).map_err(|err| {
            ProviderError::Other(format!("Failed to read Gemini credentials: {err}"))
        })?;

        serde_json::from_str(&content)
            .map_err(|err| ProviderError::Parse(format!("Invalid Gemini credentials: {err}")))
    }

    fn save_credentials(&self, creds: &OAuthCredentials) -> Result<(), ProviderError> {
        let creds_path = self.home_dir.join(".gemini").join("oauth_creds.json");
        let content = serde_json::to_string_pretty(creds)
            .map_err(|err| ProviderError::Parse(err.to_string()))?;
        std::fs::write(&creds_path, content).map_err(|err| {
            ProviderError::Other(format!("Failed to save Gemini credentials: {err}"))
        })?;
        Ok(())
    }

    async fn refresh_token(
        &self,
        creds: &OAuthCredentials,
    ) -> Result<OAuthCredentials, ProviderError> {
        let refresh_token = creds
            .refresh_token
            .as_ref()
            .ok_or(ProviderError::AuthRequired)?;
        let client_credentials = self.extract_oauth_client_credentials()?;

        let params = [
            ("client_id", client_credentials.client_id.as_str()),
            ("client_secret", client_credentials.client_secret.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ];

        let response = self
            .client
            .post(TOKEN_REFRESH_ENDPOINT)
            .header("User-Agent", USER_AGENT)
            .form(&params)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await?;

        if response.status() == StatusCode::UNAUTHORIZED
            || response.status() == StatusCode::BAD_REQUEST
        {
            return Err(ProviderError::AuthRequired);
        }

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::Other(format!(
                "Gemini token refresh failed with {status}: {body}"
            )));
        }

        let refresh_response: TokenRefreshResponse = response
            .json()
            .await
            .map_err(|err| ProviderError::Parse(err.to_string()))?;

        let mut refreshed = creds.clone();
        refreshed.access_token = Some(refresh_response.access_token);
        if let Some(id_token) = refresh_response.id_token {
            refreshed.id_token = Some(id_token);
        }
        if let Some(expires_in) = refresh_response.expires_in {
            refreshed.expiry_date =
                Some((chrono::Utc::now().timestamp_millis() as f64) + expires_in * 1000.0);
        }

        Ok(refreshed)
    }

    fn extract_oauth_client_credentials(&self) -> Result<OAuthClientCredentials, ProviderError> {
        let cli_config = self.home_dir.join(".gemini").join("client_config.json");
        if cli_config.exists() {
            if let Ok(content) = std::fs::read_to_string(&cli_config) {
                if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let (Some(client_id), Some(client_secret)) = (
                        config.get("client_id").and_then(|value| value.as_str()),
                        config.get("client_secret").and_then(|value| value.as_str()),
                    ) {
                        return Ok(OAuthClientCredentials {
                            client_id: client_id.to_string(),
                            client_secret: client_secret.to_string(),
                        });
                    }
                }
            }
        }

        let client_id = std::env::var("GEMINI_CLIENT_ID")
            .map_err(|_| ProviderError::NotInstalled("GEMINI_CLIENT_ID not set".to_string()))?;
        let client_secret = std::env::var("GEMINI_CLIENT_SECRET")
            .map_err(|_| ProviderError::NotInstalled("GEMINI_CLIENT_SECRET not set".to_string()))?;

        Ok(OAuthClientCredentials {
            client_id,
            client_secret,
        })
    }

    async fn fetch_project_context(
        &self,
        access_token: &str,
    ) -> Result<ProjectContext, ProviderError> {
        let payload = json!({
            "metadata": {
                "ideType": "TOKENFLOW"
            }
        });

        let mut last_error = None;
        for endpoint in LOAD_CODE_ASSIST_ENDPOINTS {
            let response = self
                .client
                .post(endpoint)
                .bearer_auth(access_token)
                .header("Content-Type", "application/json")
                .header("User-Agent", USER_AGENT)
                .json(&payload)
                .timeout(std::time::Duration::from_secs(15))
                .send()
                .await;

            match response {
                Ok(response) => {
                    if response.status() == StatusCode::UNAUTHORIZED {
                        return Err(ProviderError::AuthRequired);
                    }

                    if response.status() == StatusCode::TOO_MANY_REQUESTS
                        || response.status().is_server_error()
                    {
                        last_error = Some(ProviderError::Other(format!(
                            "Gemini loadCodeAssist returned {}",
                            response.status()
                        )));
                        continue;
                    }

                    if !response.status().is_success() {
                        last_error = Some(ProviderError::Other(format!(
                            "Gemini loadCodeAssist returned {}",
                            response.status()
                        )));
                        continue;
                    }

                    let data: LoadCodeAssistResponse = response
                        .json()
                        .await
                        .map_err(|err| ProviderError::Parse(err.to_string()))?;
                    let subscription_tier = data.resolve_subscription_tier();
                    return Ok(ProjectContext {
                        project_id: data.project_id,
                        subscription_tier,
                    });
                }
                Err(err) => {
                    last_error = Some(ProviderError::Network(err));
                }
            }
        }

        if let Some(err) = last_error {
            tracing::warn!("Gemini loadCodeAssist did not return a stable project context: {err}");
        }

        Ok(ProjectContext::default())
    }

    async fn fetch_available_models(
        &self,
        access_token: &str,
        project_id: Option<&str>,
    ) -> Result<FetchAvailableModelsResponse, ProviderError> {
        let payload = match project_id {
            Some(project_id) if !project_id.trim().is_empty() => json!({ "project": project_id }),
            _ => json!({}),
        };

        let mut last_error = None;
        for endpoint in FETCH_AVAILABLE_MODELS_ENDPOINTS {
            let response = self
                .client
                .post(endpoint)
                .bearer_auth(access_token)
                .header("Content-Type", "application/json")
                .header("User-Agent", USER_AGENT)
                .json(&payload)
                .timeout(std::time::Duration::from_secs(20))
                .send()
                .await;

            match response {
                Ok(response) => {
                    if response.status() == StatusCode::UNAUTHORIZED {
                        return Err(ProviderError::AuthRequired);
                    }

                    if response.status() == StatusCode::TOO_MANY_REQUESTS
                        || response.status().is_server_error()
                    {
                        last_error = Some(ProviderError::Other(format!(
                            "Gemini fetchAvailableModels returned {}",
                            response.status()
                        )));
                        continue;
                    }

                    if !response.status().is_success() {
                        let status = response.status();
                        let body = response.text().await.unwrap_or_default();
                        return Err(ProviderError::Other(format!(
                            "Gemini fetchAvailableModels returned {status}: {body}"
                        )));
                    }

                    return response
                        .json::<FetchAvailableModelsResponse>()
                        .await
                        .map_err(|err| ProviderError::Parse(err.to_string()));
                }
                Err(err) => {
                    last_error = Some(ProviderError::Network(err));
                }
            }
        }

        Err(last_error.unwrap_or_else(|| {
            ProviderError::Other("Failed to fetch Gemini model quotas".to_string())
        }))
    }

    fn parse_models_response(
        &self,
        response: FetchAvailableModelsResponse,
        creds: &OAuthCredentials,
        login_method: Option<String>,
    ) -> Result<GeminiQuotaSnapshot, ProviderError> {
        let mut models = response
            .models
            .into_iter()
            .filter_map(|(model_id, info)| {
                let quota_info = info.quota_info?;
                let remaining_fraction = quota_info.remaining_fraction?;
                if !is_supported_quota_model(&model_id) {
                    return None;
                }

                let used_percent = ((1.0 - remaining_fraction).clamp(0.0, 1.0)) * 100.0;
                let reset_at = quota_info.reset_time.as_deref().and_then(parse_iso_date);
                let label = info
                    .display_name
                    .unwrap_or_else(|| humanize_model_name(&model_id));
                let family = classify_model_family(info.supports_images.unwrap_or(false), &label);

                Some(ModelQuotaWindow {
                    id: model_id,
                    label,
                    used_percent,
                    resets_at: reset_at,
                    family,
                })
            })
            .collect::<Vec<_>>();

        if models.is_empty() {
            return Err(ProviderError::Parse(
                "Gemini quota response did not contain any model windows".to_string(),
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

        let extra_windows = models
            .iter()
            .map(|model| {
                NamedRateWindow::new(
                    format!("gemini-model:{}", model.id),
                    model.label.clone(),
                    model.to_rate_window(),
                )
                .with_kind("model")
            })
            .collect::<Vec<_>>();

        let email = creds.id_token.as_deref().and_then(extract_email_from_jwt);

        Ok(GeminiQuotaSnapshot {
            primary,
            model_specific,
            extra_windows,
            email,
            login_method: login_method.or_else(|| Some("Gemini CLI".to_string())),
        })
    }
}

impl Default for GeminiApi {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OAuthCredentials {
    access_token: Option<String>,
    id_token: Option<String>,
    refresh_token: Option<String>,
    expiry_date: Option<f64>,
}

impl OAuthCredentials {
    fn from_core_credentials(credentials: &CoreOAuthCredentials) -> Self {
        Self {
            access_token: Some(credentials.access_token.clone()),
            id_token: None,
            refresh_token: credentials.refresh_token.clone(),
            expiry_date: credentials
                .expires_at
                .map(|expires_at| expires_at.timestamp_millis() as f64),
        }
    }

    fn is_expired(&self) -> bool {
        if let Some(expiry_ms) = self.expiry_date {
            let refresh_cutoff_ms =
                chrono::Utc::now().timestamp_millis() as f64 + 5.0 * 60.0 * 1000.0;
            refresh_cutoff_ms >= expiry_ms
        } else {
            false
        }
    }
}

#[derive(Debug)]
struct OAuthClientCredentials {
    client_id: String,
    client_secret: String,
}

#[derive(Debug, Deserialize)]
struct TokenRefreshResponse {
    access_token: String,
    id_token: Option<String>,
    expires_in: Option<f64>,
}

#[derive(Debug, Default)]
struct ProjectContext {
    project_id: Option<String>,
    subscription_tier: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LoadCodeAssistResponse {
    #[serde(rename = "cloudaicompanionProject")]
    project_id: Option<String>,
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
    models: HashMap<String, ModelInfo>,
}

#[derive(Debug, Deserialize)]
struct ModelInfo {
    #[serde(rename = "quotaInfo")]
    quota_info: Option<QuotaInfo>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "supportsImages")]
    supports_images: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct QuotaInfo {
    #[serde(rename = "remainingFraction")]
    remaining_fraction: Option<f64>,
    #[serde(rename = "resetTime")]
    reset_time: Option<String>,
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
    used_percent: f64,
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

fn parse_iso_date(value: &str) -> Option<DateTime<Utc>> {
    if let Ok(date) = DateTime::parse_from_rfc3339(value) {
        return Some(date.with_timezone(&Utc));
    }

    if let Ok(date) = chrono::DateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%SZ") {
        return Some(date.with_timezone(&Utc));
    }

    None
}

fn extract_email_from_jwt(token: &str) -> Option<String> {
    let parts = token.split('.').collect::<Vec<_>>();
    if parts.len() < 2 {
        return None;
    }

    let mut payload = parts[1].replace('-', "+").replace('_', "/");
    let remainder = payload.len() % 4;
    if remainder > 0 {
        payload.push_str(&"=".repeat(4 - remainder));
    }

    let decoded =
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &payload).ok()?;
    let json: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    json.get("email")
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

fn is_supported_quota_model(model_id: &str) -> bool {
    let normalized = model_id.to_ascii_lowercase();
    normalized.starts_with("gemini")
        || normalized.starts_with("imagen")
        || normalized.contains("flash")
        || normalized.contains("pro")
}

fn classify_model_family(supports_images: bool, label: &str) -> ModelFamily {
    let normalized = label.to_ascii_lowercase();
    if supports_images || normalized.contains("image") || normalized.contains("imagen") {
        return ModelFamily::Image;
    }
    if normalized.contains("flash") {
        return ModelFamily::Flash;
    }
    if normalized.contains("pro") {
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
