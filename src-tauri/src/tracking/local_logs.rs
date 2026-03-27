use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use chrono::{Duration as ChronoDuration, Utc};
use rusqlite::Connection;
use serde_json::Value;

use crate::core::{CodexTotals, CostUsageDayRange, JsonlScanner, ProviderId};

use super::types::{RequestLogEntry, RequestTrackingSource};

pub fn collect_request_logs(days: u32) -> Result<Vec<RequestLogEntry>, String> {
    let days = days.max(1) as i64;
    let until = Utc::now().date_naive();
    let since = until - ChronoDuration::days(days - 1);
    let range = CostUsageDayRange::new(since, until);
    let mut entries = Vec::new();

    if let Some(codex_root) = JsonlScanner::default_codex_sessions_root() {
        let files = JsonlScanner::list_codex_session_files(
            &codex_root,
            &range.scan_since_key,
            &range.scan_until_key,
        );

        for file_path in files {
            let mut file_entries = parse_codex_request_logs(&file_path, &range)
                .map_err(|err| format!("Failed to read {}: {err}", file_path.display()))?;
            entries.append(&mut file_entries);
        }
    }

    if let Some(opencode_db) = default_opencode_db_path() {
        let mut file_entries = parse_opencode_request_logs(&opencode_db, &range)
            .map_err(|err| format!("Failed to read {}: {err}", opencode_db.display()))?;
        entries.append(&mut file_entries);
    }

    if let Some(cursor_tracking_db) = default_cursor_tracking_db_path() {
        let mut file_entries = parse_cursor_request_logs(&cursor_tracking_db, &range)
            .map_err(|err| format!("Failed to read {}: {err}", cursor_tracking_db.display()))?;
        entries.append(&mut file_entries);
    }

    entries.sort_by(|left, right| right.timestamp.cmp(&left.timestamp));
    Ok(entries)
}

pub fn collect_tracking_sources() -> Vec<RequestTrackingSource> {
    let codex_root = JsonlScanner::default_codex_sessions_root();
    let codex_ready = codex_root
        .as_ref()
        .map(|path| path.exists())
        .unwrap_or(false);
    let opencode_db = default_opencode_db_path();
    let opencode_ready = opencode_db
        .as_ref()
        .map(|path| path.exists())
        .unwrap_or(false);
    let cursor_tracking_db = default_cursor_tracking_db_path();
    let cursor_ready = cursor_tracking_db
        .as_ref()
        .map(|path| path.exists())
        .unwrap_or(false);

    let mut provider_ids = Vec::new();
    if codex_ready {
        provider_ids.push(ProviderId::Codex.cli_name().to_string());
    }
    if opencode_ready {
        provider_ids.push(ProviderId::OpenCode.cli_name().to_string());
        provider_ids.push(ProviderId::Codex.cli_name().to_string());
        provider_ids.push(ProviderId::Copilot.cli_name().to_string());
        provider_ids.push(ProviderId::Gemini.cli_name().to_string());
        provider_ids.push(ProviderId::Claude.cli_name().to_string());
        provider_ids.push(ProviderId::Antigravity.cli_name().to_string());
    }
    if cursor_ready {
        provider_ids.push(ProviderId::Cursor.cli_name().to_string());
    }

    let ready = codex_ready || opencode_ready || cursor_ready;

    vec![RequestTrackingSource {
        source_type: "local_inferred".to_string(),
        label: "Local inferred activity".to_string(),
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
        detail: build_local_tracking_detail(
            codex_root.as_deref(),
            opencode_db.as_deref(),
            cursor_tracking_db.as_deref(),
        ),
    }]
}

fn build_local_tracking_detail(
    codex_root: Option<&Path>,
    opencode_db: Option<&Path>,
    cursor_tracking_db: Option<&Path>,
) -> String {
    let mut parts = Vec::new();

    if let Some(path) = codex_root.filter(|path| path.exists()) {
        parts.push(format!(
            "Scans local Codex session logs from {} and infers request activity from token_count events.",
            path.display()
        ));
    }

    if let Some(path) = opencode_db.filter(|path| path.exists()) {
        parts.push(format!(
            "Scans OpenCode local history from {} and attributes assistant usage to OpenAI, GitHub Copilot, Gemini, Claude, Anti-Gravity, or OpenCode based on providerID and modelID.",
            path.display()
        ));
    }

    if let Some(path) = cursor_tracking_db.filter(|path| path.exists()) {
        parts.push(format!(
            "Scans Cursor AI tracking data from {} and infers request counts from distinct requestId records. Cursor token totals are not available from this source.",
            path.display()
        ));
    }

    if parts.is_empty() {
        "Local Codex or OpenCode session logs are not available on this machine yet.".to_string()
    } else {
        parts.join(" ")
    }
}

fn default_opencode_db_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(
        home.join(".local")
            .join("share")
            .join("opencode")
            .join("opencode.db"),
    )
}

fn default_cursor_tracking_db_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(
        home.join(".cursor")
            .join("ai-tracking")
            .join("ai-code-tracking.db"),
    )
}

