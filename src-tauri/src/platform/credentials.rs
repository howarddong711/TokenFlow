use std::sync::Arc;

use crate::core::CredentialStore;

#[cfg(target_os = "macos")]
use crate::core::MacOsKeychainCredentialStore;
#[cfg(not(any(windows, target_os = "macos")))]
use crate::core::UnsupportedCredentialStore;
#[cfg(windows)]
use crate::core::WindowsCredentialStore;

/// Build the default credential backend for the current OS target.
pub fn default_credential_store() -> Arc<dyn CredentialStore> {
    #[cfg(windows)]
    {
        return Arc::new(WindowsCredentialStore::new());
    }

    #[cfg(target_os = "macos")]
    {
        return Arc::new(MacOsKeychainCredentialStore::new());
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Arc::new(UnsupportedCredentialStore::new())
    }
}
