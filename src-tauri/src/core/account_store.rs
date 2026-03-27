use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_store::{Store, StoreExt};
use thiserror::Error;
use uuid::Uuid;

use super::{
    append_debug_log, AccountRecord, AccountSecret, AccountSecretRef, CredentialError,
    CredentialStore, WindowsCredentialStore,
};

const STORE_FILE: &str = "accounts.json";
const STORE_KEY: &str = "accounts_v1";
const BACKUP_FILE_NAME: &str = "accounts-backup-v1.json";

#[derive(Debug, Error)]
pub enum AccountStoreError {
    #[error("Store access error: {0}")]
    Store(String),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Credential error: {0}")]
    Credential(#[from] CredentialError),
    #[error("Account not found")]
    NotFound,
    #[error("Invalid account secret reference")]
    InvalidSecretRef,
}

pub struct AccountRepository<R: Runtime> {
    app: AppHandle<R>,
    credential_store: Arc<dyn CredentialStore>,
}

impl<R: Runtime> AccountRepository<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self {
            app,
            credential_store: Arc::new(WindowsCredentialStore::new()),
        }
    }

    pub fn with_credential_store(
        app: AppHandle<R>,
        credential_store: Arc<dyn CredentialStore>,
    ) -> Self {
        Self {
            app,
            credential_store,
        }
    }

    pub fn app_handle(&self) -> &AppHandle<R> {
        &self.app
    }

    fn get_store(&self) -> Result<Arc<Store<R>>, AccountStoreError> {
        self.app
            .store(STORE_FILE)
            .map_err(|err| AccountStoreError::Store(err.to_string()))
    }

    pub fn list(&self) -> Result<Vec<AccountRecord>, AccountStoreError> {
        let store = self.get_store()?;
        let accounts = read_accounts_from_value(store.get(STORE_KEY).unwrap_or_else(|| json!([])))?;
        if !accounts.is_empty() {
            let (accounts, removed) = self.dedupe_accounts_by_email(accounts)?;
            if removed > 0 {
                append_debug_log(
                    &self.app,
                    "account_store.dedupe",
                    format!("Removed {} duplicate account(s) by email", removed),
                );
            }
            return Ok(accounts);
        }

        if let Some(restored) = self.read_backup_accounts()? {
            append_debug_log(
                &self.app,
                "account_store.restore_backup",
                format!("Restored {} account(s) from backup", restored.len()),
            );
            self.write_accounts_to_store(&restored)?;
            return Ok(restored);
        }

        Ok(accounts)
    }

    pub fn get(&self, account_id: Uuid) -> Result<AccountRecord, AccountStoreError> {
        self.list()?
            .into_iter()
            .find(|account| account.id == account_id)
            .ok_or(AccountStoreError::NotFound)
    }

    pub fn save(
        &self,
        account: &AccountRecord,
        secret: Option<&AccountSecret>,
    ) -> Result<AccountRecord, AccountStoreError> {
        append_debug_log(
            &self.app,
            "account_store.save",
            format!(
                "Saving account id={} provider={} auth_kind={:?} has_secret={} has_secret_ref={}",
                account.id,
                account.provider_id.cli_name(),
                account.auth_kind,
                secret.is_some(),
                account.secret_ref.is_some()
            ),
        );
        let mut accounts = self.list()?;

        if let Some(secret) = secret {
            let secret_ref = account
                .secret_ref
                .as_ref()
                .ok_or(AccountStoreError::InvalidSecretRef)?;
            self.save_secret(secret_ref, secret)?;
        }

        match accounts
            .iter_mut()
            .find(|existing| existing.id == account.id)
        {
            Some(existing) => *existing = account.clone(),
            None => accounts.push(account.clone()),
        }

        self.write_accounts(&accounts)?;
        append_debug_log(
            &self.app,
            "account_store.save",
            format!("Account saved successfully id={}", account.id),
        );
        Ok(account.clone())
    }

    pub fn delete(&self, account_id: Uuid) -> Result<(), AccountStoreError> {
        let mut accounts = self.list()?;
        let Some(index) = accounts.iter().position(|account| account.id == account_id) else {
            return Err(AccountStoreError::NotFound);
        };

        let account = accounts.remove(index);
        if let Some(secret_ref) = account.secret_ref.as_ref() {
            match self
                .credential_store
                .delete(&secret_ref.service, &secret_ref.key)
            {
                Ok(()) | Err(CredentialError::NotFound) => {}
                Err(err) => return Err(AccountStoreError::Credential(err)),
            }
        }

        self.write_accounts(&accounts)
    }

    pub fn rename(
        &self,
        account_id: Uuid,
        label: String,
    ) -> Result<AccountRecord, AccountStoreError> {
        let mut accounts = self.list()?;
        let account = accounts
            .iter_mut()
            .find(|account| account.id == account_id)
            .ok_or(AccountStoreError::NotFound)?;
        account.label = label;
        account.touch();
        let updated = account.clone();
        self.write_accounts(&accounts)?;
        Ok(updated)
    }

    pub fn set_default(&self, account_id: Uuid) -> Result<Vec<AccountRecord>, AccountStoreError> {
        let mut accounts = self.list()?;
        let provider_id = accounts
            .iter()
            .find(|account| account.id == account_id)
            .map(|account| account.provider_id)
            .ok_or(AccountStoreError::NotFound)?;

        for account in &mut accounts {
            if account.provider_id == provider_id {
                account.default = account.id == account_id;
                account.touch();
            }
        }

        self.write_accounts(&accounts)?;
        Ok(accounts)
    }

    pub fn load_secret(
        &self,
        account: &AccountRecord,
    ) -> Result<Option<AccountSecret>, AccountStoreError> {
        let Some(secret_ref) = account.secret_ref.as_ref() else {
            append_debug_log(
                &self.app,
                "account_store.load_secret",
                format!("Account id={} has no secret_ref", account.id),
            );
            return Ok(None);
        };

        append_debug_log(
            &self.app,
            "account_store.load_secret",
            format!(
                "Loading secret for account id={} service={} key={}",
                account.id, secret_ref.service, secret_ref.key
            ),
        );
        let serialized = self
            .credential_store
            .get(&secret_ref.service, &secret_ref.key)?;
        let secret = decode_secret(&serialized)?;
        append_debug_log(
            &self.app,
            "account_store.load_secret",
            format!("Loaded secret successfully for account id={}", account.id),
        );
        Ok(Some(secret))
    }

    fn save_secret(
        &self,
        secret_ref: &AccountSecretRef,
        secret: &AccountSecret,
    ) -> Result<(), AccountStoreError> {
        let serialized = encode_secret(secret)?;
        append_debug_log(
            &self.app,
            "account_store.save_secret",
            format!(
                "Saving secret service={} key={} payload_len={}",
                secret_ref.service,
                secret_ref.key,
                serialized.len()
            ),
        );
        self.credential_store
            .set(&secret_ref.service, &secret_ref.key, &serialized)?;
        let verify = self
            .credential_store
            .get(&secret_ref.service, &secret_ref.key)
            .map(|stored| stored.len());
        match verify {
            Ok(len) => append_debug_log(
                &self.app,
                "account_store.save_secret",
                format!(
                    "Verified secret immediately after save service={} key={} stored_len={}",
                    secret_ref.service, secret_ref.key, len
                ),
            ),
            Err(err) => {
                append_debug_log(
                    &self.app,
                    "account_store.save_secret",
                    format!(
                        "Immediate read-after-write failed service={} key={} error={}",
                        secret_ref.service, secret_ref.key, err
                    ),
                );
                return Err(AccountStoreError::Credential(err));
            }
        }
        Ok(())
    }

    fn write_accounts(&self, accounts: &[AccountRecord]) -> Result<(), AccountStoreError> {
        self.write_accounts_to_store(accounts)?;
        self.write_backup_accounts(accounts)?;
        Ok(())
    }

    fn write_accounts_to_store(&self, accounts: &[AccountRecord]) -> Result<(), AccountStoreError> {
        let store = self.get_store()?;
        store.set(STORE_KEY, serde_json::to_value(accounts)?);
        store
            .save()
            .map_err(|err| AccountStoreError::Store(err.to_string()))?;
        Ok(())
    }

    fn dedupe_accounts_by_email(
        &self,
        accounts: Vec<AccountRecord>,
    ) -> Result<(Vec<AccountRecord>, usize), AccountStoreError> {
        let mut deduped: Vec<AccountRecord> = Vec::with_capacity(accounts.len());
        let mut by_identity: HashMap<String, usize> = HashMap::new();
        let mut removed: Vec<AccountRecord> = Vec::new();

        for account in accounts {
            let Some(identity_key) = dedupe_email_key(&account) else {
                deduped.push(account);
                continue;
            };

            if let Some(existing_index) = by_identity.get(&identity_key).copied() {
                let existing = &deduped[existing_index];
                if should_keep_newer_email_record(&account, existing) {
                    let replaced = std::mem::replace(&mut deduped[existing_index], account);
                    removed.push(replaced);
                } else {
                    removed.push(account);
                }
                continue;
            }

            by_identity.insert(identity_key, deduped.len());
            deduped.push(account);
        }

        if removed.is_empty() {
            return Ok((deduped, 0));
        }

        self.write_accounts(&deduped)?;
        for account in &removed {
            self.delete_secret_if_present(account);
        }

        Ok((deduped, removed.len()))
    }

    fn read_backup_accounts(&self) -> Result<Option<Vec<AccountRecord>>, AccountStoreError> {
        for path in self.backup_paths() {
            let content = match fs::read_to_string(&path) {
                Ok(content) => content,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
                Err(err) => {
                    append_debug_log(
                        &self.app,
                        "account_store.restore_backup",
                        format!("Failed to read backup {}: {}", path.display(), err),
                    );
                    continue;
                }
            };

            let accounts = match serde_json::from_str::<Vec<AccountRecord>>(&content) {
                Ok(accounts) => accounts,
                Err(err) => {
                    append_debug_log(
                        &self.app,
                        "account_store.restore_backup",
                        format!("Failed to parse backup {}: {}", path.display(), err),
                    );
                    continue;
                }
            };
            if accounts.is_empty() {
                continue;
            }

            append_debug_log(
                &self.app,
                "account_store.restore_backup",
                format!(
                    "Loaded backup {} with {} account(s)",
                    path.display(),
                    accounts.len()
                ),
            );
            return Ok(Some(accounts));
        }

        Ok(None)
    }

    fn write_backup_accounts(&self, accounts: &[AccountRecord]) -> Result<(), AccountStoreError> {
        let serialized = serde_json::to_string_pretty(accounts)?;

        for path in self.backup_paths() {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|err| {
                    AccountStoreError::Store(format!(
                        "Failed to create backup dir {}: {err}",
                        parent.display()
                    ))
                })?;
            }

            fs::write(&path, &serialized).map_err(|err| {
                AccountStoreError::Store(format!(
                    "Failed to write backup {}: {err}",
                    path.display()
                ))
            })?;

            append_debug_log(
                &self.app,
                "account_store.write_backup",
                format!(
                    "Wrote account backup {} with {} account(s)",
                    path.display(),
                    accounts.len()
                ),
            );
        }

        Ok(())
    }

    fn backup_paths(&self) -> Vec<PathBuf> {
        let mut paths = Vec::new();

        if let Some(mut path) = dirs::data_local_dir() {
            path.push("TokenFlow");
            path.push(BACKUP_FILE_NAME);
            paths.push(path);
        }

        if let Ok(mut path) = self.app.path().app_data_dir() {
            path.push(BACKUP_FILE_NAME);
            if !paths.iter().any(|existing| existing == &path) {
                paths.push(path);
            }
        }

        paths
    }

    fn delete_secret_if_present(&self, account: &AccountRecord) {
        let Some(secret_ref) = account.secret_ref.as_ref() else {
            return;
        };

        match self
            .credential_store
            .delete(&secret_ref.service, &secret_ref.key)
        {
            Ok(()) | Err(CredentialError::NotFound) => {}
            Err(err) => append_debug_log(
                &self.app,
                "account_store.dedupe",
                format!(
                    "Failed to delete deduped credential for account id={} service={} key={} error={}",
                    account.id, secret_ref.service, secret_ref.key, err
                ),
            ),
        }
    }
}