fn parse_codex_request_logs(
    file_path: &Path,
    range: &CostUsageDayRange,
) -> std::io::Result<Vec<RequestLogEntry>> {
    let file = File::open(file_path)?;
    let reader = BufReader::new(file);
    let mut current_model: Option<String> = None;
    let mut previous_totals: Option<CodexTotals> = None;
    let mut entries = Vec::new();

    for (line_index, line_result) in reader.lines().enumerate() {
        let line = line_result?;

        if !line.contains("\"type\":\"event_msg\"") && !line.contains("\"type\":\"turn_context\"") {
            continue;
        }

        let Ok(obj) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };

        let msg_type = obj.get("type").and_then(|value| value.as_str());
        let timestamp = obj
            .get("timestamp")
            .and_then(|value| value.as_str())
            .map(str::to_string);

        let (Some(msg_type), Some(timestamp)) = (msg_type, timestamp) else {
            continue;
        };

        if timestamp.len() < 10 {
            continue;
        }

        let day_key = &timestamp[..10];
        if !CostUsageDayRange::is_in_range(day_key, &range.since_key, &range.until_key) {
            continue;
        }

        if msg_type == "turn_context" {
            if let Some(payload) = obj.get("payload") {
                if let Some(model) = payload.get("model").and_then(|value| value.as_str()) {
                    current_model = Some(model.to_string());
                } else if let Some(info) = payload.get("info") {
                    if let Some(model) = info.get("model").and_then(|value| value.as_str()) {
                        current_model = Some(model.to_string());
                    }
                }
            }
            continue;
        }

        let Some(payload) = obj.get("payload") else {
            continue;
        };
        if payload.get("type").and_then(|value| value.as_str()) != Some("token_count") {
            continue;
        }

        let info = payload.get("info");
        let model = info
            .and_then(|item| item.get("model").or(item.get("model_name")))
            .or(payload.get("model"))
            .or(obj.get("model"))
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .or(current_model.clone())
            .unwrap_or_else(|| "gpt-5".to_string());

        let (input_tokens, output_tokens) =
            if let Some(total) = info.and_then(|item| item.get("total_token_usage")) {
                let input = total
                    .get("input_tokens")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(0) as i32;
                let cached = total
                    .get("cached_input_tokens")
                    .or(total.get("cache_read_input_tokens"))
                    .and_then(|value| value.as_i64())
                    .unwrap_or(0) as i32;
                let output = total
                    .get("output_tokens")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(0) as i32;

                let delta_input =
                    (input - previous_totals.as_ref().map_or(0, |totals| totals.input)).max(0);
                let _delta_cached =
                    (cached - previous_totals.as_ref().map_or(0, |totals| totals.cached)).max(0);
                let delta_output =
                    (output - previous_totals.as_ref().map_or(0, |totals| totals.output)).max(0);

                previous_totals = Some(CodexTotals {
                    input,
                    cached,
                    output,
                });

                (delta_input, delta_output)
            } else if let Some(last) = info.and_then(|item| item.get("last_token_usage")) {
                let input = last
                    .get("input_tokens")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(0) as i32;
                let output = last
                    .get("output_tokens")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(0) as i32;
                (input.max(0), output.max(0))
            } else {
                continue;
            };

        if input_tokens == 0 && output_tokens == 0 {
            continue;
        }

        entries.push(RequestLogEntry {
            id: format!("codex:{}:{line_index}", file_path.display()),
            timestamp,
            provider_id: ProviderId::Codex.cli_name().to_string(),
            model,
            status: 200,
            input_tokens,
            output_tokens,
            duration_ms: 0,
            source_label: Some("Codex".to_string()),
            source_type: "local_inferred".to_string(),
            coverage: "partial".to_string(),
            confidence: "medium".to_string(),
        });
    }

    Ok(entries)
}

