use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLogEntry {
    pub id: String,
    pub timestamp: String,
    pub provider_id: String,
    pub model: String,
    pub status: u16,
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub duration_ms: i64,
    pub source_label: Option<String>,
    pub source_type: String,
    pub coverage: String,
    pub confidence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestTrackingSource {
    pub source_type: String,
    pub label: String,
    pub provider_ids: Vec<String>,
    pub coverage: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestTrackingStatus {
    pub primary_source_type: Option<String>,
    pub primary_source_label: Option<String>,
    pub overall_coverage: String,
    pub overall_status: String,
    pub sources: Vec<RequestTrackingSource>,
}
