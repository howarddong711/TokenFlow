use std::collections::{BTreeMap, BTreeSet};

use reqwest::{header, Client};
use serde::{Deserialize, Serialize};
use tauri::Runtime;

use crate::commands::copilot::get_copilot_status;
use crate::core::{AccountAuthKind, AccountRecord, AccountRepository, AccountSecret, ProviderId};
use crate::providers::cursor::CursorApi;

use super::types::RequestTrackingSource;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderReportedMetric {
    pub id: String,
    pub label: String,
    pub value: f64,
    pub limit: Option<f64>,
    pub unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderReportedProviderSummary {
    pub provider_id: String,
    pub total_requests: i64,
    pub total_tokens: i64,
    pub metrics: Vec<ProviderReportedMetric>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderReportedSummary {
    pub total_requests: i64,
    pub total_tokens: i64,
    pub provider_ids: Vec<String>,
    pub by_provider: Vec<ProviderReportedProviderSummary>,
    pub coverage: String,
}

#[derive(Debug, Default)]
struct ProviderAccumulator {
    provider_id: String,
    total_requests: i64,
    total_tokens: i64,
    metrics: BTreeMap<String, ProviderReportedMetric>,
}

#[derive(Debug, Default)]
struct AccountReportedSummary {
    total_requests: i64,
    total_tokens: i64,
    metrics: Vec<ProviderReportedMetric>,
}

pub async fn collect_provider_reported_summary<R: Runtime>(
    repo: &AccountRepository<R>,
    accounts: &[AccountRecord],
) -> ProviderReportedSummary {
    let mut provider_ids = BTreeSet::new();
    let mut by_provider: BTreeMap<String, ProviderAccumulator> = BTreeMap::new();

    for account in accounts {
        let Ok(Some(secret)) = repo.load_secret(account) else {
            continue;
        };

        let Some(result) = fetch_account_summary(account, &secret).await else {
            continue;
        };

        let provider_id = account.provider_id.cli_name().to_string();
        provider_ids.insert(provider_id.clone());

        let entry = by_provider
            .entry(provider_id.clone())
            .or_insert_with(|| ProviderAccumulator {
                provider_id,
                ..ProviderAccumulator::default()
            });

        entry.total_requests += result.total_requests;
        entry.total_tokens += result.total_tokens;

        for metric in result.metrics {
            let key = metric.id.clone();
            let current = entry.metrics.entry(key).or_insert_with(|| ProviderReportedMetric {
                id: metric.id.clone(),
                label: metric.label.clone(),
                value: 0.0,
                limit: None,
                unit: metric.unit.clone(),
            });
            current.value += metric.value;
            current.limit = match (current.limit, metric.limit) {
                (Some(left), Some(right)) => Some(left + right),
                (None, Some(right)) => Some(right),
                (left, None) => left,
            };
        }
    }

    let by_provider: Vec<ProviderReportedProviderSummary> = by_provider
        .into_values()
        .map(|entry| ProviderReportedProviderSummary {
            provider_id: entry.provider_id,
            total_requests: entry.total_requests,
            total_tokens: entry.total_tokens,
            metrics: entry.metrics.into_values().collect(),
        })
        .collect();
    let total_requests = by_provider.iter().map(|item| item.total_requests).sum();
    let total_tokens = by_provider.iter().map(|item| item.total_tokens).sum();
    let provider_ids: Vec<String> = provider_ids.into_iter().collect();
    let coverage = if !by_provider.is_empty() {
        "partial".to_string()
    } else {
        "none".to_string()
    };

    ProviderReportedSummary {
        total_requests,
        total_tokens,
        provider_ids,
        by_provider,
        coverage,
    }
}

pub fn collect_tracking_sources(accounts: &[AccountRecord]) -> Vec<RequestTrackingSource> {
    let mut provider_ids = BTreeSet::new();

    for account in accounts {
        if supports_provider_reported_summary(account.provider_id, &account.auth_kind) {
            provider_ids.insert(account.provider_id.cli_name().to_string());
        }
    }

    let provider_ids: Vec<String> = provider_ids.into_iter().collect();
    let ready = !provider_ids.is_empty();
    let detail = if ready {
        format!(
            "Official request, token, or spend totals are available for the connected provider set: {}.",
            provider_ids.join(", ")
        )
    } else {
        "Official request, token, or spend totals are not connected yet. This source becomes available only for providers with absolute analytics endpoints.".to_string()
    };

    vec![RequestTrackingSource {
        source_type: "provider_reported_summary".to_string(),
        label: "Official request totals".to_string(),
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

async fn fetch_account_summary(
    account: &AccountRecord,
    secret: &AccountSecret,
) -> Option<AccountReportedSummary> {
    match account.provider_id {
        ProviderId::Copilot => {
            let token = oauth_access_token(secret)?;
            fetch_copilot_summary(token).await.ok()
        }
        ProviderId::Amp => {
            let api_key = api_key_value(secret)?;
            fetch_amp_summary(api_key).await.ok()
        }
        ProviderId::Warp => {
            let api_key = api_key_value(secret)?;
            fetch_warp_summary(api_key).await.ok()
        }
        ProviderId::Zai => {
            let api_key = api_key_value(secret)?;
            fetch_zai_summary(api_key).await.ok()
        }
        ProviderId::Augment => {
            let api_key = api_key_value(secret)?;
            fetch_augment_summary(api_key).await.ok()
        }
        ProviderId::OpenRouter => {
            let api_key = api_key_value(secret)?;
            fetch_openrouter_summary(api_key).await.ok()
        }
        ProviderId::KimiK2 => {
            let api_key = api_key_value(secret)?;
            fetch_kimik2_summary(api_key).await.ok()
        }
        ProviderId::Cursor => {
            let cookie_header = cookie_header_value(secret)?;
            fetch_cursor_summary(cookie_header).await.ok()
        }
        ProviderId::Claude => match secret {
            AccountSecret::OAuth { credentials } | AccountSecret::ImportedCliOAuth { credentials } => {
                fetch_claude_oauth_summary(credentials.access_token.clone()).await.ok()
            }
            AccountSecret::ManualCookie { cookie_header }
            | AccountSecret::BrowserProfileCookie { cookie_header, .. } => {
                fetch_claude_cookie_summary(cookie_header.clone()).await.ok()
            }
            _ => None,
        },
        _ => None,
    }
}

fn oauth_access_token(secret: &AccountSecret) -> Option<String> {
    match secret {
        AccountSecret::OAuth { credentials }
        | AccountSecret::ImportedCliOAuth { credentials } => Some(credentials.access_token.clone()),
        _ => None,
    }
}

fn api_key_value(secret: &AccountSecret) -> Option<String> {
    match secret {
        AccountSecret::ApiKey { value } => Some(value.clone()),
        _ => None,
    }
}

fn cookie_header_value(secret: &AccountSecret) -> Option<String> {
    match secret {
        AccountSecret::ManualCookie { cookie_header }
        | AccountSecret::BrowserProfileCookie { cookie_header, .. } => Some(cookie_header.clone()),
        _ => None,
    }
}

fn supports_provider_reported_summary(provider_id: ProviderId, auth_kind: &AccountAuthKind) -> bool {
    match provider_id {
        ProviderId::Copilot => matches!(auth_kind, AccountAuthKind::OAuthToken),
        ProviderId::Amp
        | ProviderId::Warp
        | ProviderId::Zai
        | ProviderId::Augment
        | ProviderId::OpenRouter
        | ProviderId::KimiK2 => matches!(auth_kind, AccountAuthKind::ApiKey),
        ProviderId::Cursor => matches!(
            auth_kind,
            AccountAuthKind::ManualCookie | AccountAuthKind::BrowserProfileCookie
        ),
        ProviderId::Claude => matches!(
            auth_kind,
            AccountAuthKind::OAuthToken
                | AccountAuthKind::ImportedCliOAuth
                | AccountAuthKind::ManualCookie
                | AccountAuthKind::BrowserProfileCookie
        ),
        _ => false,
    }
}

fn metric(id: &str, label: &str, value: f64, limit: Option<f64>, unit: &str) -> ProviderReportedMetric {
    ProviderReportedMetric {
        id: id.to_string(),
        label: label.to_string(),
        value,
        limit,
        unit: unit.to_string(),
    }
}

async fn fetch_copilot_summary(access_token: String) -> Result<AccountReportedSummary, String> {
    let status = get_copilot_status(access_token).await?;
    let total_requests = status
        .quotas
        .iter()
        .filter(|quota| quota.unit == "requests")
        .map(|quota| quota.used.round() as i64)
        .sum();
    Ok(AccountReportedSummary {
        total_requests,
        ..AccountReportedSummary::default()
    })
}

async fn fetch_warp_summary(api_key: String) -> Result<AccountReportedSummary, String> {
    #[derive(Debug, Deserialize)]
    struct GraphQLResponse {
        data: Option<GraphQLData>,
    }

    #[derive(Debug, Deserialize)]
    struct GraphQLData {
        user: Option<UserWrapper>,
    }

    #[derive(Debug, Deserialize)]
    struct UserWrapper {
        user: Option<UserData>,
    }

    #[derive(Debug, Deserialize)]
    struct UserData {
        #[serde(rename = "requestLimitInfo")]
        request_limit_info: Option<RequestLimitInfo>,
        #[serde(rename = "bonusGrants")]
        bonus_grants: Option<Vec<BonusGrant>>,
        workspaces: Option<Vec<Workspace>>,
    }

    #[derive(Debug, Deserialize)]
    struct RequestLimitInfo {
        #[serde(rename = "requestsUsedSinceLastRefresh")]
        requests_used: Option<i64>,
    }

    #[derive(Debug, Deserialize)]
    struct BonusGrant {
        #[serde(rename = "requestCreditsGranted")]
        request_credits_granted: Option<i64>,
        #[serde(rename = "requestCreditsRemaining")]
        request_credits_remaining: Option<i64>,
    }

    #[derive(Debug, Deserialize)]
    struct Workspace {
        #[serde(rename = "bonusGrantsInfo")]
        bonus_grants_info: Option<BonusGrantsInfo>,
    }

    #[derive(Debug, Deserialize)]
    struct BonusGrantsInfo {
        grants: Option<Vec<BonusGrant>>,
    }

    const WARP_API_URL: &str = "https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo";
    const GRAPHQL_QUERY: &str = r#"query GetRequestLimitInfo($requestContext: RequestContext!) {
  user(requestContext: $requestContext) {
    ... on UserOutput {
      user {
        requestLimitInfo {
          requestsUsedSinceLastRefresh
        }
        bonusGrants {
          requestCreditsGranted
          requestCreditsRemaining
        }
        workspaces {
          bonusGrantsInfo {
            grants {
              requestCreditsGranted
              requestCreditsRemaining
            }
          }
        }
      }
    }
  }
}"#;

    let body = serde_json::json!({
        "query": GRAPHQL_QUERY,
        "variables": {
            "requestContext": {
                "clientContext": {},
                "osContext": {
                    "category": "Windows",
                    "name": "Windows",
                    "version": "10.0"
                }
            }
        },
        "operationName": "GetRequestLimitInfo"
    });

    let client = build_client(15)?;
    let response = client
        .post(WARP_API_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("x-warp-client-id", "warp-app")
        .header("x-warp-os-category", "Windows")
        .header("x-warp-os-name", "Windows")
        .header("x-warp-os-version", "10.0")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("User-Agent", "Warp/1.0")
        .json(&body)
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Warp summary endpoint returned {}", response.status()));
    }

    let payload = response
        .json::<GraphQLResponse>()
        .await
        .map_err(|err| err.to_string())?;

    let user = payload
        .data
        .and_then(|data| data.user)
        .and_then(|wrapper| wrapper.user)
        .ok_or_else(|| "Warp summary missing user payload".to_string())?;

    let primary_requests = user
        .request_limit_info
        .and_then(|info| info.requests_used)
        .unwrap_or(0);

    let direct_bonus_used: i64 = user
        .bonus_grants
        .unwrap_or_default()
        .into_iter()
        .map(|grant| {
            grant.request_credits_granted.unwrap_or(0)
                - grant.request_credits_remaining.unwrap_or(0)
        })
        .sum();

    let workspace_bonus_used: i64 = user
        .workspaces
        .unwrap_or_default()
        .into_iter()
        .flat_map(|workspace| workspace.bonus_grants_info.and_then(|info| info.grants).unwrap_or_default())
        .map(|grant| {
            grant.request_credits_granted.unwrap_or(0)
                - grant.request_credits_remaining.unwrap_or(0)
        })
        .sum();

    Ok(AccountReportedSummary {
        total_requests: primary_requests + direct_bonus_used + workspace_bonus_used,
        ..AccountReportedSummary::default()
    })
}

async fn fetch_amp_summary(api_key: String) -> Result<AccountReportedSummary, String> {
    #[derive(Debug, Deserialize)]
    struct AmpUsageResponse {
        #[serde(rename = "completionsUsed")]
        completions_used: Option<f64>,
    }

    let client = build_client(15)?;
    let response = client
        .get("https://sourcegraph.com/.api/cody/current-user/usage")
        .header("Authorization", format!("token {}", api_key))
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Amp summary endpoint returned {}", response.status()));
    }

    let payload = response
        .json::<AmpUsageResponse>()
        .await
        .map_err(|err| err.to_string())?;

    Ok(AccountReportedSummary {
        total_requests: payload.completions_used.unwrap_or(0.0).round() as i64,
        ..AccountReportedSummary::default()
    })
}

async fn fetch_zai_summary(api_key: String) -> Result<AccountReportedSummary, String> {
    #[derive(Debug, Deserialize)]
    struct ZaiQuotaResponse {
        #[serde(default)]
        limits: Vec<ZaiLimit>,
    }

    #[derive(Debug, Deserialize)]
    struct ZaiLimit {
        #[serde(rename = "type")]
        limit_type: Option<String>,
        used: Option<f64>,
    }

    const ZAI_API_URL: &str = "https://api.z.ai/api/monitor/usage/quota/limit";

    let client = build_client(15)?;
    let response = client
        .get(ZAI_API_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!("z.ai summary endpoint returned {}", response.status()));
    }

    let payload = response
        .json::<ZaiQuotaResponse>()
        .await
        .map_err(|err| err.to_string())?;

    let total_tokens = payload
        .limits
        .into_iter()
        .find(|limit| limit.limit_type.as_deref() == Some("tokens"))
        .and_then(|limit| limit.used)
        .unwrap_or(0.0)
        .round() as i64;

    Ok(AccountReportedSummary {
        total_tokens,
        ..AccountReportedSummary::default()
    })
}

async fn fetch_augment_summary(api_key: String) -> Result<AccountReportedSummary, String> {
    let client = build_client(15)?;
    let response = client
        .get("https://api.augmentcode.com/v1/user/usage")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Augment summary endpoint returned {}", response.status()));
    }

    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|err| err.to_string())?;

    let used = payload
        .get("used_credits")
        .or_else(|| payload.get("usage"))
        .and_then(|value| value.as_f64())
        .unwrap_or(0.0);
    let limit = payload
        .get("credit_limit")
        .or_else(|| payload.get("limit"))
        .and_then(|value| value.as_f64());

    Ok(AccountReportedSummary {
        metrics: vec![metric("credits_used", "Credits used", used, limit, "credits")],
        ..AccountReportedSummary::default()
    })
}

