use rusqlite::Connection;
use serde::Serialize;

use crate::core::{ProviderError, ProviderFetchResult, RateWindow, UsageSnapshot};
use crate::platform;

#[derive(Debug, Clone, Serialize)]
pub struct CursorLocalSession {
    pub email: Option<String>,
    pub plan: Option<String>,
}

pub fn detect_local_session() -> Result<Option<CursorLocalSession>, ProviderError> {
    let db_path = platform::cursor_state_db_path().ok_or_else(|| {
        ProviderError::Other("Failed to resolve Cursor local session database".to_string())
    })?;

    if !db_path.exists() {
        return Ok(None);
    }

    let conn = Connection::open(&db_path)
        .map_err(|err| ProviderError::Other(format!("Failed to open Cursor state DB: {err}")))?;

    let email = get_value(&conn, "cursorAuth/cachedEmail")
        .map_err(|err| ProviderError::Other(format!("Failed to read Cursor email: {err}")))?;
    let membership = get_value(&conn, "cursorAuth/stripeMembershipType")
        .map_err(|err| ProviderError::Other(format!("Failed to read Cursor plan: {err}")))?;
    let access_token = get_value(&conn, "cursorAuth/accessToken")
        .map_err(|err| ProviderError::Other(format!("Failed to read Cursor token: {err}")))?;

    if access_token
        .as_deref()
        .map(|value| value.trim().is_empty())
        .unwrap_or(true)
    {
        return Ok(None);
    }

    Ok(Some(CursorLocalSession {
        email,
        plan: membership.and_then(|value| map_membership_plan(&value)),
    }))
}

pub fn build_local_fetch_result(session: &CursorLocalSession) -> ProviderFetchResult {
    let mut usage = UsageSnapshot::new(RateWindow::new(0.0))
        .with_login_method(session.plan.as_deref().unwrap_or("Cursor (local session)"));

    if let Some(email) = &session.email {
        usage = usage.with_email(email);
    }

    ProviderFetchResult::new(usage, "local")
}

fn get_value(conn: &Connection, key: &str) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row("SELECT value FROM ItemTable WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .map(Some)
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other),
    })
}

fn map_membership_plan(value: &str) -> Option<String> {
    let normalized = value.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }

    Some(match normalized.as_str() {
        "free" => "Cursor Free".to_string(),
        "pro" => "Cursor Pro".to_string(),
        "team" => "Cursor Team".to_string(),
        "enterprise" => "Cursor Enterprise".to_string(),
        other => format!("Cursor {}", capitalize(other)),
    })
}

fn capitalize(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}
