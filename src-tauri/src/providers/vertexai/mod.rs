//! Vertex AI provider implementation
//!
//! TokenFlow treats Vertex AI like Quotio: the primary connection path is a
//! project-scoped Service Account JSON import. The provider validates the
//! service account by exchanging a Google access token and reading project
//! identity, but it does not fabricate quota windows that are not officially
//! exposed.

mod token_refresher;

#[allow(unused_imports)]
pub use token_refresher::{RefreshError, VertexAIOAuthCredentials, VertexAITokenRefresher};

use async_trait::async_trait;
use chrono::Utc;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::core::{
    FetchContext, Provider, ProviderError, ProviderFetchResult, ProviderId, ProviderMetadata,
    RateWindow, ServiceAccountCredentials, SourceMode, UsageSnapshot,
};

pub struct VertexAIProvider {
    metadata: ProviderMetadata,
    client: Client,
}

impl VertexAIProvider {
    pub fn new() -> Self {
        Self {
            metadata: ProviderMetadata {
                id: ProviderId::VertexAI,
                display_name: "Vertex AI",
                session_label: "Project",
                weekly_label: "Project",
                supports_opus: false,
                supports_credits: false,
                default_enabled: false,
                is_primary: false,
                dashboard_url: Some("https://console.cloud.google.com/vertex-ai"),
                status_page_url: Some("https://status.cloud.google.com"),
            },
            client: Client::new(),
        }
    }

    async fn fetch_with_service_account(
        &self,
        credentials: &ServiceAccountCredentials,
    ) -> Result<UsageSnapshot, ProviderError> {
        let access_token = self.exchange_service_account_token(credentials).await?;
        self.fetch_project_snapshot(&access_token, credentials).await
    }

    async fn exchange_service_account_token(
        &self,
        credentials: &ServiceAccountCredentials,
    ) -> Result<String, ProviderError> {
        let now = Utc::now().timestamp();
        let claims = GoogleJwtClaims {
            iss: credentials.client_email.clone(),
            scope: "https://www.googleapis.com/auth/cloud-platform".to_string(),
            aud: credentials.token_uri.clone(),
            iat: now,
            exp: now + 3600,
        };

        let assertion = encode(
            &Header::new(Algorithm::RS256),
            &claims,
            &EncodingKey::from_rsa_pem(credentials.private_key.as_bytes())
                .map_err(|err| ProviderError::Other(format!("Invalid Vertex private key: {err}")))?,
        )
        .map_err(|err| ProviderError::Other(format!("Failed to sign Vertex JWT: {err}")))?;

        let response = self
            .client
            .post(&credentials.token_uri)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", assertion.as_str()),
            ])
            .send()
            .await?;

        if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            return Err(ProviderError::AuthRequired);
        }

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::Other(format!(
                "Vertex token exchange returned {status}: {body}"
            )));
        }

        let payload = response
            .json::<GoogleTokenResponse>()
            .await
            .map_err(|err| ProviderError::Parse(err.to_string()))?;

        Ok(payload.access_token)
    }

    async fn fetch_project_snapshot(
        &self,
        access_token: &str,
        credentials: &ServiceAccountCredentials,
    ) -> Result<UsageSnapshot, ProviderError> {
        let response = self
            .client
            .get(format!(
                "https://cloudresourcemanager.googleapis.com/v1/projects/{}",
                credentials.project_id
            ))
            .bearer_auth(access_token)
            .send()
            .await?;

        if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            return Err(ProviderError::AuthRequired);
        }

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::Other(format!(
                "Vertex project lookup returned {status}: {body}"
            )));
        }

        let project = response
            .json::<GoogleProjectResponse>()
            .await
            .map_err(|err| ProviderError::Parse(err.to_string()))?;

        let label = project.name.unwrap_or_else(|| credentials.project_id.clone());
        Ok(
            UsageSnapshot::new(RateWindow::new(0.0))
                .with_login_method(format!("Vertex AI Project {}", label))
                .with_email(credentials.client_email.clone())
                .with_organization(credentials.project_id.clone()),
        )
    }

    fn get_gcloud_config_path() -> Option<PathBuf> {
        if let Ok(path) = std::env::var("GOOGLE_APPLICATION_CREDENTIALS") {
            return Some(PathBuf::from(path));
        }

        #[cfg(target_os = "windows")]
        {
            dirs::config_dir().map(|p| p.join("gcloud").join("application_default_credentials.json"))
        }
        #[cfg(not(target_os = "windows"))]
        {
            dirs::home_dir().map(|p| {
                p.join(".config")
                    .join("gcloud")
                    .join("application_default_credentials.json")
            })
        }
    }

    fn which_gcloud() -> Option<PathBuf> {
        let possible_paths = [
            which::which("gcloud").ok(),
            #[cfg(target_os = "windows")]
            Some(PathBuf::from(
                "C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd",
            )),
            #[cfg(target_os = "windows")]
            Some(PathBuf::from("C:\\Users\\Public\\google-cloud-sdk\\bin\\gcloud.cmd")),
            #[cfg(not(target_os = "windows"))]
            None,
        ];

        possible_paths.into_iter().flatten().find(|path| path.exists())
    }

    async fn fetch_via_local_environment(&self) -> Result<UsageSnapshot, ProviderError> {
        let project_id = self.get_project_id().await?;
        Ok(UsageSnapshot::new(RateWindow::new(0.0))
            .with_login_method(format!("Vertex AI ({project_id})")))
    }

    async fn get_project_id(&self) -> Result<String, ProviderError> {
        if let Ok(project) = std::env::var("GOOGLE_CLOUD_PROJECT") {
            return Ok(project);
        }

        #[cfg(target_os = "windows")]
        let config_path = dirs::config_dir().map(|p| p.join("gcloud").join("properties"));
        #[cfg(not(target_os = "windows"))]
        let config_path =
            dirs::home_dir().map(|p| p.join(".config").join("gcloud").join("properties"));

        if let Some(path) = config_path {
            if path.exists() {
                let content = tokio::fs::read_to_string(&path)
                    .await
                    .map_err(|err| ProviderError::Other(err.to_string()))?;

                for line in content.lines() {
                    if line.starts_with("project") {
                        if let Some(project) = line.split('=').nth(1) {
                            return Ok(project.trim().to_string());
                        }
                    }
                }
            }
        }

        Err(ProviderError::Other("Project ID not found".to_string()))
    }

    async fn probe_cli(&self) -> Result<UsageSnapshot, ProviderError> {
        let gcloud = Self::which_gcloud().ok_or_else(|| {
            ProviderError::NotInstalled(
                "gcloud CLI not found. Install from https://cloud.google.com/sdk".to_string(),
            )
        })?;

        if gcloud.exists() {
            self.fetch_via_local_environment().await
        } else {
            Err(ProviderError::NotInstalled("gcloud not found".to_string()))
        }
    }

    async fn probe_adc_file(&self) -> Result<UsageSnapshot, ProviderError> {
        let path = Self::get_gcloud_config_path().ok_or_else(|| {
            ProviderError::NotInstalled("Google Cloud credentials not found".to_string())
        })?;

        if path.exists() {
            self.fetch_via_local_environment().await
        } else {
            Err(ProviderError::NotInstalled(
                "Google Cloud credentials not found".to_string(),
            ))
        }
    }
}

