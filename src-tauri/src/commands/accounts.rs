use std::time::Duration;

use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use uuid::Uuid;

use crate::browser::cookies::get_all_cookie_headers_by_profile;
use crate::core::{
    append_debug_log, AccountAuthKind, AccountDisplay, AccountRecord, AccountRepository,
    AccountSecret, AccountSecretRef, AccountUsageResult, FetchContext, OAuthCredentials,
    ProviderError, ProviderId,
};
use crate::providers;

const CURSOR_COOKIE_DOMAINS: [&str; 2] = ["cursor.com", "cursor.sh"];

#[derive(Debug, Deserialize)]
pub struct AddAccountInput {
    pub provider_id: String,
    pub label: Option<String>,
    pub auth_kind: AccountAuthKind,
    pub secret: Option<AccountSecret>,
    #[serde(default)]
    pub display: AccountDisplay,
    #[serde(default)]
    pub default: bool,
}

#[derive(Debug, Serialize)]
pub struct ProviderCapabilityDto {
    pub provider: String,
    pub auth_kinds: Vec<AccountAuthKind>,
    pub prefers_native_oauth: bool,
    pub system_managed_only: bool,
}

#[tauri::command]
pub async fn list_accounts(app: AppHandle) -> Result<Vec<AccountRecord>, String> {
    let repo = AccountRepository::new(app);
    let mut accounts = repo.list().map_err(|err| err.to_string())?;
    accounts.sort_by(|left, right| {
        left.provider_id
            .cli_name()
            .cmp(right.provider_id.cli_name())
            .then_with(|| right.default.cmp(&left.default))
            .then_with(|| left.label.cmp(&right.label))
    });
    Ok(accounts)
}

#[tauri::command]
pub async fn list_provider_capabilities() -> Result<Vec<ProviderCapabilityDto>, String> {
    Ok(ProviderId::all()
        .iter()
        .map(|provider_id| ProviderCapabilityDto {
            provider: provider_id.cli_name().to_string(),
            auth_kinds: provider_id.supported_account_auth_kinds().to_vec(),
            prefers_native_oauth: provider_id.prefers_native_oauth(),
            system_managed_only: provider_id.is_system_managed_only(),
        })
        .collect())
}

#[tauri::command]
pub async fn add_account(app: AppHandle, input: AddAccountInput) -> Result<AccountRecord, String> {
    append_debug_log(
        &app,
        "accounts.add_account",
        format!(
            "Incoming add_account provider={} auth_kind={:?} has_secret={} default={}",
            input.provider_id,
            input.auth_kind,
            input.secret.is_some(),
            input.default
        ),
    );
    let provider_id = parse_provider_id(&input.provider_id)?;
    validate_add_account_input(provider_id, &input)?;

    let repo = AccountRepository::new(app.clone());
    let existing_accounts = repo.list().map_err(|err| err.to_string())?;
    let label = build_account_label(provider_id, &input.label, &input.display);
    let has_secret = input.secret.is_some();

    if let Some(existing) = find_existing_email_account(provider_id, &input.display, &existing_accounts) {
        append_debug_log(
            &app,
            "accounts.add_account",
            format!(
                "Updating existing account id={} provider={} matched by email",
                existing.id,
                existing.provider_id.cli_name()
            ),
        );

        let mut updated = existing.clone();
        updated.label = label;
        updated.auth_kind = input.auth_kind.clone();
        updated.display = merge_account_display(&existing.display, &input.display);
        updated.system_managed = provider_id.is_system_managed_only();
        if has_secret && updated.secret_ref.is_none() {
            updated.secret_ref = Some(AccountSecretRef::for_account(updated.provider_id, updated.id));
        }
        if input.default {
            updated.default = true;
        }
        updated.touch();

        let updated = repo
            .save(&updated, input.secret.as_ref())
            .map_err(|err| err.to_string())?;

        if updated.default {
            let normalized = repo
                .set_default(updated.id)
                .map_err(|err| err.to_string())?;
            return normalized
                .into_iter()
                .find(|candidate| candidate.id == updated.id)
                .ok_or_else(|| "Failed to locate updated default account".to_string());
        }

        return Ok(updated);
    }

    let mut account = AccountRecord::new(
        provider_id,
        label,
        input.auth_kind,
        input.display,
        provider_id.is_system_managed_only(),
        has_secret,
    );

    if existing_accounts
        .iter()
        .all(|existing| existing.provider_id != provider_id)
        || input.default
    {
        account.default = true;
    }

    let account = repo
        .save(&account, input.secret.as_ref())
        .map_err(|err| err.to_string())?;
    append_debug_log(
        &app,
        "accounts.add_account",
        format!(
            "Account persisted id={} provider={} default={} secret_ref={}",
            account.id,
            account.provider_id.cli_name(),
            account.default,
            account.secret_ref.is_some()
        ),
    );

    if account.default {
        let updated = repo
            .set_default(account.id)
            .map_err(|err| err.to_string())?;
        append_debug_log(
            &app,
            "accounts.add_account",
            format!("Set default account id={}", account.id),
        );
        return updated
            .into_iter()
            .find(|candidate| candidate.id == account.id)
            .ok_or_else(|| "Failed to locate saved default account".to_string());
    }

    Ok(account)
}

