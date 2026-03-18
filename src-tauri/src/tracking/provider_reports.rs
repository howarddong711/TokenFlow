use std::collections::BTreeSet;

use crate::core::{AccountAuthKind, AccountRecord, ProviderId};

use super::types::RequestTrackingSource;

pub fn collect_tracking_sources(accounts: &[AccountRecord]) -> Vec<RequestTrackingSource> {
    let mut provider_ids = BTreeSet::new();

    for account in accounts {
        if is_provider_reported_account(account.provider_id, &account.auth_kind) {
            provider_ids.insert(account.provider_id.cli_name().to_string());
        }
    }

    let provider_ids: Vec<String> = provider_ids.into_iter().collect();
    let ready = !provider_ids.is_empty();

    let detail = if ready {
        format!(
            "Official usage and quota reporting is available for the connected provider set: {}.",
            provider_ids.join(", ")
        )
    } else {
        "Provider-reported request usage is not connected yet. This source will be used for official usage and analytics endpoints when available.".to_string()
    };

    vec![RequestTrackingSource {
        source_type: "provider_reported".to_string(),
        label: "Provider-reported usage".to_string(),
        provider_ids,
        coverage: if ready {
            "partial".to_string()
        } else {
            "none".to_string()
        },
        status: if ready {
            "ready".to_string()
        } else {
            "unavailable".to_string()
        },
        detail,
    }]
}

fn is_provider_reported_account(provider_id: ProviderId, auth_kind: &AccountAuthKind) -> bool {
    match provider_id {
        ProviderId::Codex => matches!(
            auth_kind,
            AccountAuthKind::OAuthToken | AccountAuthKind::ImportedCliOAuth
        ),
        ProviderId::Claude => matches!(
            auth_kind,
            AccountAuthKind::OAuthToken
                | AccountAuthKind::ImportedCliOAuth
                | AccountAuthKind::ManualCookie
                | AccountAuthKind::BrowserProfileCookie
        ),
        ProviderId::Copilot => matches!(auth_kind, AccountAuthKind::OAuthToken),
        ProviderId::Amp
        | ProviderId::Augment
        | ProviderId::OpenRouter
        | ProviderId::Warp
        | ProviderId::Zai => matches!(auth_kind, AccountAuthKind::ApiKey),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use uuid::Uuid;

    use crate::core::{AccountDisplay, AccountRecord};

    use super::*;

    fn account(provider_id: ProviderId, auth_kind: AccountAuthKind) -> AccountRecord {
        AccountRecord {
            id: Uuid::new_v4(),
            provider_id,
            label: "test".to_string(),
            auth_kind,
            default: false,
            secret_ref: None,
            display: AccountDisplay::default(),
            system_managed: false,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn provider_reported_detects_supported_accounts() {
        let sources = collect_tracking_sources(&[
            account(ProviderId::Codex, AccountAuthKind::OAuthToken),
            account(ProviderId::Copilot, AccountAuthKind::OAuthToken),
        ]);

        let source = &sources[0];
        assert_eq!(source.status, "ready");
        assert!(source.provider_ids.iter().any(|provider| provider == "codex"));
        assert!(source.provider_ids.iter().any(|provider| provider == "copilot"));
    }
}
