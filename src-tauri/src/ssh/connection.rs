//! Establishing and tearing down SSH sessions.
//!
//! `ssh_connect` resolves the password (argument first, keychain second), runs the
//! handshake with a trust-on-first-use host key policy and registers the resulting
//! session in [`AppState`]. Channels for terminals, exec calls and SFTP are opened on
//! that session afterwards.
//!
//! When a session dies - because the remote closed it, the network broke, or the user
//! called `ssh_disconnect` - [`close_connection`] removes it from the registry, ends all
//! of its terminals and emits `connection:closed` exactly once.

use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::Duration;

use russh::Disconnect;
use russh::client::{self, DisconnectReason, Handler};
use russh::keys::{HashAlg, PublicKeyOrCertificate};
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::known_hosts::{self, HostKeyVerdict, KnownHost};
use crate::ssh::terminal::TermCmd;
use crate::state::AppState;
use crate::util::now_millis;
use crate::{secrets, servers};

/// How long the TCP connection and handshake may take.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// Interval of SSH keepalive messages; three unanswered ones close the session.
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);

/// Whether the host key was already known before this connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HostKeyStatus {
    /// The stored key and the offered key are the same.
    Known,
    /// The key was stored during this connection (first contact, or accepted change).
    New,
}

/// A live SSH session, as the frontend sees it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub id: String,
    pub server_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    /// Unix epoch milliseconds.
    pub connected_at: i64,
    /// `SHA256:...` fingerprint of the key the server presented.
    pub host_key_fingerprint: String,
    pub host_key_status: HostKeyStatus,
}

/// Payload of the `connection:closed` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionClosed {
    connection_id: String,
    reason: Option<String>,
}

/// An authenticated SSH session plus everything that is shared by its channels.
pub struct Connection {
    pub info: ConnectionInfo,
    handle: Arc<client::Handle<ClientHandler>>,
    /// Opened on first use and reused by every SFTP command of this connection.
    sftp: Mutex<Option<Arc<SftpSession>>>,
}

impl Connection {
    /// `true` once the session is gone (remote closed it, or the network broke).
    pub fn is_closed(&self) -> bool {
        self.handle.is_closed()
    }

    /// Opens a new session channel for a terminal, an exec call or the SFTP subsystem.
    pub async fn open_channel(&self) -> AppResult<russh::Channel<client::Msg>> {
        if self.is_closed() {
            return Err(AppError::not_connected(format!(
                "the SSH session of connection {} is closed",
                self.info.id
            )));
        }
        self.handle
            .channel_open_session()
            .await
            .map_err(AppError::from)
    }

    /// The SFTP session of this connection, opening the subsystem on first use.
    ///
    /// The returned handle is cloned out of the lock, so long transfers never block
    /// other SFTP calls on the same connection.
    pub async fn sftp(&self) -> AppResult<Arc<SftpSession>> {
        let mut slot = self.sftp.lock().await;
        if let Some(session) = slot.as_ref() {
            if !self.is_closed() {
                return Ok(Arc::clone(session));
            }
            // The session died; drop the stale handle and try to open a new one.
            *slot = None;
        }

        let channel = self.open_channel().await?;
        channel.request_subsystem(true, "sftp").await?;
        let session = Arc::new(SftpSession::new(channel.into_stream()).await?);
        *slot = Some(Arc::clone(&session));
        tracing::debug!(connection_id = %self.info.id, "opened the SFTP subsystem");
        Ok(session)
    }

    /// Sends a disconnect message; errors are ignored because the session may be gone.
    async fn shutdown(&self) {
        if let Err(err) = self
            .handle
            .disconnect(Disconnect::ByApplication, "", "en")
            .await
        {
            tracing::debug!(connection_id = %self.info.id, %err, "disconnect message failed");
        }
    }
}

/// What `check_server_key` saw, read back by `ssh_connect` after the handshake.
#[derive(Debug, Default)]
struct HostKeyReport {
    observed: Option<KnownHost>,
    verdict: Option<HostKeyVerdict>,
}

/// russh client callbacks: host key policy and session teardown.
pub struct ClientHandler {
    app: AppHandle,
    /// The key stored for this host, if any.
    expected: Option<KnownHost>,
    /// Set when the user accepted a changed host key.
    trust_host_key: bool,
    report: Arc<StdMutex<HostKeyReport>>,
    /// Filled once the connection is registered, so teardown can find it again.
    connection_id: Arc<OnceLock<String>>,
}

impl Handler for ClientHandler {
    type Error = russh::Error;

