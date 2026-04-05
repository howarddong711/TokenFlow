use std::path::PathBuf;

fn first_existing_path(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|path| path.exists())
}

/// Resolve the OpenCode local history database path for the current platform.
pub fn opencode_db_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        if let Some(local_data) = dirs::data_local_dir() {
            return first_existing_path([
                local_data.join("opencode").join("opencode.db"),
                local_data
                    .join(".local")
                    .join("share")
                    .join("opencode")
                    .join("opencode.db"),
            ]);
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            return first_existing_path([
                home.join("Library")
                    .join("Application Support")
                    .join("opencode")
                    .join("opencode.db"),
                home.join(".local")
                    .join("share")
                    .join("opencode")
                    .join("opencode.db"),
            ]);
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Some(home) = dirs::home_dir() {
            return first_existing_path([home
                .join(".local")
                .join("share")
                .join("opencode")
                .join("opencode.db")]);
        }
    }

    None
}

/// Resolve Cursor local AI tracking database path.
pub fn cursor_tracking_db_path() -> Option<PathBuf> {
    let candidate = dirs::home_dir()?.join(".cursor").join("ai-tracking").join("ai-code-tracking.db");
    candidate.exists().then_some(candidate)
}

/// Resolve Cursor local state DB path used for local session fallback.
pub fn cursor_state_db_path() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    Some(
        base.join("Cursor")
            .join("User")
            .join("globalStorage")
            .join("state.vscdb"),
    )
}

#[cfg(test)]
mod tests {
    use super::{cursor_tracking_db_path, opencode_db_path};

    #[test]
    fn opencode_db_path_is_none_when_no_candidate_exists() {
        let path = opencode_db_path();
        if path.as_ref().is_some_and(|candidate| !candidate.exists()) {
            assert!(path.is_none(), "missing OpenCode DB paths should not be returned");
        }
    }

    #[test]
    fn cursor_tracking_db_path_is_none_when_candidate_missing() {
        let path = cursor_tracking_db_path();
        if path.as_ref().is_some_and(|candidate| !candidate.exists()) {
            assert!(path.is_none(), "missing Cursor tracking DB should not be returned");
        }
    }
}
