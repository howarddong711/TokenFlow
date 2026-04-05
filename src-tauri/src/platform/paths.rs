use std::path::PathBuf;

/// Resolve the OpenCode local history database path for the current platform.
pub fn opencode_db_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        if let Some(local_data) = dirs::data_local_dir() {
            let primary = local_data.join("opencode").join("opencode.db");
            if primary.exists() {
                return Some(primary);
            }

            let fallback = local_data
                .join(".local")
                .join("share")
                .join("opencode")
                .join("opencode.db");
            if fallback.exists() {
                return Some(fallback);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            let primary = home
                .join("Library")
                .join("Application Support")
                .join("opencode")
                .join("opencode.db");
            if primary.exists() {
                return Some(primary);
            }

            let fallback = home
                .join(".local")
                .join("share")
                .join("opencode")
                .join("opencode.db");
            if fallback.exists() {
                return Some(fallback);
            }
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Some(home) = dirs::home_dir() {
            let primary = home
                .join(".local")
                .join("share")
                .join("opencode")
                .join("opencode.db");
            if primary.exists() {
                return Some(primary);
            }
        }
    }

    // Return best-effort default even when the path does not exist yet.
    #[cfg(target_os = "windows")]
    {
        return dirs::data_local_dir().map(|p| p.join("opencode").join("opencode.db"));
    }
    #[cfg(target_os = "macos")]
    {
        return dirs::home_dir().map(|home| {
            home.join("Library")
                .join("Application Support")
                .join("opencode")
                .join("opencode.db")
        });
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        dirs::home_dir().map(|home| {
            home.join(".local")
                .join("share")
                .join("opencode")
                .join("opencode.db")
        })
    }
}

/// Resolve Cursor local AI tracking database path.
pub fn cursor_tracking_db_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| {
        home.join(".cursor")
            .join("ai-tracking")
            .join("ai-code-tracking.db")
    })
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