fn parse_opencode_request_logs(
    db_path: &Path,
    range: &CostUsageDayRange,
) -> Result<Vec<RequestLogEntry>, rusqlite::Error> {
    let conn = Connection::open(db_path)?;
    let since_ms = chrono::NaiveDate::parse_from_str(&range.since_key, "%Y-%m-%d")
        .ok()
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map(|datetime| datetime.and_utc().timestamp_millis())
        .unwrap_or(0);
    let until_ms = chrono::NaiveDate::parse_from_str(&range.until_key, "%Y-%m-%d")
        .ok()
        .and_then(|date| date.and_hms_opt(23, 59, 59))
        .map(|datetime| datetime.and_utc().timestamp_millis() + 999)
        .unwrap_or(i64::MAX);

    let mut stmt = conn.prepare(
        "SELECT id, session_id, time_created, time_updated, data
         FROM message
         WHERE time_created >= ?1 AND time_created <= ?2
         ORDER BY time_created DESC",
    )?;

    let rows = stmt.query_map([since_ms, until_ms], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;

    let mut entries = Vec::new();

    for row in rows {
        let (id, session_id, time_created, time_updated, data) = row?;
        let Ok(json) = serde_json::from_str::<Value>(&data) else {
            continue;
        };

        if json.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }

        let Some(provider_name) = extract_provider_name(&json) else {
            continue;
        };
        let Some(provider_id) = map_opencode_provider(provider_name, &json) else {
            continue;
        };

        let tokens = json.get("tokens");
        let input_tokens = tokens
            .and_then(|value| value.get("input"))
            .and_then(Value::as_i64)
            .unwrap_or(0) as i32;
        let output_tokens = tokens
            .and_then(|value| value.get("output"))
            .and_then(Value::as_i64)
            .unwrap_or(0) as i32;

        if input_tokens == 0 && output_tokens == 0 {
            continue;
        }

        let timestamp = chrono::DateTime::<Utc>::from_timestamp_millis(time_created)
            .unwrap_or_else(Utc::now)
            .to_rfc3339();

        let model = extract_model_name(&json).unwrap_or_else(|| "unknown".to_string());
        let duration_ms = (time_updated - time_created).max(0);

        entries.push(RequestLogEntry {
            id: format!("opencode:{}:{}", session_id, id),
            timestamp,
            provider_id: provider_id.cli_name().to_string(),
            model,
            status: 200,
            input_tokens,
            output_tokens,
            duration_ms,
            source_label: Some("OpenCode".to_string()),
            source_type: "local_inferred".to_string(),
            coverage: "partial".to_string(),
            confidence: "medium".to_string(),
        });
    }

    Ok(entries)
}

fn parse_cursor_request_logs(
    db_path: &Path,
    range: &CostUsageDayRange,
) -> Result<Vec<RequestLogEntry>, rusqlite::Error> {
    let conn = Connection::open(db_path)?;
    let since_ms = chrono::NaiveDate::parse_from_str(&range.since_key, "%Y-%m-%d")
        .ok()
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map(|datetime| datetime.and_utc().timestamp_millis())
        .unwrap_or(0);
    let until_ms = chrono::NaiveDate::parse_from_str(&range.until_key, "%Y-%m-%d")
        .ok()
        .and_then(|date| date.and_hms_opt(23, 59, 59))
        .map(|datetime| datetime.and_utc().timestamp_millis() + 999)
        .unwrap_or(i64::MAX);

    let mut stmt = conn.prepare(
        "SELECT requestId,
                COALESCE(MAX(timestamp), MAX(createdAt)) AS event_time,
                COALESCE(MAX(model), 'default') AS model
         FROM ai_code_hashes
         WHERE requestId IS NOT NULL
           AND requestId != ''
           AND COALESCE(timestamp, createdAt) >= ?1
           AND COALESCE(timestamp, createdAt) <= ?2
         GROUP BY requestId
         ORDER BY event_time DESC",
    )?;

    let rows = stmt.query_map([since_ms, until_ms], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    let mut entries = Vec::new();

    for row in rows {
        let (request_id, event_time, model) = row?;
        let timestamp = chrono::DateTime::<Utc>::from_timestamp_millis(event_time)
            .unwrap_or_else(Utc::now)
            .to_rfc3339();

        entries.push(RequestLogEntry {
            id: format!("cursor:{}", request_id),
            timestamp,
            provider_id: ProviderId::Cursor.cli_name().to_string(),
            model,
            status: 200,
            input_tokens: 0,
            output_tokens: 0,
            duration_ms: 0,
            source_label: Some("Cursor".to_string()),
            source_type: "local_inferred".to_string(),
            coverage: "partial".to_string(),
            confidence: "low".to_string(),
        });
    }

    Ok(entries)
}

fn extract_provider_name<'a>(json: &'a Value) -> Option<&'a str> {
    json.get("providerID").and_then(Value::as_str).or_else(|| {
        json.get("model")
            .and_then(Value::as_object)
            .and_then(|model| model.get("providerID"))
            .and_then(Value::as_str)
    })
}

fn extract_model_name(json: &Value) -> Option<String> {
    json.get("modelID")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            json.get("model")
                .and_then(Value::as_object)
                .and_then(|model| model.get("modelID"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn map_opencode_provider(provider_name: &str, json: &Value) -> Option<ProviderId> {
    match provider_name {
        "openai" => Some(ProviderId::Codex),
        "github-copilot" => Some(ProviderId::Copilot),
        "google" => {
            let model = extract_model_name(json).unwrap_or_default().to_lowercase();
            if model.starts_with("antigravity-") {
                Some(ProviderId::Antigravity)
            } else {
                Some(ProviderId::Gemini)
            }
        }
        "anthropic" => Some(ProviderId::Claude),
        "opencode" => Some(ProviderId::OpenCode),
        "vercel" => {
            let model = extract_model_name(json)?;
            if model.starts_with("anthropic/") {
                Some(ProviderId::Claude)
            } else if model.starts_with("openai/") {
                Some(ProviderId::Codex)
            } else {
                Some(ProviderId::OpenCode)
            }
        }
        _ => None,
    }
}
