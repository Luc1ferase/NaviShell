//! Trust-on-first-use host key store (`known_hosts.json`).
//!
//! The file maps `"host:port"` to the key the server presented the first time we talked to
//! it. Unlike OpenSSH's `known_hosts` this is a JSON object, because it is also read by the
//! UI when it has to show the user a fingerprint.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::error::AppResult;
use crate::state::AppState;
use crate::storage;

/// A host key as stored (and as observed during a handshake).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHost {
    /// Key algorithm, e.g. `ssh-ed25519`.
    pub key_type: String,
    /// The key in OpenSSH one-line format.
    pub public_key: String,
    /// `SHA256:...` fingerprint of the key.
    pub fingerprint: String,
}

/// Result of comparing an observed key with the store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyVerdict {
    /// The host is not in the store yet.
    Unknown,
    /// The host is known and the key is the same.
    Match,
    /// The host is known but presented a different key.
    Mismatch { expected_fingerprint: String },
}

/// Store key for a host/port pair.
pub fn store_key(host: &str, port: u16) -> String {
    format!("{host}:{port}")
}

/// Reads the whole store; an absent or unreadable file is an empty store.
pub async fn load(app: &AppHandle) -> AppResult<BTreeMap<String, KnownHost>> {
    let path = storage::data_file(app, storage::KNOWN_HOSTS_FILE)?;
    Ok(
        storage::read_json_lenient::<BTreeMap<String, KnownHost>>(&path)
            .await
            .unwrap_or_default(),
    )
}

/// The stored key for a host, if any.
pub async fn get(app: &AppHandle, host: &str, port: u16) -> AppResult<Option<KnownHost>> {
    Ok(load(app).await?.remove(&store_key(host, port)))
}

/// Stores (or replaces) the key of a host.
pub async fn put(
    app: &AppHandle,
    state: &AppState,
    host: &str,
    port: u16,
    entry: KnownHost,
) -> AppResult<()> {
    let path = storage::data_file(app, storage::KNOWN_HOSTS_FILE)?;
    let _guard = state.storage_guard().await;
    let mut hosts = load(app).await?;
    hosts.insert(store_key(host, port), entry);
    storage::write_json(&path, &hosts).await
}

/// Compares an observed key with what the store has.
///
/// Keys are identified by their SHA-256 fingerprint, which is what the user is shown and
/// what OpenSSH compares as well.
pub fn verdict(stored: Option<&KnownHost>, observed: &KnownHost) -> HostKeyVerdict {
    match stored {
        None => HostKeyVerdict::Unknown,
        Some(known) if known.fingerprint == observed.fingerprint => HostKeyVerdict::Match,
        Some(known) => HostKeyVerdict::Mismatch {
            expected_fingerprint: known.fingerprint.clone(),
        },
    }
}