#[tauri::command]
pub async fn remove_account(app: AppHandle, account_id: String) -> Result<(), String> {
    let repo = AccountRepository::new(app);
    let account_id = parse_account_id(&account_id)?;
    repo.delete(account_id).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn rename_account(
    app: AppHandle,
    account_id: String,
    label: String,
) -> Result<AccountRecord, String> {
    let repo = AccountRepository::new(app);
    let account_id = parse_account_id(&account_id)?;
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return Err("Account label cannot be empty".to_string());
    }
    repo.rename(account_id, trimmed.to_string())
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn set_default_account(
    app: AppHandle,
    account_id: String,
) -> Result<Vec<AccountRecord>, String> {
    let repo = AccountRepository::new(app);
    let account_id = parse_account_id(&account_id)?;
    repo.set_default(account_id).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn fetch_account_usage(
    app: AppHandle,
    account_id: String,
) -> Result<AccountUsageResult, String> {
    let repo = AccountRepository::new(app);
    let account_id = parse_account_id(&account_id)?;
    let account = repo.get(account_id).map_err(|err| err.to_string())?;
    Ok(fetch_account_usage_for_account(&repo, account, None).await)
}

#[tauri::command]
pub async fn repair_cursor_account_session(
    app: AppHandle,
    account_id: String,
) -> Result<AccountUsageResult, String> {
    let repo = AccountRepository::new(app);
    let account_id = parse_account_id(&account_id)?;

    let mut account = repo.get(account_id).map_err(|err| err.to_string())?;
    if account.provider_id != ProviderId::Cursor {
        return Err("Repair is only supported for Cursor accounts".to_string());
    }

    let secret = repo.load_secret(&account).map_err(|err| err.to_string())?;
    let refreshed_secret = refresh_cursor_cookie_secret(secret.as_ref())
        .ok_or_else(|| "No matching browser profile cookie found. Please re-scan and import again.".to_string())?;

    account.set_session_health(
        Some("stale"),
        Some("Session was refreshed from browser profile and is being re-verified.".to_string()),
        Some(chrono::Utc::now()),
    );
    if account.secret_ref.is_none() {
        account.secret_ref = Some(AccountSecretRef::for_account(account.provider_id, account.id));
    }
    let account = repo
        .save(&account, Some(&refreshed_secret))
        .map_err(|err| err.to_string())?;

    fetch_account_usage_internal(&repo, account.id, Some(refreshed_secret)).await
}

#[tauri::command]
pub async fn fetch_all_accounts_usage(app: AppHandle) -> Result<Vec<AccountUsageResult>, String> {
    let repo = AccountRepository::new(app);
    let accounts = repo.list().map_err(|err| err.to_string())?;
    let repo_ref = &repo;
    let mut out = stream::iter(accounts.into_iter().enumerate())
        .map(|(index, account)| async move {
            (index, fetch_account_usage_for_account(repo_ref, account, None).await)
        })
        .buffer_unordered(4)
        .collect::<Vec<_>>()
        .await;
    out.sort_by_key(|(index, _)| *index);

    Ok(out.into_iter().map(|(_, result)| result).collect())
}

async fn fetch_account_usage_internal<R: tauri::Runtime>(
    repo: &AccountRepository<R>,
    account_id: Uuid,
    secret_override: Option<AccountSecret>,
) -> Result<AccountUsageResult, String> {
    let account = repo.get(account_id).map_err(|err| err.to_string())?;
    Ok(fetch_account_usage_for_account(repo, account, secret_override).await)
}

async fn fetch_account_usage_for_account<R: tauri::Runtime>(
    repo: &AccountRepository<R>,
    mut account: AccountRecord,
    secret_override: Option<AccountSecret>,
) -> AccountUsageResult {
    append_debug_log(
        repo.app_handle(),
        "accounts.fetch_usage",
        format!(
            "Fetching usage for account id={} provider={} secret_override={}",
            account.id,
            account.provider_id.cli_name(),
            secret_override.is_some()
        ),
    );
    let provider = providers::build_provider(account.provider_id);
    let mut secret = match secret_override {
        Some(secret) => Some(secret),
        None => match repo.load_secret(&account) {
            Ok(secret) => secret,
            Err(err) => {
                if let Some(recovered) = recover_provider_secret(repo, &account, &err.to_string()) {
                    Some(recovered)
                } else {
                    let message = format_secret_load_error(&account, &err.to_string());
                    append_debug_log(
                        repo.app_handle(),
                        "accounts.fetch_usage",
                        format!(
                            "Failed to load secret for account id={} provider={} error={}",
                            account.id,
                            account.provider_id.cli_name(),
                            err
                        ),
                    );
                    return AccountUsageResult::failure(account, message);
                }
            }
        },
    };

    if secret.is_none() && account.auth_kind.requires_secret() {
        if let Some(recovered) =
            recover_provider_secret(repo, &account, "missing stored secret")
        {
            secret = Some(recovered);
        }
    }

    if secret.is_none() && account.auth_kind.requires_secret() {
        let message = missing_saved_login_message(&account);
        append_debug_log(
            repo.app_handle(),
            "accounts.fetch_usage",
            format!(
                "Missing secret for account id={} provider={} auth_kind={:?}",
                account.id,
                account.provider_id.cli_name(),
                account.auth_kind
            ),
        );
        return AccountUsageResult::failure(account, message);
    }

    let mut fetch = fetch_with_secret(provider.as_ref(), &account, secret.as_ref()).await;

    if let Err(err) = &fetch {
        if account.provider_id == ProviderId::Cursor
            && can_auto_repair_cursor(err)
            && secret
                .as_ref()
                .is_some_and(|s| matches!(s, AccountSecret::BrowserProfileCookie { .. }))
        {
            if let Some(refreshed_secret) = refresh_cursor_cookie_secret(secret.as_ref()) {
                account.set_session_health(
                    Some("stale"),
                    Some(
                        "Session cookie auto-refreshed from browser profile and is being re-verified."
                            .to_string(),
                    ),
                    Some(chrono::Utc::now()),
                );
                if account.secret_ref.is_none() {
                    account.secret_ref = Some(AccountSecretRef::for_account(account.provider_id, account.id));
                }
                secret = Some(refreshed_secret.clone());
                match repo.save(&account, Some(&refreshed_secret)) {
                    Ok(saved) => {
                        account = saved;
                    }
                    Err(err) => {
                        append_debug_log(
                            repo.app_handle(),
                            "accounts.fetch_usage",
                            format!(
                                "Failed to persist refreshed Cursor secret for account id={} error={}",
                                account.id, err
                            ),
                        );
                    }
                }
                fetch = fetch_with_secret(provider.as_ref(), &account, secret.as_ref()).await;
            }
        }
    }

    let now = chrono::Utc::now();
    match fetch {
        Ok(fetch_result) => {
            account.apply_usage(&fetch_result);
            if account.provider_id == ProviderId::Cursor {
                account.set_session_health(Some("fresh"), None, Some(now));
            }
            let updated = match repo.save(&account, None) {
                Ok(saved) => saved,
                Err(err) => {
                    append_debug_log(
                        repo.app_handle(),
                        "accounts.fetch_usage",
                        format!(
                            "Failed to persist fetched usage for account id={} provider={} error={}",
                            account.id,
                            account.provider_id.cli_name(),
                            err
                        ),
                    );
                    account
                }
            };
            AccountUsageResult::success(updated, fetch_result)
        }
        Err(err) => {
            if account.provider_id == ProviderId::Cursor {
                let (health, reason) = classify_cursor_health(&err);
                account.set_session_health(Some(health), Some(reason.clone()), Some(now));
                let account = match repo.save(&account, None) {
                    Ok(saved) => saved,
                    Err(save_err) => {
                        append_debug_log(
                            repo.app_handle(),
                            "accounts.fetch_usage",
                            format!(
                                "Failed to persist Cursor session health for account id={} error={}",
                                account.id, save_err
                            ),
                        );
                        account
                    }
                };
                return AccountUsageResult::failure(account, reason);
            }

            AccountUsageResult::failure(account, err.to_string())
        }
    }
}

fn recover_provider_secret<R: tauri::Runtime>(
    repo: &AccountRepository<R>,
    account: &AccountRecord,
    reason: &str,
) -> Option<AccountSecret> {
    if account.provider_id != ProviderId::Codex {
        return None;
    }

    let recovered = load_codex_cli_oauth_secret()?;
    append_debug_log(
        repo.app_handle(),
        "accounts.fetch_usage",
        format!(
            "Recovered Codex secret from local CLI auth for account id={} reason={}",
            account.id, reason
        ),
    );

    if let Err(err) = repo.save(account, Some(&recovered)) {
        append_debug_log(
            repo.app_handle(),
            "accounts.fetch_usage",
            format!(
                "Failed to persist recovered Codex secret for account id={} error={}",
                account.id, err
            ),
        );
    }

    Some(recovered)
}

fn load_codex_cli_oauth_secret() -> Option<AccountSecret> {
    let auth_path = std::env::var("CODEX_HOME")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
        .map(|path| path.join("auth.json"))
        .or_else(|| dirs::home_dir().map(|path| path.join(".codex").join("auth.json")))?;

    let content = std::fs::read_to_string(auth_path).ok()?;
    let json: Value = serde_json::from_str(&content).ok()?;
    let tokens = json.get("tokens")?;
    let access_token = tokens.get("access_token")?.as_str()?.trim();
    if access_token.is_empty() {
        return None;
    }

    let refresh_token = tokens
        .get("refresh_token")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let expires_at = tokens
        .get("expires_at")
        .and_then(|value| value.as_str())
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&chrono::Utc));
    let scopes = tokens
        .get("scopes")
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(ToOwned::to_owned))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let rate_limit_tier = tokens
        .get("rate_limit_tier")
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned);

    Some(AccountSecret::OAuth {
        credentials: OAuthCredentials {
            access_token: access_token.to_string(),
            refresh_token,
            expires_at,
            scopes,
            rate_limit_tier,
        },
    })
}

