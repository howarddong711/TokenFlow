use reqwest::Client;
use serde::Serialize;

const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";

#[derive(Debug, Serialize)]
pub struct AnthropicStatusMetric {
    pub name: String,
    pub used: f64,
    pub total: f64,
    pub unlimited: bool,
    pub resets_at: Option<String>,
    pub unit: String,
}

#[derive(Debug, Serialize)]
pub struct AnthropicStatusResponse {
    pub plan: String,
    pub username: Option<String>,
    pub quotas: Vec<AnthropicStatusMetric>,
}

fn parse_u64_header(headers: &reqwest::header::HeaderMap, key: &str) -> Option<u64> {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .and_then(|text| text.parse::<u64>().ok())
}

fn parse_string_header(headers: &reqwest::header::HeaderMap, key: &str) -> Option<String> {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(|text| text.to_string())
}

#[tauri::command]
pub async fn get_anthropic_status(api_key: String) -> Result<AnthropicStatusResponse, String> {
    let client = Client::new();

    let response = client
        .post(ANTHROPIC_MESSAGES_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": "claude-3-5-haiku-latest",
            "max_tokens": 1,
            "messages": [{ "role": "user", "content": "ping" }]
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to call Anthropic API: {e}"))?;

    let headers = response.headers().clone();

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Anthropic API returned {status}: {body}"));
    }

    let requests_limit = parse_u64_header(&headers, "anthropic-ratelimit-requests-limit");
    let requests_remaining = parse_u64_header(&headers, "anthropic-ratelimit-requests-remaining");
    let requests_reset = parse_string_header(&headers, "anthropic-ratelimit-requests-reset");

    let input_limit = parse_u64_header(&headers, "anthropic-ratelimit-input-tokens-limit");
    let input_remaining = parse_u64_header(&headers, "anthropic-ratelimit-input-tokens-remaining");
    let input_reset = parse_string_header(&headers, "anthropic-ratelimit-input-tokens-reset");

    let output_limit = parse_u64_header(&headers, "anthropic-ratelimit-output-tokens-limit");
    let output_remaining =
        parse_u64_header(&headers, "anthropic-ratelimit-output-tokens-remaining");
    let output_reset = parse_string_header(&headers, "anthropic-ratelimit-output-tokens-reset");

    if requests_limit.is_none() && input_limit.is_none() && output_limit.is_none() {
        return Err(
            "Anthropic quota headers were not present. Make sure this key has access and try again."
                .to_string(),
        );
    }

    let mut quotas = Vec::new();

    if let Some(limit) = requests_limit {
        let remaining = requests_remaining.unwrap_or(limit);
        quotas.push(AnthropicStatusMetric {
            name: "Requests".to_string(),
            used: (limit.saturating_sub(remaining)) as f64,
            total: limit as f64,
            unlimited: false,
            resets_at: requests_reset,
            unit: "requests".to_string(),
        });
    }

    if let Some(limit) = input_limit {
        let remaining = input_remaining.unwrap_or(limit);
        quotas.push(AnthropicStatusMetric {
            name: "Input Tokens".to_string(),
            used: (limit.saturating_sub(remaining)) as f64,
            total: limit as f64,
            unlimited: false,
            resets_at: input_reset,
            unit: "tokens".to_string(),
        });
    }

    if let Some(limit) = output_limit {
        let remaining = output_remaining.unwrap_or(limit);
        quotas.push(AnthropicStatusMetric {
            name: "Output Tokens".to_string(),
            used: (limit.saturating_sub(remaining)) as f64,
            total: limit as f64,
            unlimited: false,
            resets_at: output_reset,
            unit: "tokens".to_string(),
        });
    }

    Ok(AnthropicStatusResponse {
        plan: "API Key".to_string(),
        username: Some("header-based quota".to_string()),
        quotas,
    })
}