impl Default for VertexAIProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Provider for VertexAIProvider {
    fn id(&self) -> ProviderId {
        ProviderId::VertexAI
    }

    fn metadata(&self) -> &ProviderMetadata {
        &self.metadata
    }

    async fn fetch_usage(&self, ctx: &FetchContext) -> Result<ProviderFetchResult, ProviderError> {
        tracing::debug!("Fetching Vertex AI usage");

        if let Some(credentials) = ctx.service_account_credentials.as_ref() {
            let usage = self.fetch_with_service_account(credentials).await?;
            return Ok(ProviderFetchResult::new(usage, "service_account"));
        }

        match ctx.source_mode {
            SourceMode::Auto => {
                if let Ok(usage) = self.probe_adc_file().await {
                    return Ok(ProviderFetchResult::new(usage, "adc"));
                }
                let usage = self.probe_cli().await?;
                Ok(ProviderFetchResult::new(usage, "cli"))
            }
            SourceMode::Web => Err(ProviderError::UnsupportedSource(SourceMode::Web)),
            SourceMode::Cli => {
                let usage = self.probe_cli().await?;
                Ok(ProviderFetchResult::new(usage, "cli"))
            }
            SourceMode::OAuth => Err(ProviderError::UnsupportedSource(SourceMode::OAuth)),
        }
    }

    fn available_sources(&self) -> Vec<SourceMode> {
        vec![SourceMode::Auto, SourceMode::Cli]
    }

    fn supports_cli(&self) -> bool {
        true
    }
}

#[derive(Debug, Serialize)]
struct GoogleJwtClaims {
    iss: String,
    scope: String,
    aud: String,
    exp: i64,
    iat: i64,
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct GoogleProjectResponse {
    name: Option<String>,
}
