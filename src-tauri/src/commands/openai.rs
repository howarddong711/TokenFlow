use reqwest::Client;
use serde::{Deserialize, Serialize};

const OPENAI_COSTS_URL: &str = "https://api.openai.com/v1/organization/costs";
const OPENAI_USAGE_URL: &str = "https://api.openai.com/v1/organization/usage/completions";
const SECONDS_IN_DAY: i64 = 86_400;
const WINDOW_DAYS: i64 = 30;

#[derive(Debug, Deserialize)]
struct OpenAICostsResponse {
    data: Vec<OpenAICostBucket>,
}

#[derive(Debug, Deserialize)]
struct OpenAICostBucket {
    start_time: i64,
    results: Vec<OpenAICostResult>,
}

#[derive(Debug, Deserialize)]
struct OpenAICostResult {
    amount: OpenAIAmount,
}

#[derive(Debug, Deserialize)]
struct OpenAIAmount {
    value: f64,
    currency: String,
}

#[derive(Debug, Deserialize)]
struct OpenAIUsageResponse {
    data: Vec<OpenAIUsageBucket>,
}

#[derive(Debug, Deserialize)]
struct OpenAIUsageBucket {
    results: Vec<OpenAIUsageResult>,
}

#[derive(Debug, Deserialize)]
struct OpenAIUsageResult {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    input_cached_tokens: Option<u64>,
    num_model_requests: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct OpenAIStatusMetric {
    pub name: String,
    pub used: f64,
    pub total: f64,
    pub unlimited: bool,
    pub resets_at: Option<String>,
    pub unit: String,
}

#[derive(Debug, Serialize)]
pub struct OpenAIStatusResponse {
    pub plan: String,
    pub username: Option<String>,
    pub quotas: Vec<OpenAIStatusMetric>,
}

#[tauri::command]
pub async fn get_openai_status(api_key: String) -> Result<OpenAIStatusResponse, String> {
    let client = Client::new();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Failed to determine current time: {e}"))?
        .as_secs() as i64;
    let start_time = now - (WINDOW_DAYS * SECONDS_IN_DAY);

    let costs_res = client
        .get(OPENAI_COSTS_URL)
        .query(&[
            ("start_time", start_time.to_string()),
            ("bucket_width", "1d".to_string()),
            ("limit", WINDOW_DAYS.to_string()),
        ])
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch OpenAI costs: {e}"))?;

    if !costs_res.status().is_success() {
        let status = costs_res.status().as_u16();
        let body = costs_res.text().await.unwrap_or_default();
        return Err(format!("OpenAI costs endpoint returned {status}: {body}"));
    }

    let usage_res = client
        .get(OPENAI_USAGE_URL)
        .query(&[
            ("start_time", start_time.to_string()),
            ("bucket_width", "1d".to_string()),
            ("limit", WINDOW_DAYS.to_string()),
        ])
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch OpenAI usage: {e}"))?;

    if !usage_res.status().is_success() {
        let status = usage_res.status().as_u16();
        let body = usage_res.text().await.unwrap_or_default();
        return Err(format!("OpenAI usage endpoint returned {status}: {body}"));
    }

    let costs = costs_res
        .json::<OpenAICostsResponse>()
        .await
        .map_err(|e| format!("Failed to parse OpenAI costs response: {e}"))?;
    let usage = usage_res
        .json::<OpenAIUsageResponse>()
        .await
        .map_err(|e| format!("Failed to parse OpenAI usage response: {e}"))?;

    let total_spend = costs
        .data
        .iter()
        .flat_map(|bucket| bucket.results.iter())
        .map(|result| result.amount.value)
        .sum::<f64>();
    let latest_currency = costs
        .data
        .iter()
        .flat_map(|bucket| bucket.results.iter())
        .next()
        .map(|result| result.amount.currency.to_uppercase())
        .unwrap_or_else(|| "USD".to_string());
    let latest_cost_day = costs
        .data
        .iter()
        .map(|bucket| bucket.start_time)
        .max()
        .map(|ts| format!("{}", ts));

    let total_input_tokens = usage
        .data
        .iter()
        .flat_map(|bucket| bucket.results.iter())
        .map(|result| result.input_tokens.unwrap_or(0) as f64)
        .sum::<f64>();
    let total_output_tokens = usage
        .data
        .iter()
        .flat_map(|bucket| bucket.results.iter())
        .map(|result| result.output_tokens.unwrap_or(0) as f64)
        .sum::<f64>();
    let total_cached_tokens = usage
        .data
        .iter()
        .flat_map(|bucket| bucket.results.iter())
        .map(|result| result.input_cached_tokens.unwrap_or(0) as f64)
        .sum::<f64>();
    let total_requests = usage
        .data
        .iter()
        .flat_map(|bucket| bucket.results.iter())
        .map(|result| result.num_model_requests.unwrap_or(0) as f64)
        .sum::<f64>();

    Ok(OpenAIStatusResponse {
        plan: "Admin API".to_string(),
        username: Some("organization admin key".to_string()),
        quotas: vec![
            OpenAIStatusMetric {
                name: format!("{} Day Spend", WINDOW_DAYS),
                used: total_spend,
                total: 0.0,
                unlimited: false,
                resets_at: latest_cost_day.clone(),
                unit: latest_currency,
            },
            OpenAIStatusMetric {
                name: format!("{} Day Requests", WINDOW_DAYS),
                used: total_requests,
                total: 0.0,
                unlimited: false,
                resets_at: latest_cost_day.clone(),
                unit: "requests".to_string(),
            },
            OpenAIStatusMetric {
                name: format!("{} Day Input Tokens", WINDOW_DAYS),
                used: total_input_tokens,
                total: 0.0,
                unlimited: false,
                resets_at: latest_cost_day.clone(),
                unit: "tokens".to_string(),
            },
            OpenAIStatusMetric {
                name: format!("{} Day Output Tokens", WINDOW_DAYS),
                used: total_output_tokens,
                total: 0.0,
                unlimited: false,
                resets_at: latest_cost_day.clone(),
                unit: "tokens".to_string(),
            },
            OpenAIStatusMetric {
                name: format!("{} Day Cached Tokens", WINDOW_DAYS),
                used: total_cached_tokens,
                total: 0.0,
                unlimited: false,
                resets_at: latest_cost_day,
                unit: "tokens".to_string(),
            },
        ],
    })
}