    /// Trust on first use: unknown hosts are accepted (and stored by `ssh_connect`), a
    /// changed key is only accepted when the user confirmed it.
    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let key = server_public_key.public_key();
        let observed = KnownHost {
            key_type: key.algorithm().to_string(),
            public_key: key.to_openssh().unwrap_or_default(),
            fingerprint: key.fingerprint(HashAlg::Sha256).to_string(),
        };
        let verdict = known_hosts::verdict(self.expected.as_ref(), &observed);
        let accepted = match &verdict {
            HostKeyVerdict::Unknown | HostKeyVerdict::Match => true,
            HostKeyVerdict::Mismatch { .. } => self.trust_host_key,
        };
        tracing::debug!(
            fingerprint = %observed.fingerprint,
            ?verdict,
            accepted,
            "checked the host key"
        );
        let mut report = lock(&self.report);
        report.observed = Some(observed);
        report.verdict = Some(verdict);
        Ok(accepted)
    }

    /// The session ended: clean up the registry and tell the frontend.
    async fn disconnected(
        &mut self,
        reason: DisconnectReason<Self::Error>,
    ) -> Result<(), Self::Error> {
        let description = match &reason {
            DisconnectReason::ReceivedDisconnect(info) => {
                if info.message.is_empty() {
                    format!("the server closed the connection ({:?})", info.reason_code)
                } else {
                    info.message.clone()
                }
            }
            DisconnectReason::Error(err) => err.to_string(),
        };
        if let Some(connection_id) = self.connection_id.get().cloned() {
            let app = self.app.clone();
            // Teardown touches tokio locks and emits an event, so it cannot run inside
            // this callback (the session task is what we are tearing down).
            tauri::async_runtime::spawn(async move {
                close_connection(&app, &connection_id, Some(description)).await;
            });
        }
        match reason {
            DisconnectReason::ReceivedDisconnect(_) => Ok(()),
            DisconnectReason::Error(err) => Err(err),
        }
    }
}

/// Locks a poisoned-tolerant std mutex (the guarded data is plain values).
fn lock<T>(mutex: &StdMutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|err| err.into_inner())
}

/// Connects to a saved server and authenticates with a password.
///
/// * `password` missing: the keychain is used; without a stored password the call fails
///   with `PasswordRequired`.
/// * `save_password`: stores the password in the keychain after a successful handshake.
/// * `trust_host_key`: accepts (and stores) a host key that differs from the stored one.
#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    server_id: String,
    password: Option<String>,
    save_password: Option<bool>,
    trust_host_key: Option<bool>,
) -> AppResult<ConnectionInfo> {
    let server = servers::get(&app, &server_id).await?;
    let save_password = save_password.unwrap_or(false);

    let password = match password {
        Some(password) => password,
        None => secrets::get_password(&server_id).await?.ok_or_else(|| {
            AppError::password_required(format!(
                "no password stored for {}@{}",
                server.username, server.host
            ))
        })?,
    };

    let expected = known_hosts::get(&app, &server.host, server.port).await?;
    let report = Arc::new(StdMutex::new(HostKeyReport::default()));
    let connection_id = Arc::new(OnceLock::new());
    let handler = ClientHandler {
        app: app.clone(),
        expected,
        trust_host_key: trust_host_key.unwrap_or(false),
        report: Arc::clone(&report),
        connection_id: Arc::clone(&connection_id),
    };

    let config = Arc::new(client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(KEEPALIVE_INTERVAL),
        keepalive_max: 3,
        ..Default::default()
    });

    tracing::info!(host = %server.host, port = server.port, user = %server.username, "connecting");
    let attempt = client::connect(config, (server.host.as_str(), server.port), handler);
    let mut handle = match tokio::time::timeout(CONNECT_TIMEOUT, attempt).await {
        Ok(Ok(handle)) => handle,
        Ok(Err(err)) => return Err(handshake_error(&report, err, &server.host, server.port)),
        Err(_) => {
            return Err(AppError::timeout(format!(
                "connecting to {}:{} timed out",
                server.host, server.port
            )));
        }
    };

    let auth = handle
        .authenticate_password(server.username.clone(), password.clone())
        .await
        .map_err(|err| match AppError::from(err) {
            // A session that drops during authentication is an auth problem, not a bug.
            err if err.code == ErrorCode::NotConnected => AppError::auth_failed(format!(
                "the server closed the connection during authentication: {}",
                err.message
            )),
            err => err,
        })?;
    if !auth.success() {
        let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
        return Err(AppError::auth_failed(format!(
            "the server rejected the password of {}@{}",
            server.username, server.host
        )));
    }

    // The handshake is done, so the report is filled in.
    let (observed, verdict) = {
        let mut report = lock(&report);
        (report.observed.take(), report.verdict.take())
    };
    let observed = observed.ok_or_else(|| {
        AppError::internal("the SSH handshake completed without checking a host key")
    })?;
    let host_key_status = match verdict {
        Some(HostKeyVerdict::Match) => HostKeyStatus::Known,
        // Unknown host, or a change the user accepted: remember the key we just used.
        _ => {
            known_hosts::put(&app, &state, &server.host, server.port, observed.clone()).await?;
            HostKeyStatus::New
        }
    };

    if save_password {
        // The session is up; failing to persist the password must not undo that.
        if let Err(err) = secrets::set_password(&server_id, &password).await {
            tracing::warn!(server_id, error = %err.message, "could not store the password");
        }
    }

    let info = ConnectionInfo {
        id: uuid::Uuid::new_v4().to_string(),
        server_id,
        host: server.host,
        port: server.port,
        username: server.username,
        connected_at: now_millis(),
        host_key_fingerprint: observed.fingerprint,
        host_key_status,
    };
    let _ = connection_id.set(info.id.clone());

    tracing::info!(connection_id = %info.id, host = %info.host, "connected");
    state
        .insert_connection(Arc::new(Connection {
            info: info.clone(),
            handle: Arc::new(handle),
            sftp: Mutex::new(None),
        }))
        .await;
    Ok(info)
}