async fn fetch_openrouter_summary(api_key: String) -> Result<AccountReportedSummary, String> {
    #[derive(Debug, Deserialize)]
    struct CreditsResponse {
        data: CreditsData,
    }

    #[derive(Debug, Deserialize)]
    struct CreditsData {
        total_credits: f64,
        total_usage: f64,
    }

    let client = build_client(15)?;
    let response = client
        .get("https://openrouter.ai/api/v1/auth/credits")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "OpenRouter summary endpoint returned {}",
            response.status()
        ));
    }

    let payload = response
        .json::<CreditsResponse>()
        .await
        .map_err(|err| err.to_string())?;

    Ok(AccountReportedSummary {
        metrics: vec![metric(
            "spend_used",
            "Spend",
            payload.data.total_usage,
            Some(payload.data.total_credits),
            "USD",
        )],
        ..AccountReportedSummary::default()
    })
}

async fn fetch_kimik2_summary(api_key: String) -> Result<AccountReportedSummary, String> {
    let client = build_client(15)?;
    let response = client
        .get("https://api.moonshot.cn/v1/users/me/balance")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Kimi K2 summary endpoint returned {}", response.status()));
    }

    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|err| err.to_string())?;

    let data = payload.get("data").unwrap_or(&payload);
    let available_balance = data
        .get("available_balance")
        .or_else(|| data.get("balance"))
        .and_then(|value| value.as_f64())
        .unwrap_or(0.0);
    let total_balance = data
        .get("total_balance")
        .or_else(|| data.get("total"))
        .and_then(|value| value.as_f64())
        .unwrap_or(0.0);
    let used_balance = data
        .get("used_balance")
        .or_else(|| data.get("used"))
        .and_then(|value| value.as_f64())
        .unwrap_or((total_balance - available_balance).max(0.0));

    Ok(AccountReportedSummary {
        metrics: vec![metric(
            "credits_used",
            "Credits used",
            used_balance,
            if total_balance > 0.0 { Some(total_balance) } else { None },
            "credits",
        )],
        ..AccountReportedSummary::default()
    })
}

