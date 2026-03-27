//! Qwen provider implementation
//!
//! TokenFlow currently treats Qwen the Quotio way: OAuth-backed account
//! connectivity first, without inventing quota windows that the provider does
//! not stably expose through the local auth file path.

use async_trait::async_trait;

use crate::core::{
    FetchContext, Provider, ProviderError, ProviderFetchResult, ProviderId, ProviderMetadata,
    RateWindow, SourceMode, UsageSnapshot,
};

pub struct QwenProvider {
    metadata: ProviderMetadata,
}

impl QwenProvider {
    pub fn new() -> Self {
        Self {
            metadata: ProviderMetadata {
                id: ProviderId::Qwen,
                display_name: "Qwen Code",
                session_label: "Account",
                weekly_label: "Account",
                supports_opus: false,
                supports_credits: false,
                default_enabled: false,
                is_primary: false,
                dashboard_url: Some("https://portal.qwen.ai"),
                status_page_url: None,
            },
        }
    }
}

impl Default for QwenProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Provider for QwenProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Qwen
    }

    fn metadata(&self) -> &ProviderMetadata {
        &self.metadata
    }

    async fn fetch_usage(&self, ctx: &FetchContext) -> Result<ProviderFetchResult, ProviderError> {
        let credentials = ctx
            .oauth_credentials
            .as_ref()
            .ok_or(ProviderError::AuthRequired)?;

        if credentials.access_token.trim().is_empty() {
            return Err(ProviderError::AuthRequired);
        }

        let mut usage = UsageSnapshot::new(RateWindow::new(0.0)).with_login_method(
            credentials
                .rate_limit_tier
                .clone()
                .unwrap_or_else(|| "Qwen OAuth".to_string()),
        );

        if let Some(label) = ctx
            .account_label
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            usage = usage.with_organization(label.to_string());
        }

        Ok(ProviderFetchResult::new(usage, "oauth_import"))
    }

    fn available_sources(&self) -> Vec<SourceMode> {
        vec![SourceMode::Auto, SourceMode::OAuth]
    }

    fn supports_oauth(&self) -> bool {
        true
    }
}