/// Turns a failed handshake into the error the contract asks for.
///
/// A rejected host key is reported as `HostKeyMismatch` with both fingerprints, so the
/// frontend can show them and retry with `trustHostKey`.
fn handshake_error(
    report: &StdMutex<HostKeyReport>,
    err: russh::Error,
    host: &str,
    port: u16,
) -> AppError {
    let report = lock(report);
    if let (
        Some(observed),
        Some(HostKeyVerdict::Mismatch {
            expected_fingerprint,
        }),
    ) = (report.observed.as_ref(), report.verdict.as_ref())
    {
        return AppError::host_key_mismatch(&observed.fingerprint, expected_fingerprint);
    }
    match AppError::from(err) {
        err if err.code == ErrorCode::Timeout => err,
        err => AppError::connect_failed(format!(
            "could not connect to {host}:{port}: {}",
            err.message
        )),
    }
}

/// Closes a connection: drop it from the registry, end its terminals, notify the UI.
///
/// Safe to call more than once; only the call that actually removes the connection emits
/// `connection:closed`.
pub async fn close_connection(app: &AppHandle, connection_id: &str, reason: Option<String>) {
    let state = app.state::<AppState>();
    let Some(connection) = state.remove_connection(connection_id).await else {
        return;
    };

    // Ask every terminal of this connection to finish; each one emits `terminal:exit`.
    // Dropping the sender would be enough, but the explicit command makes the terminal
    // close its channel cleanly when the session is still alive.
    for (terminal_id, entry) in state.take_terminals_of(connection_id).await {
        if entry.commands.send(TermCmd::Close).await.is_err() {
            tracing::debug!(terminal_id, "terminal task had already finished");
        }
    }

    connection.shutdown().await;
    tracing::info!(connection_id, ?reason, "connection closed");
    if let Err(err) = app.emit(
        "connection:closed",
        ConnectionClosed {
            connection_id: connection_id.to_string(),
            reason,
        },
    ) {
        tracing::warn!(connection_id, %err, "could not emit connection:closed");
    }
}

/// Closes the connection a dead channel belonged to, when the session itself is gone.
///
/// Called by the terminal and exec tasks: a channel that ends while the session is still
/// healthy is normal (the shell exited), but a channel that ends because the session died
/// has to tear the whole connection down.
pub async fn close_connection_if_session_died(app: &AppHandle, connection_id: &str) {
    let state = app.state::<AppState>();
    let dead = match state.connection(connection_id).await {
        Ok(connection) => connection.is_closed(),
        Err(_) => false,
    };
    if dead {
        close_connection(
            app,
            connection_id,
            Some("the SSH session ended unexpectedly".to_string()),
        )
        .await;
    }
}

/// Closes a connection on request. Unknown ids are ignored, so the frontend can call this
/// while cleaning up without racing against a session that just died.
#[tauri::command]
pub async fn ssh_disconnect(app: AppHandle, connection_id: String) -> AppResult<()> {
    close_connection(
        &app,
        &connection_id,
        Some("disconnected on request".to_string()),
    )
    .await;
    Ok(())
}

/// Every open connection, oldest first.
#[tauri::command]
pub async fn ssh_list_connections(
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<ConnectionInfo>> {
    Ok(state.connection_infos().await)
}