async fn fetch_cursor_summary(cookie_header: String) -> Result<AccountReportedSummary, String> {
    let api = CursorApi::new();
    let (_, cost, _, _) = api
        .fetch_usage_with_cookie(Some(cookie_header.as_str()))
        .await
        .map_err(|err| err.to_string())?;

    let Some(cost) = cost else {
        return Err("Cursor cost snapshot unavailable".to_string());
    };

    Ok(AccountReportedSummary {
        metrics: vec![metric(
            "spend_used",
            "Spend",
            cost.used,
            cost.limit,
            &cost.currency_code,
        )],
        ..AccountReportedSummary::default()
    })
}

async fn fetch_claude_oauth_summary(access_token: String) -> Result<AccountReportedSummary, String> {
    #[derive(Debug, Deserialize)]
    struct ClaudeUsageResponse {
        #[serde(rename = "extraUsage")]
        extra_usage: Option<ClaudeExtraUsage>,
    }

    #[derive(Debug, Deserialize)]
    struct ClaudeExtraUsage {
        #[serde(rename = "usedCredits")]
        used_credits: Option<f64>,
        #[serde(rename = "monthlyLimit")]
        monthly_limit: Option<f64>,
        currency: Option<String>,
        #[serde(rename = "isEnabled")]
        is_enabled: Option<bool>,
    }

    let client = build_client(15)?;
    let response = client
        .get("https://api.claude.ai/api/usage")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Claude OAuth summary endpoint returned {}", response.status()));
    }

    let payload = response
        .json::<ClaudeUsageResponse>()
        .await
        .map_err(|err| err.to_string())?;

    let extra = payload
        .extra_usage
        .filter(|extra| extra.is_enabled.unwrap_or(false))
        .ok_or_else(|| "Claude extra usage is unavailable".to_string())?;

    Ok(AccountReportedSummary {
        metrics: vec![metric(
            "credits_used",
            "Credits used",
            extra.used_credits.unwrap_or(0.0) / 100.0,
            extra.monthly_limit.map(|value| value / 100.0),
            extra.currency.as_deref().unwrap_or("USD"),
        )],
        ..AccountReportedSummary::default()
    })
}

