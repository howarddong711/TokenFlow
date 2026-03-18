use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::core::{FetchContext, ProviderId, ServiceAccountCredentials};
use crate::providers;

const GEMINI_MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

#[derive(Debug, Serialize)]
pub struct VertexStatusMetric {
    pub name: String,
    pub used: f64,
    pub total: f64,
    pub unlimited: bool,
    pub resets_at: Option<String>,
    pub unit: String,
}

#[derive(Debug, Serialize)]
pub struct VertexStatusResponse {
    pub plan: String,
    pub username: Option<String>,
    pub quotas: Vec<VertexStatusMetric>,
}

#[tauri::command]
pub async fn get_vertex_status(api_key: String) -> Result<VertexStatusResponse, String> {
    let client = Client::new();

    let response = client
        .get(GEMINI_MODELS_URL)
        .query(&[("key", api_key)])
        .send()
        .await
        .map_err(|e| format!("Failed to validate Vertex-compatible API key: {e}"))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Vertex/Gemini models endpoint returned {status}: {body}"
        ));
    }

    Ok(VertexStatusResponse {
        plan: "Vertex-compatible key".to_string(),
        username: Some("project scoped".to_string()),
        quotas: vec![
            VertexStatusMetric {
                name: "Quota Source".to_string(),
                used: 1.0,
                total: 0.0,
                unlimited: false,
                resets_at: None,
                unit: "cloud-console".to_string(),
            },
            VertexStatusMetric {
                name: "Daily Remaining API".to_string(),
                used: 0.0,
                total: 0.0,
                unlimited: false,
                resets_at: None,
                unit: "not-exposed".to_string(),
            },
        ],
    })
}

#[derive(Debug, Deserialize)]
pub struct ValidateVertexServiceAccountInput {
    pub credentials: ServiceAccountCredentials,
}

#[derive(Debug, Serialize)]
pub struct ValidateVertexServiceAccountResponse {
    pub project_id: String,
    pub client_email: String,
    pub plan: String,
}

#[tauri::command]
pub async fn validate_vertex_service_account(
    input: ValidateVertexServiceAccountInput,
) -> Result<ValidateVertexServiceAccountResponse, String> {
    let provider = providers::build_provider(ProviderId::VertexAI);
    let result = provider
        .fetch_usage(&FetchContext {
            service_account_credentials: Some(input.credentials.clone()),
            ..FetchContext::default()
        })
        .await
        .map_err(|err| err.to_string())?;

    Ok(ValidateVertexServiceAccountResponse {
        project_id: input.credentials.project_id,
        client_email: input.credentials.client_email,
        plan: result
            .usage
            .login_method
            .unwrap_or_else(|| "Vertex AI Project".to_string()),
    })
}