fn read_accounts_from_value(value: Value) -> Result<Vec<AccountRecord>, AccountStoreError> {
    match value {
        Value::Null => Ok(Vec::new()),
        other => serde_json::from_value(other).map_err(AccountStoreError::from),
    }
}

fn encode_secret(secret: &AccountSecret) -> Result<String, AccountStoreError> {
    serde_json::to_string(secret).map_err(AccountStoreError::from)
}

fn decode_secret(serialized: &str) -> Result<AccountSecret, AccountStoreError> {
    try_decode_secret(serialized)
        .or_else(|| {
            if serialized.contains('\0') {
                try_decode_secret(&serialized.replace('\0', ""))
            } else {
                None
            }
        })
        .ok_or_else(|| {
            serde_json::from_str::<AccountSecret>(serialized)
                .err()
                .map(AccountStoreError::from)
                .unwrap_or_else(|| {
                    AccountStoreError::Store("Failed to decode stored secret".to_string())
                })
        })
}

fn try_decode_secret(serialized: &str) -> Option<AccountSecret> {
    let normalized = serialized.trim_start_matches('\u{feff}').trim();
    serde_json::from_str(normalized).ok()
}

fn dedupe_email_key(account: &AccountRecord) -> Option<String> {
    let email = account
        .display
        .email
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_lowercase();
    Some(format!("{}:{}", account.provider_id.cli_name(), email))
}