async fn fetch_claude_cookie_summary(cookie_header: String) -> Result<AccountReportedSummary, String> {
    #[derive(Debug, Deserialize)]
    struct Organization {
        uuid: String,
    }

    #[derive(Debug, Deserialize)]
    struct ExtraUsageResponse {
        #[serde(rename = "monthly_credit_limit")]
        monthly_credit_limit: Option<f64>,
        #[serde(rename = "used_credits")]
        used_credits: Option<f64>,
        currency: Option<String>,
        #[serde(rename = "is_enabled")]
        is_enabled: Option<bool>,
    }

    let client = build_client(15)?;
    let organizations = client
        .get("https://claude.ai/api/organizations")
        .header(header::COOKIE, cookie_header.clone())
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !organizations.status().is_success() {
        return Err(format!(
            "Claude organization endpoint returned {}",
            organizations.status()
        ));
    }

    let orgs = organizations
        .json::<Vec<Organization>>()
        .await
        .map_err(|err| err.to_string())?;
    let org_id = orgs
        .into_iter()
        .next()
        .map(|org| org.uuid)
        .ok_or_else(|| "Claude organization is unavailable".to_string())?;

    let extra_usage = client
        .get(format!(
            "https://claude.ai/api/organizations/{}/overage_spend_limit",
            org_id
        ))
        .header(header::COOKIE, cookie_header)
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !extra_usage.status().is_success() {
        return Err(format!(
            "Claude extra usage endpoint returned {}",
            extra_usage.status()
        ));
    }

    let payload = extra_usage
        .json::<ExtraUsageResponse>()
        .await
        .map_err(|err| err.to_string())?;

    if !payload.is_enabled.unwrap_or(false) {
        return Err("Claude extra usage is unavailable".to_string());
    }

    Ok(AccountReportedSummary {
        metrics: vec![metric(
            "credits_used",
            "Credits used",
            payload.used_credits.unwrap_or(0.0) / 100.0,
            payload.monthly_credit_limit.map(|value| value / 100.0),
            payload.currency.as_deref().unwrap_or("USD"),
        )],
        ..AccountReportedSummary::default()
    })
}

fn build_client(timeout_seconds: u64) -> Result<Client, String> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_seconds))
        .build()
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_key_extraction_only_accepts_api_keys() {
        assert_eq!(
            api_key_value(&AccountSecret::ApiKey {
                value: "test".to_string(),
            }),
            Some("test".to_string())
        );
        assert_eq!(
            api_key_value(&AccountSecret::ManualCookie {
                cookie_header: "x".to_string()
            }),
            None
        );
    }

    #[test]
    fn cookie_extraction_accepts_manual_and_browser_cookie_secrets() {
        assert_eq!(
            cookie_header_value(&AccountSecret::ManualCookie {
                cookie_header: "a=b".to_string()
            }),
            Some("a=b".to_string())
        );
        assert_eq!(
            cookie_header_value(&AccountSecret::BrowserProfileCookie {
                browser_label: "Chrome".to_string(),
                cookie_header: "a=b".to_string(),
            }),
            Some("a=b".to_string())
        );
    }
}