fn missing_saved_login_message(account: &AccountRecord) -> String {
    format!(
        "Saved {} login details are missing. Please sign in once more to restore live sync.",
        account.provider_id.display_name()
    )
}

fn format_secret_load_error(account: &AccountRecord, error: &str) -> String {
    if error.contains("Credential not found") {
        return missing_saved_login_message(account);
    }

    format!(
        "Failed to load the saved {} login. Please refresh or sign in again.",
        account.provider_id.display_name()
    )
}

async fn fetch_with_secret(
    provider: &dyn crate::core::Provider,
    account: &AccountRecord,
    secret: Option<&AccountSecret>,
) -> Result<crate::core::ProviderFetchResult, ProviderError> {
    let ctx = build_fetch_context(account, secret);
    match tokio::time::timeout(Duration::from_secs(30), provider.fetch_usage(&ctx)).await {
        Ok(result) => result,
        Err(_) => Err(ProviderError::Timeout),
    }
}

fn can_auto_repair_cursor(error: &ProviderError) -> bool {
    matches!(error, ProviderError::AuthRequired | ProviderError::NoCookies)
}

fn classify_cursor_health(error: &ProviderError) -> (&'static str, String) {
    match error {
        ProviderError::AuthRequired => (
            "expired",
            "Cursor session expired. Re-import this account from browser profile.".to_string(),
        ),
        ProviderError::NoCookies => (
            "invalid",
            "No Cursor cookies available for this account. Please re-scan browser profiles.".to_string(),
        ),
        ProviderError::Timeout | ProviderError::Network(_) => (
            "stale",
            "Cursor session check timed out. You can retry or repair this account.".to_string(),
        ),
        ProviderError::Other(message) => (
            "stale",
            format!("Cursor session check failed: {message}"),
        ),
        other => (
            "stale",
            format!("Cursor session check failed: {other}"),
        ),
    }
}

