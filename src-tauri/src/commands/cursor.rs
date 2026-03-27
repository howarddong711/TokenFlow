use serde::Serialize;

use crate::browser::cookies::{get_all_cookie_headers_by_profile, BrowserCookieSet};
use crate::providers::cursor::{detect_local_session, CursorApi};

const CURSOR_COOKIE_DOMAINS: [&str; 2] = ["cursor.com", "cursor.sh"];

#[derive(Debug, Clone, Serialize)]
pub struct CursorBrowserProfileCandidate {
    pub browser_label: String,
    pub email: Option<String>,
    pub plan: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CursorBrowserProfileImport {
    pub browser_label: String,
    pub cookie_header: String,
    pub email: Option<String>,
    pub plan: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CursorLocalSessionImport {
    pub email: Option<String>,
    pub plan: Option<String>,
}

#[tauri::command]
pub async fn list_cursor_browser_profiles() -> Result<Vec<CursorBrowserProfileCandidate>, String> {
    let cookie_sets: Vec<BrowserCookieSet> = CURSOR_COOKIE_DOMAINS
        .iter()
        .flat_map(|domain| get_all_cookie_headers_by_profile(domain))
        .collect();
    let api = CursorApi::new();
    let mut candidates = Vec::new();

    for cookie_set in cookie_sets {
        let profile = enrich_cookie_set(&api, cookie_set).await;
        candidates.push(profile);
    }

    candidates.sort_by(|left, right| left.browser_label.cmp(&right.browser_label));
    candidates.dedup_by(|left, right| left.browser_label == right.browser_label);
    Ok(candidates)
}

#[tauri::command]
pub async fn import_cursor_browser_profile(
    browser_label: String,
) -> Result<CursorBrowserProfileImport, String> {
    let api = CursorApi::new();
    let target = browser_label.trim().to_lowercase();
    let cookie_set = CURSOR_COOKIE_DOMAINS
        .iter()
        .flat_map(|domain| get_all_cookie_headers_by_profile(domain))
        .find(|candidate| candidate.browser_label.trim().to_lowercase() == target)
        .ok_or_else(|| format!("Cursor browser profile not found: {browser_label}"))?;

    let candidate = enrich_cookie_set(&api, cookie_set.clone()).await;

    Ok(CursorBrowserProfileImport {
        browser_label: cookie_set.browser_label,
        cookie_header: cookie_set.cookie_header,
        email: candidate.email,
        plan: candidate.plan,
    })
}

#[tauri::command]
pub async fn import_cursor_local_session() -> Result<CursorLocalSessionImport, String> {
    let session = detect_local_session()
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "No signed-in Cursor desktop session was detected.".to_string())?;

    Ok(CursorLocalSessionImport {
        email: session.email,
        plan: session.plan,
    })
}

async fn enrich_cookie_set(
    api: &CursorApi,
    cookie_set: BrowserCookieSet,
) -> CursorBrowserProfileCandidate {
    match api
        .fetch_usage_with_cookie(Some(&cookie_set.cookie_header))
        .await
    {
        Ok((_primary, _cost, email, plan)) => CursorBrowserProfileCandidate {
            browser_label: cookie_set.browser_label,
            email,
            plan,
        },
        Err(_) => CursorBrowserProfileCandidate {
            browser_label: cookie_set.browser_label,
            email: None,
            plan: None,
        },
    }
}
