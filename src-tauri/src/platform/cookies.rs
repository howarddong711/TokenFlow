use crate::browser::cookies::BrowserCookieSet;

/// Extract browser cookie header through the platform adapter seam.
///
/// Current behavior remains aligned with existing browser module support; this
/// entry point exists so macOS-specific decryption and profile handling can be
/// introduced without touching command/provider call sites again.
pub fn extract_browser_cookie(domain: &str) -> Result<String, String> {
    crate::browser::cookies::get_cookie_header(domain).map_err(|err| err.to_string())
}

/// Extract all browser/profile cookie headers for multi-account import flows.
pub fn extract_browser_cookie_sets(domain: &str) -> Vec<BrowserCookieSet> {
    crate::browser::cookies::get_all_cookie_headers_by_profile(domain)
}