fn should_keep_newer_email_record(candidate: &AccountRecord, existing: &AccountRecord) -> bool {
    if candidate.updated_at != existing.updated_at {
        return candidate.updated_at > existing.updated_at;
    }
    candidate.created_at > existing.created_at
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{AccountAuthKind, OAuthCredentials, ProviderId};

    #[test]
    fn secret_ref_uses_account_scoped_key() {
        let secret_ref = AccountSecretRef::for_account(ProviderId::OpenRouter, Uuid::nil());
        assert_eq!(secret_ref.service, "tokenflow");
        assert!(secret_ref.key.contains("openrouter"));
    }

    #[test]
    fn secret_round_trip_preserves_oauth_payload() {
        let secret = AccountSecret::OAuth {
            credentials: OAuthCredentials {
                access_token: "token".to_string(),
                refresh_token: Some("refresh".to_string()),
                expires_at: None,
                scopes: vec!["user:profile".to_string()],
                rate_limit_tier: Some("pro".to_string()),
            },
        };

        let encoded = encode_secret(&secret).expect("encode account secret");
        let decoded = decode_secret(&encoded).expect("decode account secret");
        assert_eq!(decoded, secret);
    }

    #[test]
    fn reads_empty_accounts_from_null_value() {
        let accounts = read_accounts_from_value(Value::Null).expect("read null accounts");
        assert!(accounts.is_empty());
    }

    #[test]
    fn account_record_serialization_round_trip() {
        let account = AccountRecord::new_test(ProviderId::Claude, AccountAuthKind::OAuthToken);
        let encoded = serde_json::to_value(vec![account.clone()]).expect("encode account list");
        let decoded = read_accounts_from_value(encoded).expect("decode account list");
        assert_eq!(decoded, vec![account]);
    }
}
