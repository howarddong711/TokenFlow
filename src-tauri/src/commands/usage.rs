use serde_json::json;
use tauri::AppHandle;

use crate::browser::cookies::{self, get_all_cookie_headers_by_profile};
use crate::core::{AccountRepository, FetchContext, JsonlScanner, ProviderId};
use crate::providers;
use crate::tracking::{self, ProviderReportedSummary, RequestLogEntry, RequestTrackingStatus};

#[tauri::command]
pub async fn fetch_provider_usage(provider_id: String) -> Result<serde_json::Value, String> {
    let id = ProviderId::from_cli_name(&provider_id)
        .ok_or_else(|| format!("Unknown provider id: {}", provider_id))?;

    let provider = providers::build_provider(id);
    let result = provider
        .fetch_usage(&FetchContext::default())
        .await
        .map_err(|e| e.to_string())?;

    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_all_providers_usage() -> Result<serde_json::Value, String> {
    let mut out = Vec::new();

    // Providers that actually use browser cookies for authentication.
    // These are the only ones that benefit from multi-profile iteration.
    const COOKIE_AUTH_PROVIDERS: &[ProviderId] = &[
        ProviderId::Claude,
        ProviderId::Cursor,
        ProviderId::Factory,
        ProviderId::Kimi,
        ProviderId::Ollama,
    ];

    for id in ProviderId::all() {
        let provider = providers::build_provider(*id);
        let meta = provider.metadata();

        // Skip providers that are not default-enabled (e.g., Kiro)
        // to avoid launching unexpected GUI applications on startup.
        // Users can still fetch these individually via fetch_provider_usage.
        if !meta.default_enabled {
            out.push(json!({
                "provider": id.cli_name(),
                "ok": false,
                "error": "Provider is not enabled by default. Use manual refresh.",
            }));
            continue;
        }

        // For cookie-based auth providers, iterate over all browser profiles
        // to support multiple accounts logged in via different browsers/profiles.
        if COOKIE_AUTH_PROVIDERS.contains(id) {
            if let Some(domain) = id.cookie_domain() {
                let cookie_sets = get_all_cookie_headers_by_profile(domain);

                if cookie_sets.is_empty() {
                    // No cookies found in any browser — report as single entry
                    out.push(json!({
                        "provider": id.cli_name(),
                        "ok": false,
                        "error": "No cookies available for web API",
                    }));
                } else {
                    for cookie_set in &cookie_sets {
                        let ctx = FetchContext {
                            manual_cookie_header: Some(cookie_set.cookie_header.clone()),
                            ..FetchContext::default()
                        };

                        let fetch_result = tokio::time::timeout(
                            std::time::Duration::from_secs(30),
                            provider.fetch_usage(&ctx),
                        )
                        .await;

                        match fetch_result {
                            Ok(Ok(result)) => out.push(json!({
                                "provider": id.cli_name(),
                                "ok": true,
                                "result": result,
                                "browser_label": cookie_set.browser_label,
                            })),
                            Ok(Err(err)) => out.push(json!({
                                "provider": id.cli_name(),
                                "ok": false,
                                "error": err.to_string(),
                                "browser_label": cookie_set.browser_label,
                            })),
                            Err(_elapsed) => out.push(json!({
                                "provider": id.cli_name(),
                                "ok": false,
                                "error": "Timed out after 30 seconds",
                                "browser_label": cookie_set.browser_label,
                            })),
                        }
                    }
                }
                continue;
            }
        }

        // Non-cookie providers: single fetch with default context
        let fetch_result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            provider.fetch_usage(&FetchContext::default()),
        )
        .await;

        match fetch_result {
            Ok(Ok(result)) => out.push(json!({
                "provider": id.cli_name(),
                "ok": true,
                "result": result,
            })),
            Ok(Err(err)) => out.push(json!({
                "provider": id.cli_name(),
                "ok": false,
                "error": err.to_string(),
            })),
            Err(_elapsed) => out.push(json!({
                "provider": id.cli_name(),
                "ok": false,
                "error": "Timed out after 30 seconds",
            })),
        }
    }

    Ok(json!({ "providers": out }))
}

#[tauri::command]
pub async fn get_local_cost_summary() -> Result<serde_json::Value, String> {
    let codex_root = JsonlScanner::default_codex_sessions_root();
    let claude_roots = JsonlScanner::default_claude_projects_roots();

    let codex_cache = JsonlScanner::load_cache(ProviderId::Codex, None);
    let claude_cache = JsonlScanner::load_cache(ProviderId::Claude, None);

    Ok(json!({
        "paths": {
            "codex_sessions_root": codex_root,
            "claude_projects_roots": claude_roots,
        },
        "cache": {
            "codex": codex_cache,
            "claude": claude_cache,
        }
    }))
}

#[tauri::command]
pub async fn extract_browser_cookie(domain: String) -> Result<String, String> {
    cookies::get_cookie_header(&domain).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_request_logs(
    _app: AppHandle,
    days: Option<u32>,
) -> Result<Vec<RequestLogEntry>, String> {
    tracking::collect_request_logs(days.unwrap_or(30))
}

#[tauri::command]
pub async fn get_request_tracking_status(app: AppHandle) -> Result<RequestTrackingStatus, String> {
    let repo = AccountRepository::new(app);
    let accounts = repo.list().map_err(|err| err.to_string())?;
    Ok(tracking::build_tracking_status(&accounts))
}

#[tauri::command]
pub async fn get_provider_reported_summary(
    app: AppHandle,
) -> Result<ProviderReportedSummary, String> {
    let repo = AccountRepository::new(app);
    let accounts = repo.list().map_err(|err| err.to_string())?;
    Ok(tracking::collect_provider_reported_summary(&repo, &accounts).await)
}