fn refresh_cursor_cookie_secret(secret: Option<&AccountSecret>) -> Option<AccountSecret> {
    let browser_label = match secret {
        Some(AccountSecret::BrowserProfileCookie { browser_label, .. }) => browser_label,
        _ => return None,
    };

    let target = browser_label.trim().to_lowercase();
    let cookie_set = CURSOR_COOKIE_DOMAINS
        .iter()
        .flat_map(|domain| get_all_cookie_headers_by_profile(domain))
        .find(|candidate| candidate.browser_label.trim().to_lowercase() == target)?;

    Some(AccountSecret::BrowserProfileCookie {
        browser_label: cookie_set.browser_label,
        cookie_header: cookie_set.cookie_header,
    })
}

fn build_fetch_context(account: &AccountRecord, secret: Option<&AccountSecret>) -> FetchContext {
    let base = FetchContext {
        account_id: Some(account.id),
        account_label: Some(account.label.clone()),
        ..FetchContext::default()
    };

    match secret {
        Some(secret) => secret.to_fetch_context(base),
        None => base,
    }
}

fn parse_provider_id(provider_id: &str) -> Result<ProviderId, String> {
    ProviderId::from_cli_name(provider_id)
        .ok_or_else(|| format!("Unknown provider id: {provider_id}"))
}

