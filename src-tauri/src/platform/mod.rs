//! Platform adapter entry points.
//!
//! This module centralizes OS-specific backend selection so core domain modules
//! stay portable as we expand Windows-only behavior to full dual-platform support.

mod cookies;
mod credentials;
pub mod macos;
mod paths;
mod updater;
pub mod windows;

pub use cookies::{extract_browser_cookie, extract_browser_cookie_sets};
pub use credentials::default_credential_store;
pub use paths::{cursor_state_db_path, cursor_tracking_db_path, opencode_db_path};
pub use updater::{current_release_channel, ReleaseChannel};
