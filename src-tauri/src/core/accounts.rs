use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    FetchContext, OAuthCredentials, ProviderFetchResult, ProviderId, ServiceAccountCredentials,
};

const OAUTH_AUTH_KINDS: &[AccountAuthKind] = &[
    AccountAuthKind::OAuthToken,
    AccountAuthKind::ImportedCliOAuth,
];
const API_KEY_AUTH_KINDS: &[AccountAuthKind] = &[AccountAuthKind::ApiKey];
const SERVICE_ACCOUNT_AUTH_KINDS: &[AccountAuthKind] = &[AccountAuthKind::ServiceAccountJson];
const COOKIE_AUTH_KINDS: &[AccountAuthKind] = &[
    AccountAuthKind::ManualCookie,
    AccountAuthKind::BrowserProfileCookie,
];
const LOCAL_ONLY_AUTH_KINDS: &[AccountAuthKind] = &[AccountAuthKind::LocalDetected];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AccountAuthKind {
    #[serde(rename = "oauth_token", alias = "o_auth_token")]
    OAuthToken,
    #[serde(rename = "api_key")]
    ApiKey,
    #[serde(rename = "service_account_json")]
    ServiceAccountJson,
    #[serde(rename = "manual_cookie")]
    ManualCookie,
    #[serde(rename = "browser_profile_cookie")]
    BrowserProfileCookie,
    #[serde(rename = "imported_cli_oauth", alias = "imported_cli_o_auth")]
    ImportedCliOAuth,
    #[serde(rename = "local_detected")]
    LocalDetected,
}