fn parse_account_id(account_id: &str) -> Result<Uuid, String> {
    Uuid::parse_str(account_id).map_err(|err| format!("Invalid account id: {err}"))
}

fn build_account_label(
    provider_id: ProviderId,
    requested_label: &Option<String>,
    display: &AccountDisplay,
) -> String {
    requested_label
        .as_ref()
        .map(|label| label.trim())
        .filter(|label| !label.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| display.email.clone())
        .or_else(|| display.username.clone())
        .or_else(|| display.browser_label.clone())
        .unwrap_or_else(|| format!("{} Account", provider_id.display_name()))
}

fn find_existing_email_account(
    provider_id: ProviderId,
    display: &AccountDisplay,
    existing_accounts: &[AccountRecord],
) -> Option<AccountRecord> {
    let target = normalize_email(display.email.as_deref())?;
    existing_accounts
        .iter()
        .find(|account| {
            account.provider_id == provider_id
                && normalize_email(account.display.email.as_deref())
                    .as_ref()
                    .is_some_and(|value| value == &target)
        })
        .cloned()
}

fn merge_account_display(existing: &AccountDisplay, incoming: &AccountDisplay) -> AccountDisplay {
    AccountDisplay {
        username: incoming.username.clone().or_else(|| existing.username.clone()),
        email: incoming.email.clone().or_else(|| existing.email.clone()),
        avatar_url: incoming.avatar_url.clone().or_else(|| existing.avatar_url.clone()),
        plan: incoming.plan.clone().or_else(|| existing.plan.clone()),
        browser_label: incoming
            .browser_label
            .clone()
            .or_else(|| existing.browser_label.clone()),
        session_health: incoming
            .session_health
            .clone()
            .or_else(|| existing.session_health.clone()),
        session_health_reason: incoming
            .session_health_reason
            .clone()
            .or_else(|| existing.session_health_reason.clone()),
        session_checked_at: incoming.session_checked_at.or(existing.session_checked_at),
    }
}

