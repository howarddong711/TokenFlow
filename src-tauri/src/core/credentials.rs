//! Credential storage abstraction

#[cfg(target_os = "macos")]
use std::process::Command;

use thiserror::Error;

/// Errors that can occur with credential operations
#[derive(Debug, Error)]
pub enum CredentialError {
    #[error("Credential not found")]
    NotFound,

    #[error("Access denied")]
    AccessDenied,

    #[error("Storage error: {0}")]
    Storage(String),

    #[error("Invalid credential format")]
    InvalidFormat,
}

/// Service account credentials used by project-scoped providers such as Vertex AI.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ServiceAccountCredentials {
    pub project_id: String,
    pub client_email: String,
    pub private_key: String,
    #[serde(default = "default_google_token_uri")]
    pub token_uri: String,
}

fn default_google_token_uri() -> String {
    "https://oauth2.googleapis.com/token".to_string()
}

/// Trait for credential storage backends
pub trait CredentialStore: Send + Sync {
    /// Get a credential by key
    fn get(&self, service: &str, key: &str) -> Result<String, CredentialError>;

    /// Set a credential
    fn set(&self, service: &str, key: &str, value: &str) -> Result<(), CredentialError>;

    /// Delete a credential
    fn delete(&self, service: &str, key: &str) -> Result<(), CredentialError>;
}

/// Windows Credential Manager implementation
#[cfg(windows)]
pub struct WindowsCredentialStore;

#[cfg(windows)]
impl WindowsCredentialStore {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(windows)]
impl Default for WindowsCredentialStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(windows)]
impl CredentialStore for WindowsCredentialStore {
    fn get(&self, service: &str, key: &str) -> Result<String, CredentialError> {
        let entry = keyring::Entry::new(service, key)
            .map_err(|e| CredentialError::Storage(e.to_string()))?;
        let secret = entry.get_secret().map_err(|e| match e {
            keyring::Error::NoEntry => CredentialError::NotFound,
            keyring::Error::Ambiguous(_) => CredentialError::Storage("Ambiguous entry".to_string()),
            _ => CredentialError::Storage(e.to_string()),
        })?;
        String::from_utf8(secret).map_err(|_| CredentialError::InvalidFormat)
    }

    fn set(&self, service: &str, key: &str, value: &str) -> Result<(), CredentialError> {
        let entry = keyring::Entry::new(service, key)
            .map_err(|e| CredentialError::Storage(e.to_string()))?;
        entry
            .set_secret(value.as_bytes())
            .map_err(|e| CredentialError::Storage(e.to_string()))
    }

    fn delete(&self, service: &str, key: &str) -> Result<(), CredentialError> {
        let entry = keyring::Entry::new(service, key)
            .map_err(|e| CredentialError::Storage(e.to_string()))?;
        entry.delete_credential().map_err(|e| match e {
            keyring::Error::NoEntry => CredentialError::NotFound,
            _ => CredentialError::Storage(e.to_string()),
        })
    }
}

/// macOS Keychain implementation.
///
/// This backend uses the `security` CLI as a bridge until the platform layer
/// is fully unified behind native adapters.
#[cfg(target_os = "macos")]
pub struct MacOsKeychainCredentialStore;

#[cfg(target_os = "macos")]
impl MacOsKeychainCredentialStore {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(target_os = "macos")]
impl Default for MacOsKeychainCredentialStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(target_os = "macos")]
impl CredentialStore for MacOsKeychainCredentialStore {
    fn get(&self, service: &str, key: &str) -> Result<String, CredentialError> {
        let output = Command::new("/usr/bin/security")
            .args(["find-generic-password", "-s", service, "-a", key, "-w"])
            .output()
            .map_err(|err| CredentialError::Storage(err.to_string()))?;

        if output.status.success() {
            let mut secret =
                String::from_utf8(output.stdout).map_err(|_| CredentialError::InvalidFormat)?;
            while secret.ends_with('\n') || secret.ends_with('\r') {
                secret.pop();
            }
            return Ok(secret);
        }

        Err(security_error(output.stderr))
    }

    fn set(&self, service: &str, key: &str, value: &str) -> Result<(), CredentialError> {
        let output = Command::new("/usr/bin/security")
            .args([
                "add-generic-password",
                "-s",
                service,
                "-a",
                key,
                "-w",
                value,
                "-U",
            ])
            .output()
            .map_err(|err| CredentialError::Storage(err.to_string()))?;

        if output.status.success() {
            return Ok(());
        }

        Err(security_error(output.stderr))
    }

    fn delete(&self, service: &str, key: &str) -> Result<(), CredentialError> {
        let output = Command::new("/usr/bin/security")
            .args(["delete-generic-password", "-s", service, "-a", key])
            .output()
            .map_err(|err| CredentialError::Storage(err.to_string()))?;

        if output.status.success() {
            return Ok(());
        }

        Err(security_error(output.stderr))
    }
}

#[cfg(target_os = "macos")]
fn security_error(stderr: Vec<u8>) -> CredentialError {
    let message = String::from_utf8_lossy(&stderr).to_string();
    let lower = message.to_lowercase();

    if lower.contains("could not be found") || lower.contains("item not found") {
        return CredentialError::NotFound;
    }

    if lower.contains("not allowed")
        || lower.contains("interaction is not allowed")
        || lower.contains("user canceled")
    {
        return CredentialError::AccessDenied;
    }

    CredentialError::Storage(if message.trim().is_empty() {
        "Unknown keychain error".to_string()
    } else {
        message
    })
}

/// Fallback backend for unsupported platforms.
#[cfg(not(any(windows, target_os = "macos")))]
pub struct UnsupportedCredentialStore;

#[cfg(not(any(windows, target_os = "macos")))]
impl UnsupportedCredentialStore {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
impl Default for UnsupportedCredentialStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
impl CredentialStore for UnsupportedCredentialStore {
    fn get(&self, _service: &str, _key: &str) -> Result<String, CredentialError> {
        Err(CredentialError::Storage(
            "No credential backend available for this platform".to_string(),
        ))
    }

    fn set(&self, _service: &str, _key: &str, _value: &str) -> Result<(), CredentialError> {
        Err(CredentialError::Storage(
            "No credential backend available for this platform".to_string(),
        ))
    }

    fn delete(&self, _service: &str, _key: &str) -> Result<(), CredentialError> {
        Err(CredentialError::Storage(
            "No credential backend available for this platform".to_string(),
        ))
    }
}

/// OAuth credentials structure
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct OAuthCredentials {
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit_tier: Option<String>,
}

impl OAuthCredentials {
    /// Check if the token is expired
    pub fn is_expired(&self) -> bool {
        if let Some(expires_at) = self.expires_at {
            // Consider expired if within 5 minutes of expiry
            expires_at <= chrono::Utc::now() + chrono::Duration::minutes(5)
        } else {
            false
        }
    }

    /// Check if the credentials have a specific scope
    pub fn has_scope(&self, scope: &str) -> bool {
        self.scopes.iter().any(|s| s == scope)
    }
}
