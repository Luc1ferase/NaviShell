//! Server records stored in `servers.json`.
//!
//! The file holds a plain array of [`ServerRecord`]. Ids are uuid v4 and are generated on
//! first save; `createdAt` is kept, `updatedAt` is refreshed on every save. Passwords are
//! never stored here, only in the OS keychain (see [`crate::secrets`]).

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::secrets;
use crate::state::AppState;
use crate::storage;
use crate::util::now_millis;

/// How to authenticate against a server.
///
/// Serialised as an internally tagged object, exactly like the `AuthMethod` union of the
/// plugin API: `{ "type": "password" }`, `{ "type": "key", "keyPath": "..." }` or
/// `{ "type": "agent" }`. Records written by older versions only ever contained
/// `{ "type": "password" }`, which still deserialises into [`AuthMethod::Password`].
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AuthMethod {
    /// Password from the keychain (account `<serverId>`) or passed to `ssh_connect`.
    #[default]
    Password,
    /// OpenSSH private key file; its passphrase lives under `<serverId>:passphrase`.
    #[serde(rename_all = "camelCase")]
    Key { key_path: String },
    /// ssh-agent: the OpenSSH agent pipe on Windows, `SSH_AUTH_SOCK` elsewhere.
    Agent,
}

/// The `type` tag of an [`AuthMethod`] on its own, as reported by `ConnectionInfo`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthMethodType {
    Password,
    Key,
    Agent,
}

impl AuthMethod {
    /// The method's tag, without its parameters.
    pub fn method_type(&self) -> AuthMethodType {
        match self {
            Self::Password => AuthMethodType::Password,
            Self::Key { .. } => AuthMethodType::Key,
            Self::Agent => AuthMethodType::Agent,
        }
    }
}

/// A saved server, as the frontend sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerRecord {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    /// Optional group used to organise the sidebar.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Optional accent colour (any CSS colour string).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub auth: AuthMethod,
    /// Connect through this saved server first (ProxyJump); `None` means a direct
    /// connection. A `null` in the file is read as `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jump_server_id: Option<String>,
    /// Unix epoch milliseconds.
    pub created_at: i64,
    pub updated_at: i64,
}

/// Payload of `servers_save`: a record without the fields the core owns.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInput {
    /// Missing (or empty) means "create a new record".
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub auth: AuthMethod,
    #[serde(default)]
    pub jump_server_id: Option<String>,
}

/// Reads `servers.json`; an absent file is an empty list.
pub async fn load(app: &AppHandle) -> AppResult<Vec<ServerRecord>> {
    let path = storage::data_file(app, storage::SERVERS_FILE)?;
    Ok(storage::read_json::<Vec<ServerRecord>>(&path)
        .await?
        .unwrap_or_default())
}

async fn store(app: &AppHandle, servers: &[ServerRecord]) -> AppResult<()> {
    let path = storage::data_file(app, storage::SERVERS_FILE)?;
    storage::write_json(&path, &servers).await
}

/// The record with this id, or a `NotFound` error.
pub async fn get(app: &AppHandle, server_id: &str) -> AppResult<ServerRecord> {
    load(app)
        .await?
        .into_iter()
        .find(|s| s.id == server_id)
        .ok_or_else(|| AppError::not_found(format!("no server record with id {server_id}")))
}

fn validate(input: &ServerInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::invalid_argument("the server needs a name"));
    }
    if input.host.trim().is_empty() {
        return Err(AppError::invalid_argument("the server needs a host"));
    }
    if input.username.trim().is_empty() {
        return Err(AppError::invalid_argument("the server needs a username"));
    }
    if input.port == 0 {
        return Err(AppError::invalid_argument("the port must be 1-65535"));
    }
    if let AuthMethod::Key { key_path } = &input.auth
        && key_path.trim().is_empty()
    {
        return Err(AppError::invalid_argument(
            "key authentication needs the path of a private key",
        ));
    }
    Ok(())
}

/// Rejects a jump host that is the server itself or part of a loop.
///
/// The chain is walked through the records as they are stored; a reference to a server
/// that does not exist (any more) simply ends the chain, because `ssh_connect` is the
/// place that reports a missing jump host.
fn validate_jump_chain(
    servers: &[ServerRecord],
    id: &str,
    jump_server_id: Option<&str>,
) -> AppResult<()> {
    let Some(first) = jump_server_id else {
        return Ok(());
    };
    if first == id {
        return Err(AppError::invalid_argument(
            "a server cannot be its own jump host",
        ));
    }

    let mut seen = vec![id.to_string()];
    let mut current = Some(first.to_string());
    while let Some(next) = current {
        if seen.contains(&next) {
            return Err(AppError::invalid_argument(format!(
                "the jump host chain loops back to the server with id {next}"
            )));
        }
        current = servers
            .iter()
            .find(|server| server.id == next)
            .and_then(|server| server.jump_server_id.clone());
        seen.push(next);
    }
    Ok(())
}

/// All saved servers, oldest first.
#[tauri::command]
pub async fn servers_list(app: AppHandle) -> AppResult<Vec<ServerRecord>> {
    let mut servers = load(&app).await?;
    servers.sort_by_key(|s| s.created_at);
    Ok(servers)
}

/// Creates or updates a server record and returns the stored result.
#[tauri::command]
pub async fn servers_save(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    server: ServerInput,
) -> AppResult<ServerRecord> {
    validate(&server)?;

    let _guard = state.storage_guard().await;
    let mut servers = load(&app).await?;
    let now = now_millis();

    let id = server
        .id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string);

    let existing = id
        .as_deref()
        .and_then(|id| servers.iter().position(|s| s.id == id));

    let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let jump_server_id = server
        .jump_server_id
        .as_deref()
        .map(str::trim)
        .filter(|jump| !jump.is_empty())
        .map(str::to_string);
    validate_jump_chain(&servers, &id, jump_server_id.as_deref())?;

    let record = ServerRecord {
        id,
        name: server.name,
        host: server.host,
        port: server.port,
        username: server.username,
        group: server.group.filter(|g| !g.trim().is_empty()),
        tags: server.tags,
        color: server.color,
        auth: server.auth,
        jump_server_id,
        created_at: existing.map_or(now, |index| servers[index].created_at),
        updated_at: now,
    };

    match existing {
        Some(index) => servers[index] = record.clone(),
        None => servers.push(record.clone()),
    }
    store(&app, &servers).await?;
    Ok(record)
}

/// Deletes a server record together with its stored credentials (password and key
/// passphrase).
#[tauri::command]
pub async fn servers_delete(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    server_id: String,
) -> AppResult<()> {
    {
        let _guard = state.storage_guard().await;
        let mut servers = load(&app).await?;
        let before = servers.len();
        servers.retain(|s| s.id != server_id);
        if servers.len() == before {
            return Err(AppError::not_found(format!(
                "no server record with id {server_id}"
            )));
        }
        store(&app, &servers).await?;
    }
    // A record without credentials is normal, so this must not fail the delete.
    if let Err(err) = secrets::delete_all(&server_id).await {
        tracing::warn!(server_id, error = %err.message, "could not delete the stored credentials");
    }
    Ok(())
}
