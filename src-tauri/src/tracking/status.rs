use crate::core::AccountRecord;

use super::gateway;
use super::local_logs;
use super::provider_reports;
use super::provider_reported_summary;
use super::types::{RequestTrackingSource, RequestTrackingStatus};

pub fn build_tracking_status(accounts: &[AccountRecord]) -> RequestTrackingStatus {
    let mut sources = Vec::new();
    sources.extend(gateway::collect_tracking_sources());
    sources.extend(provider_reports::collect_tracking_sources(accounts));
    sources.extend(provider_reported_summary::collect_tracking_sources(accounts));
    sources.extend(local_logs::collect_tracking_sources());

    let ready_sources: Vec<&RequestTrackingSource> = sources
        .iter()
        .filter(|source| source.status == "ready")
        .collect();

    let primary = ready_sources
        .iter()
        .find(|source| source.source_type == "gateway_observed")
        .or_else(|| ready_sources.iter().find(|source| source.source_type == "local_inferred"))
        .or_else(|| ready_sources.iter().find(|source| source.source_type == "provider_reported_summary"))
        .or_else(|| ready_sources.iter().find(|source| source.source_type == "provider_reported"))
        .copied();

    let overall_status = if ready_sources.is_empty() {
        "unavailable"
    } else if primary.map(|source| source.source_type.as_str()) == Some("gateway_observed") {
        "ready"
    } else {
        "limited"
    };

    let overall_coverage = if ready_sources.is_empty() {
        "none".to_string()
    } else if ready_sources.len() > 1 {
        "mixed".to_string()
    } else {
        ready_sources[0].coverage.clone()
    };

    RequestTrackingStatus {
        primary_source_type: primary.map(|source| source.source_type.clone()),
        primary_source_label: primary.map(|source| source.label.clone()),
        overall_coverage,
        overall_status: overall_status.to_string(),
        sources,
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use uuid::Uuid;

    use crate::core::{AccountAuthKind, AccountDisplay, AccountRecord, ProviderId};

    use super::build_tracking_status;

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
    fn tracking_status_stays_unavailable_or_limited_without_gateway() {
        let status = build_tracking_status(&[]);
        assert!(matches!(
            status.overall_status.as_str(),
            "unavailable" | "limited"
        ));
        assert!(!status.sources.is_empty());
    }

    #[test]
    fn provider_reported_summary_source_appears_when_supported_accounts_exist() {
        let status = build_tracking_status(&[account(
            ProviderId::Copilot,
            AccountAuthKind::OAuthToken,
        )]);
        assert!(status
            .sources
            .iter()
            .any(|source| source.source_type == "provider_reported_summary" && source.status == "ready"));
    }

    #[test]
    fn provider_reported_quota_source_appears_for_non_summary_sources() {
        let status = build_tracking_status(&[account(
            ProviderId::Codex,
            AccountAuthKind::OAuthToken,
        )]);
        assert!(status
            .sources
            .iter()
            .any(|source| source.source_type == "provider_reported" && source.status == "ready"));
    }
}