fn normalize_email(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty())
        .map(|candidate| candidate.to_lowercase())
}

fn validate_add_account_input(
    provider_id: ProviderId,
    input: &AddAccountInput,
) -> Result<(), String> {
    if provider_id.is_system_managed_only() {
        return Err(format!(
            "{} accounts are detected automatically and cannot be added manually",
            provider_id.display_name()
        ));
    }

    if !provider_id
        .supported_account_auth_kinds()
        .contains(&input.auth_kind)
    {
        return Err(format!(
            "{} does not support auth kind {:?}",
            provider_id.display_name(),
            input.auth_kind
        ));
    }

    match (&input.auth_kind, &input.secret) {
        (AccountAuthKind::LocalDetected, None) => Ok(()),
        (AccountAuthKind::OAuthToken, Some(AccountSecret::OAuth { .. })) => Ok(()),
        (AccountAuthKind::ImportedCliOAuth, Some(AccountSecret::ImportedCliOAuth { .. })) => Ok(()),
        (AccountAuthKind::ApiKey, Some(AccountSecret::ApiKey { .. })) => Ok(()),
        (
            AccountAuthKind::ServiceAccountJson,
            Some(AccountSecret::ServiceAccountJson { .. }),
        ) => Ok(()),
        (AccountAuthKind::ManualCookie, Some(AccountSecret::ManualCookie { .. })) => Ok(()),
        (
            AccountAuthKind::BrowserProfileCookie,
            Some(AccountSecret::BrowserProfileCookie { .. }),
        ) => Ok(()),
        _ => Err("Provided secret does not match the selected auth kind".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{AccountSecretRef, OAuthCredentials};

    #[test]
    fn chooses_explicit_label_before_display_fields() {
        let label = build_account_label(
            ProviderId::Claude,
            &Some("My Claude".to_string()),
            &AccountDisplay {
                email: Some("user@example.com".to_string()),
                ..AccountDisplay::default()
            },
        );

        assert_eq!(label, "My Claude");
    }

    #[test]
    fn build_fetch_context_carries_account_identity() {
        let mut account = AccountRecord::new_test(ProviderId::Copilot, AccountAuthKind::OAuthToken);
        account.secret_ref = Some(AccountSecretRef::for_account(
            account.provider_id,
            account.id,
        ));
        let secret = AccountSecret::OAuth {
            credentials: OAuthCredentials {
                access_token: "token".to_string(),
                refresh_token: None,
                expires_at: None,
                scopes: vec![],
                rate_limit_tier: None,
            },
        };

        let ctx = build_fetch_context(&account, Some(&secret));
        assert_eq!(ctx.account_id, Some(account.id));
        assert_eq!(ctx.api_key.as_deref(), Some("token"));
        assert!(ctx.oauth_credentials.is_some());
    }
}
