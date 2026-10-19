//! Passwords and key passphrases in the OS keychain.
//!
//! Every credential lives under the service name `dev.navishell`. The account name is the
//! server id for a login password and `<serverId>:passphrase` for the passphrase of a
//! private key, so a server record can have one of each.
//!
//! The `keyring` crate is synchronous and talks to platform APIs that may block (and on
//! Linux may show a prompt), so every call runs on the blocking pool.

use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::spawn_blocking;

use crate::error::{AppError, AppResult};

/// Keychain service name shared by all NaviShell credentials.
pub const SERVICE: &str = "dev.navishell";

/// Which secret of a server record is meant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CredentialKind {
    /// The login password (keychain account `<serverId>`).
    #[default]
    Password,
    /// The passphrase of the private key (keychain account `<serverId>:passphrase`).
    Passphrase,
}

impl CredentialKind {
    /// Keychain account name of this credential.
    fn account(self, server_id: &str) -> String {
        match self {
            Self::Password => server_id.to_string(),
            Self::Passphrase => format!("{server_id}:passphrase"),
        }
    }
}

/// Every credential kind, so a deleted server record can be cleaned up completely.
const ALL_KINDS: [CredentialKind; 2] = [CredentialKind::Password, CredentialKind::Passphrase];

fn entry(account: &str) -> AppResult<Entry> {
    Entry::new(SERVICE, account).map_err(AppError::from)
}

fn require_server_id(server_id: &str) -> AppResult<()> {
    if server_id.trim().is_empty() {
        return Err(AppError::invalid_argument("serverId must not be empty"));
    }
    Ok(())
}

/// Reads a stored secret, or `None` when the server has no credential of that kind.
pub async fn get(server_id: &str, kind: CredentialKind) -> AppResult<Option<String>> {
    require_server_id(server_id)?;
    let account = kind.account(server_id);
    spawn_blocking(move || match entry(&account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(AppError::from(err)),
    })
    .await?
}

/// Stores (or replaces) a secret of a server.
pub async fn set(server_id: &str, kind: CredentialKind, secret: &str) -> AppResult<()> {
    require_server_id(server_id)?;
    let account = kind.account(server_id);
    let secret = secret.to_string();
    spawn_blocking(move || {
        entry(&account)?
            .set_password(&secret)
            .map_err(AppError::from)
    })
    .await?
}

/// Deletes a secret of a server. A missing credential is not an error.
pub async fn delete(server_id: &str, kind: CredentialKind) -> AppResult<()> {
    require_server_id(server_id)?;
    let account = kind.account(server_id);
    spawn_blocking(move || match entry(&account)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(AppError::from(err)),
    })
    .await?
}

/// Deletes every secret of a server (used when its record goes away).
pub async fn delete_all(server_id: &str) -> AppResult<()> {
    for kind in ALL_KINDS {
        delete(server_id, kind).await?;
    }
    Ok(())
}

/// Whether a credential of this kind is stored for this server (default: the password).
#[tauri::command]
pub async fn credential_exists(server_id: String, kind: Option<CredentialKind>) -> AppResult<bool> {
    Ok(get(&server_id, kind.unwrap_or_default()).await?.is_some())
}

/// Stores a password or key passphrase for this server (default: the password).
#[tauri::command]
pub async fn credential_set(
    server_id: String,
    password: String,
    kind: Option<CredentialKind>,
) -> AppResult<()> {
    set(&server_id, kind.unwrap_or_default(), &password).await
}

/// Removes a stored credential of this server (no error when there is none).
#[tauri::command]
pub async fn credential_delete(server_id: String, kind: Option<CredentialKind>) -> AppResult<()> {
    delete(&server_id, kind.unwrap_or_default()).await
}