impl AccountAuthKind {
    pub fn requires_secret(&self) -> bool {
        !matches!(self, Self::LocalDetected)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum AccountSecret {
    #[serde(rename = "oauth", alias = "o_auth")]
    OAuth { credentials: OAuthCredentials },
    #[serde(rename = "api_key")]
    ApiKey { value: String },
    #[serde(rename = "service_account_json")]
    ServiceAccountJson {
        credentials: ServiceAccountCredentials,
    },
    #[serde(rename = "manual_cookie")]
    ManualCookie { cookie_header: String },
    #[serde(rename = "browser_profile_cookie")]
    BrowserProfileCookie {
        browser_label: String,
        cookie_header: String,
    },
    #[serde(rename = "imported_cli_oauth", alias = "imported_cli_o_auth")]
    ImportedCliOAuth { credentials: OAuthCredentials },
}

impl AccountSecret {
    pub fn to_fetch_context(&self, mut ctx: FetchContext) -> FetchContext {
        match self {
            Self::OAuth { credentials } | Self::ImportedCliOAuth { credentials } => {
                ctx.oauth_credentials = Some(credentials.clone());
                ctx.api_key = Some(credentials.access_token.clone());
            }
            Self::ApiKey { value } => {
                ctx.api_key = Some(value.clone());
            }
            Self::ServiceAccountJson { credentials } => {
                ctx.service_account_credentials = Some(credentials.clone());
            }
            Self::ManualCookie { cookie_header } => {
                ctx.manual_cookie_header = Some(cookie_header.clone());
            }
            Self::BrowserProfileCookie {
                cookie_header,
                browser_label,
            } => {
                ctx.manual_cookie_header = Some(cookie_header.clone());
                ctx.account_label = Some(browser_label.clone());
            }
        }

        ctx
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountSecretRef {
    pub service: String,
    pub key: String,
}

impl AccountSecretRef {
    pub fn for_account(provider_id: ProviderId, account_id: Uuid) -> Self {
        Self {
            service: "tokenflow".to_string(),
            key: format!(
                "account::{provider}::{account_id}",
                provider = provider_id.cli_name()
            ),
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountDisplay {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_health: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_health_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_checked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountRecord {
    pub id: Uuid,
    pub provider_id: ProviderId,
    pub label: String,
    pub auth_kind: AccountAuthKind,
    #[serde(default)]
    pub default: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret_ref: Option<AccountSecretRef>,
    #[serde(default)]
    pub display: AccountDisplay,
    #[serde(default)]
    pub system_managed: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl AccountRecord {
    pub fn new(
        provider_id: ProviderId,
        label: String,
        auth_kind: AccountAuthKind,
        display: AccountDisplay,
        system_managed: bool,
        has_secret: bool,
    ) -> Self {
        let id = Uuid::new_v4();
        let now = Utc::now();

        Self {
            id,
            provider_id,
            label,
            auth_kind,
            default: false,
            secret_ref: has_secret.then(|| AccountSecretRef::for_account(provider_id, id)),
            display,
            system_managed,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn touch(&mut self) {
        self.updated_at = Utc::now();
    }

    pub fn apply_usage(&mut self, result: &ProviderFetchResult) {
        if let Some(email) = &result.usage.account_email {
            self.display.email = Some(email.clone());
        }
        if let Some(plan) = &result.usage.login_method {
            self.display.plan = Some(plan.clone());
        }
        self.touch();
    }

    pub fn set_session_health(
        &mut self,
        health: Option<&str>,
        reason: Option<String>,
        checked_at: Option<DateTime<Utc>>,
    ) {
        self.display.session_health = health.map(ToOwned::to_owned);
        self.display.session_health_reason = reason;
        self.display.session_checked_at = checked_at;
        self.touch();
    }

    #[cfg(test)]
    pub fn new_test(provider_id: ProviderId, auth_kind: AccountAuthKind) -> Self {
        Self::new(
            provider_id,
            "Test Account".to_string(),
            auth_kind.clone(),
            AccountDisplay::default(),
            false,
            auth_kind.requires_secret(),
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountUsageResult {
    pub account: AccountRecord,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ProviderFetchResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl AccountUsageResult {
    pub fn success(account: AccountRecord, result: ProviderFetchResult) -> Self {
        Self {
            account,
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(account: AccountRecord, error: impl Into<String>) -> Self {
        Self {
            account,
            ok: false,
            result: None,
            error: Some(error.into()),
        }
    }
}

impl ProviderId {
    pub fn supported_account_auth_kinds(&self) -> &'static [AccountAuthKind] {
        match self {
            ProviderId::Codex
            | ProviderId::Claude
            | ProviderId::Iflow
            | ProviderId::Antigravity => OAUTH_AUTH_KINDS,
            ProviderId::Copilot => &[AccountAuthKind::OAuthToken],
            ProviderId::Gemini | ProviderId::Qwen => &[AccountAuthKind::ImportedCliOAuth],
            ProviderId::Cursor => &[
                AccountAuthKind::LocalDetected,
                AccountAuthKind::BrowserProfileCookie,
                AccountAuthKind::ManualCookie,
            ],
            ProviderId::Kiro | ProviderId::Trae => LOCAL_ONLY_AUTH_KINDS,
            ProviderId::Factory | ProviderId::Kimi | ProviderId::Ollama | ProviderId::OpenCode => {
                COOKIE_AUTH_KINDS
            }
            ProviderId::OpenRouter
            | ProviderId::Warp
            | ProviderId::Zai
            | ProviderId::KimiK2
            | ProviderId::Amp
            | ProviderId::Augment
            | ProviderId::MiniMax
            | ProviderId::Synthetic => API_KEY_AUTH_KINDS,
            ProviderId::VertexAI => SERVICE_ACCOUNT_AUTH_KINDS,
            ProviderId::JetBrains => LOCAL_ONLY_AUTH_KINDS,
        }
    }

    pub fn prefers_native_oauth(&self) -> bool {
        matches!(
            self,
            ProviderId::Codex | ProviderId::Claude | ProviderId::Iflow | ProviderId::Antigravity
        )
    }

    pub fn is_system_managed_only(&self) -> bool {
        matches!(self, ProviderId::JetBrains)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_record_round_trips_without_secret_material() {
        let account = AccountRecord::new_test(ProviderId::Claude, AccountAuthKind::OAuthToken);
        let json = serde_json::to_string(&account).expect("serialize account fixture");
        assert!(json.contains("claude"));
        assert!(!json.contains("access_token"));
    }

    #[test]
    fn secret_ref_uses_account_scoped_key() {
        let secret_ref = AccountSecretRef::for_account(ProviderId::OpenRouter, Uuid::nil());
        assert_eq!(secret_ref.service, "tokenflow");
        assert!(secret_ref.key.contains("openrouter"));
    }

    #[test]
    fn provider_capabilities_match_expected_modes() {
        assert!(ProviderId::Claude
            .supported_account_auth_kinds()
            .contains(&AccountAuthKind::OAuthToken));
        assert!(ProviderId::OpenRouter
            .supported_account_auth_kinds()
            .contains(&AccountAuthKind::ApiKey));
        assert!(ProviderId::Cursor
            .supported_account_auth_kinds()
            .contains(&AccountAuthKind::ManualCookie));
        assert!(ProviderId::Kiro
            .supported_account_auth_kinds()
            .contains(&AccountAuthKind::LocalDetected));
        assert!(ProviderId::Codex.prefers_native_oauth());
    }
}
