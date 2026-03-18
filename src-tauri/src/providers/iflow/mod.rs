//! iFlow provider implementation
//!
//! Uses the official iFlow OAuth access token to validate the linked account.
//! iFlow does not currently expose provider-native quota windows here, so the
//! provider reports account identity and plan status without synthetic quotas.

use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

use crate::core::{
    FetchContext, OAuthCredentials, Provider, ProviderError, ProviderFetchResult, ProviderId,
    ProviderMetadata, RateWindow, SourceMode, UsageSnapshot,
};

const CLIENT_ID: &str = "10009311001";
const CLIENT_SECRET: &str = "4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW";
const TOKEN_ENDPOINT: &str = "https://iflow.cn/oauth/token";
const USER_INFO_ENDPOINT: &str = "https://iflow.cn/api/oauth/getUserInfo";

pub struct IflowProvider {
    metadata: ProviderMetadata,
    client: Client,
}

impl IflowProvider {
    pub fn new() -> Self {
        Self {
            metadata: ProviderMetadata {
                id: ProviderId::Iflow,
                display_name: "iFlow",
                session_label: "Account",
                weekly_label: "Account",
                supports_opus: false,
                supports_credits: false,
                default_enabled: false,
                is_primary: false,
                dashboard_url: Some("https://iflow.cn"),
                status_page_url: None,
            },
            client: Client::new(),
        }
    }

    async fn fetch_user_info(&self, access_token: &str) -> Result<IflowUserInfoData, ProviderError> {
        let response = self
            .client
            .get(USER_INFO_ENDPOINT)
            .query(&[("accessToken", access_token)])
            .send()
            .await?;

        if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            return Err(ProviderError::AuthRequired);
        }

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::Other(format!(
                "iFlow user info endpoint returned {status}: {body}"
            )));
        }

        let payload = response
            .json::<IflowUserInfoApiResponse>()
            .await
            .map_err(|err| ProviderError::Parse(err.to_string()))?;

        if !payload.success {
            return Err(ProviderError::Other(
                "iFlow user info response reported unsuccessful status".to_string(),
            ));
        }

        payload
            .data
            .ok_or_else(|| ProviderError::Parse("iFlow user info response missing data".to_string()))
    }

    async fn refresh_access_token(
        &self,
        refresh_token: &str,
    ) -> Result<IflowRefreshTokenResponse, ProviderError> {
        let response = self
            .client
            .post(TOKEN_ENDPOINT)
            .header("Authorization", format!("Basic {}", make_basic_auth_header()))
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
                ("client_id", CLIENT_ID),
                ("client_secret", CLIENT_SECRET),
            ])
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::Other(format!(
                "iFlow refresh endpoint returned {status}: {body}"
            )));
        }

        response
            .json::<IflowRefreshTokenResponse>()
            .await
            .map_err(|err| ProviderError::Parse(err.to_string()))
    }

    async fn fetch_snapshot(
        &self,
        credentials: &OAuthCredentials,
    ) -> Result<ProviderFetchResult, ProviderError> {
        let primary_attempt = self.fetch_user_info(&credentials.access_token).await;

        let user_info = match primary_attempt {
            Ok(info) => info,
            Err(ProviderError::AuthRequired) => {
                let refresh_token = credentials
                    .refresh_token
                    .as_deref()
                    .ok_or(ProviderError::AuthRequired)?;
                let refreshed = self.refresh_access_token(refresh_token).await?;
                self.fetch_user_info(&refreshed.access_token).await?
            }
            Err(err) => return Err(err),
        };

        let label = if user_info.api_key.as_deref().unwrap_or_default().is_empty() {
            "iFlow OAuth".to_string()
        } else {
            "iFlow OAuth (API linked)".to_string()
        };

        let mut usage = UsageSnapshot::new(RateWindow::new(0.0)).with_login_method(label);
        if let Some(email) = user_info.email.filter(|value| !value.trim().is_empty()) {
            usage = usage.with_email(email);
        }

        Ok(ProviderFetchResult::new(usage, "oauth"))
    }
}

impl Default for IflowProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Provider for IflowProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Iflow
    }

    fn metadata(&self) -> &ProviderMetadata {
        &self.metadata
    }

    async fn fetch_usage(&self, ctx: &FetchContext) -> Result<ProviderFetchResult, ProviderError> {
        let credentials = ctx
            .oauth_credentials
            .as_ref()
            .ok_or(ProviderError::AuthRequired)?;
        self.fetch_snapshot(credentials).await
    }

    fn available_sources(&self) -> Vec<SourceMode> {
        vec![SourceMode::Auto, SourceMode::OAuth]
    }

    fn supports_oauth(&self) -> bool {
        true
    }
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
}

#[derive(Debug, Deserialize)]
struct IflowRefreshTokenResponse {
    access_token: String,
}

fn make_basic_auth_header() -> String {
    let source = format!("{CLIENT_ID}:{CLIENT_SECRET}");
    let bytes = source.as_bytes();
    let table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    let mut i = 0usize;

    while i < bytes.len() {
        let b0 = bytes[i];
        let b1 = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        let b2 = if i + 2 < bytes.len() { bytes[i + 2] } else { 0 };
        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);

        encoded.push(table[((n >> 18) & 0x3f) as usize] as char);
        encoded.push(table[((n >> 12) & 0x3f) as usize] as char);
        encoded.push(if i + 1 < bytes.len() {
            table[((n >> 6) & 0x3f) as usize] as char
        } else {
            '='
        });
        encoded.push(if i + 2 < bytes.len() {
            table[(n & 0x3f) as usize] as char
        } else {
            '='
        });

        i += 3;
    }

    encoded
}
