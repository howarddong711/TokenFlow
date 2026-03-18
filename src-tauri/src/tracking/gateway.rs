use super::types::RequestTrackingSource;

pub fn collect_tracking_sources() -> Vec<RequestTrackingSource> {
    vec![RequestTrackingSource {
        source_type: "gateway_observed".to_string(),
        label: "Observed traffic".to_string(),
        provider_ids: Vec::new(),
        coverage: "none".to_string(),
        status: "unavailable".to_string(),
        detail: "Gateway-based traffic observation is not connected yet. This will become the highest-confidence source once a local tracking gateway is enabled.".to_string(),
    }]
}
