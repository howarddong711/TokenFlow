use reqwest::Client;
use serde::Serialize;

const KIMI_MODELS_URL: &str = "https://api.moonshot.cn/v1/models";

#[derive(Debug, Serialize)]
pub struct KimiStatusMetric {
    pub name: String,
    pub used: f64,
    pub total: f64,
    pub unlimited: bool,
    pub resets_at: Option<String>,
    pub unit: String,
}

#[derive(Debug, Serialize)]
pub struct KimiStatusResponse {
    pub plan: String,
    pub username: Option<String>,
    pub quotas: Vec<KimiStatusMetric>,
}

#[tauri::command]
pub async fn get_kimi_status(api_key: String) -> Result<KimiStatusResponse, String> {
    let client = Client::new();

    let response = client
        .get(KIMI_MODELS_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| format!("Failed to validate Kimi API key: {e}"))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Kimi models endpoint returned {status}: {body}"));
    }

    Ok(KimiStatusResponse {
        plan: "API Key".to_string(),
        username: Some("moonshot".to_string()),
        quotas: vec![KimiStatusMetric {
            name: "API Key Validation".to_string(),
            used: 1.0,
            total: 0.0,
            unlimited: false,
            resets_at: None,
            unit: "ok".to_string(),
        }],
    })
}
