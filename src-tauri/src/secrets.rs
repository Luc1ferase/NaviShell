//! Passwords in the OS keychain.
//!
//! Every credential lives under the service name `dev.navishell` with the server id as
//! the account name, so there is at most one password per server record.
//!
//! The `keyring` crate is synchronous and talks to platform APIs that may block (and on
//! Linux may show a prompt), so every call runs on the blocking pool.

use keyring::{Entry, Error as KeyringError};
use tauri::async_runtime::spawn_blocking;

use crate::error::{AppError, AppResult};

/// Keychain service name shared by all NaviShell credentials.
pub const SERVICE: &str = "dev.navishell";

fn entry(server_id: &str) -> AppResult<Entry> {
    Entry::new(SERVICE, server_id).map_err(AppError::from)
}

fn require_server_id(server_id: &str) -> AppResult<()> {
    if server_id.trim().is_empty() {
        return Err(AppError::invalid_argument("serverId must not be empty"));
    }
    Ok(())
}

/// Reads the stored password, or `None` when the server has no credential.
pub async fn get_password(server_id: &str) -> AppResult<Option<String>> {
    require_server_id(server_id)?;
    let server_id = server_id.to_string();
    spawn_blocking(move || match entry(&server_id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(AppError::from(err)),
    })
    .await?
}

/// Stores (or replaces) the password of a server.
pub async fn set_password(server_id: &str, password: &str) -> AppResult<()> {
    require_server_id(server_id)?;
    let server_id = server_id.to_string();
    let password = password.to_string();
    spawn_blocking(move || {
        entry(&server_id)?
            .set_password(&password)
            .map_err(AppError::from)
    })
    .await?
}

/// Deletes the password of a server. A missing credential is not an error.
pub async fn delete_password(server_id: &str) -> AppResult<()> {
    require_server_id(server_id)?;
    let server_id = server_id.to_string();
    spawn_blocking(move || match entry(&server_id)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(AppError::from(err)),
    })
    .await?
}

/// Whether a password is stored for this server.
#[tauri::command]
pub async fn credential_exists(server_id: String) -> AppResult<bool> {
    Ok(get_password(&server_id).await?.is_some())
}

/// Stores a password for this server.
#[tauri::command]
pub async fn credential_set(server_id: String, password: String) -> AppResult<()> {
    set_password(&server_id, &password).await
}

/// Removes the stored password of this server (no error when there is none).
#[tauri::command]
pub async fn credential_delete(server_id: String) -> AppResult<()> {
    delete_password(&server_id).await
}
