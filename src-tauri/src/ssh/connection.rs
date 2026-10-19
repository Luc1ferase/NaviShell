//! Establishing and tearing down SSH sessions.
//!
//! `ssh_connect` resolves the credentials of the server's auth method (password, private
//! key or ssh-agent), runs the handshake with a trust-on-first-use host key policy and
//! registers the resulting session in [`AppState`]. Channels for terminals, exec calls and
//! SFTP are opened on that session afterwards.
//!
//! Two things can happen on top of the chosen method:
//!
//! * **keyboard-interactive**: when the server rejects the method (or only offers
//!   keyboard-interactive for password logins) the session continues with
//!   `keyboard-interactive`. A single hidden prompt asking for a password is answered from
//!   the available password once; everything else is forwarded to the frontend as the
//!   `auth:prompt` event and answered by `ssh_auth_respond`.
//! * **ProxyJump**: with `via_connection_id` the session is not opened over a TCP socket
//!   but over a `direct-tcpip` channel of another, already open connection.
//!
//! When a session dies - because the remote closed it, the network broke, or the user
//! called `ssh_disconnect` - [`close_connection`] removes it from the registry, ends all
//! of its terminals and emits `connection:closed` exactly once. Sessions tunnelled through
//! it are closed the same way, because their transport is gone with it.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::Duration;

use russh::client::{self, AuthResult, DisconnectReason, Handler, KeyboardInteractiveAuthResponse};
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::{HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{Disconnect, MethodKind};
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::known_hosts::{self, HostKeyVerdict, KnownHost};
use crate::secrets::{self, CredentialKind};
use crate::servers::{self, AuthMethod, AuthMethodType, ServerRecord};
use crate::ssh::terminal::TermCmd;
use crate::state::AppState;
use crate::util::now_millis;

/// How long the TCP connection and handshake may take.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// Interval of SSH keepalive messages; three unanswered ones close the session.
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);
/// How long the frontend has to answer one `auth:prompt` before the connect gives up.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(180);
/// Reason reported for a session whose jump host went away.
const JUMP_HOST_CLOSED: &str = "jump host connection closed";
/// The named pipe the OpenSSH agent for Windows listens on.
#[cfg(windows)]
const WINDOWS_AGENT_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

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
    /// The method that authenticated this session; a keyboard-interactive fallback counts
    /// as the method configured on the server record.
    pub auth_method: AuthMethodType,
    /// The connection this session is tunnelled through (ProxyJump), `None` when direct.
    pub via_connection_id: Option<String>,
}

/// Payload of the `connection:closed` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionClosed {
    connection_id: String,
    reason: Option<String>,
}

/// One question of a keyboard-interactive info request.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthPromptItem {
    prompt: String,
    /// `false` means the frontend has to hide the input (password-like).
    echo: bool,
}

/// Payload of the `auth:prompt` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthPrompt {
    request_id: String,
    server_id: String,
    name: String,
    instructions: String,
    prompts: Vec<AuthPromptItem>,
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

    /// Opens a TCP forwarding channel to `host:port`, the transport of a jumped session.
    async fn open_forward(&self, host: &str, port: u16) -> AppResult<russh::Channel<client::Msg>> {
        if self.is_closed() {
            return Err(AppError::not_connected(format!(
                "the jump host connection {} is closed",
                self.info.id
            )));
        }
        self.handle
            .channel_open_direct_tcpip(host, u32::from(port), "127.0.0.1", 0)
            .await
            .map_err(|err| {
                AppError::connect_failed(format!(
                    "the jump host {} could not reach {host}:{port}: {}",
                    self.info.host,
                    AppError::from(err).message
                ))
            })
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
    ///
    /// A jumped session checks the key of its target host, not of the jump host, because
    /// this runs on the tunnelled session.
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

/// The credentials `ssh_connect` resolved before opening the connection.
#[derive(Default)]
struct ResolvedAuth {
    /// The login password: set for `password` auth, and used to auto-answer a hidden
    /// keyboard-interactive password prompt.
    password: Option<String>,
    /// The private key of `key` auth, ready to sign with.
    key: Option<Arc<PrivateKey>>,
    /// The passphrase that decrypted the key, if it was encrypted.
    passphrase: Option<String>,
}

/// Connects to a saved server and authenticates with its configured method.
///
/// * `password`/`passphrase` missing: the keychain is used; without a stored secret the
///   call fails with `PasswordRequired` or `PassphraseRequired`.
/// * `save_password`/`save_passphrase`: store the secret in the keychain after a
///   successful handshake.
/// * `trust_host_key`: accepts (and stores) a host key that differs from the stored one.
/// * `via_connection_id`: tunnels the session through that open connection (ProxyJump).
// Tauri commands take their arguments flat, so the contract decides the parameter count.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    server_id: String,
    password: Option<String>,
    save_password: Option<bool>,
    passphrase: Option<String>,
    save_passphrase: Option<bool>,
    trust_host_key: Option<bool>,
    via_connection_id: Option<String>,
) -> AppResult<ConnectionInfo> {
    let server = servers::get(&app, &server_id).await?;
    let save_password = save_password.unwrap_or(false);
    let save_passphrase = save_passphrase.unwrap_or(false);

    // Credentials are resolved before the handshake, so a missing password or an
    // unreadable key file fails without touching the network.
    let auth = resolve_auth(&app, &server, password, passphrase).await?;

    // The jump host has to be open already; the frontend connects to it first.
    let via = match via_connection_id.as_deref() {
        Some(id) => Some(state.connection(id).await?),
        None => None,
    };
    if let Some(jump) = &via
        && jump.is_closed()
    {
        return Err(AppError::not_connected(format!(
            "the jump host connection {} is closed",
            jump.info.id
        )));
    }

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

    tracing::info!(
        host = %server.host,
        port = server.port,
        user = %server.username,
        auth = ?server.auth.method_type(),
        via = ?via.as_ref().map(|jump| jump.info.id.clone()),
        "connecting"
    );
    let handshake = async {
        match via.as_ref() {
            // ProxyJump: the transport is a forwarding channel of the jump session.
            Some(jump) => {
                let channel = jump.open_forward(&server.host, server.port).await?;
                client::connect_stream(config, channel.into_stream(), handler)
                    .await
                    .map_err(|err| handshake_error(&report, err, &server.host, server.port))
            }
            None => client::connect(config, (server.host.as_str(), server.port), handler)
                .await
                .map_err(|err| handshake_error(&report, err, &server.host, server.port)),
        }
    };
    let mut handle = match tokio::time::timeout(CONNECT_TIMEOUT, handshake).await {
        Ok(result) => result?,
        Err(_) => {
            return Err(AppError::timeout(format!(
                "connecting to {}:{} timed out",
                server.host, server.port
            )));
        }
    };

    // A session that will not be used says goodbye politely before it is dropped.
    if let Err(err) = authenticate(&app, state.inner(), &mut handle, &server, &auth).await {
        let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
        return Err(err);
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

    // The session is up; failing to persist a secret must not undo that.
    if save_password
        && let Some(password) = auth.password.as_deref()
        && let Err(err) = secrets::set(&server_id, CredentialKind::Password, password).await
    {
        tracing::warn!(server_id, error = %err.message, "could not store the password");
    }
    if save_passphrase
        && let Some(passphrase) = auth.passphrase.as_deref()
        && let Err(err) = secrets::set(&server_id, CredentialKind::Passphrase, passphrase).await
    {
        tracing::warn!(server_id, error = %err.message, "could not store the passphrase");
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
        auth_method: server.auth.method_type(),
        via_connection_id: via.as_ref().map(|jump| jump.info.id.clone()),
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

/// Collects the secrets the configured auth method needs.
///
/// Reading the key file here means a wrong path or a missing passphrase is reported before
/// the connection is opened.
async fn resolve_auth(
    app: &AppHandle,
    server: &ServerRecord,
    password: Option<String>,
    passphrase: Option<String>,
) -> AppResult<ResolvedAuth> {
    match &server.auth {
        AuthMethod::Password => {
            let password = match password {
                Some(password) => password,
                None => secrets::get(&server.id, CredentialKind::Password)
                    .await?
                    .ok_or_else(|| {
                        AppError::password_required(format!(
                            "no password stored for {}@{}",
                            server.username, server.host
                        ))
                    })?,
            };
            Ok(ResolvedAuth {
                password: Some(password),
                ..Default::default()
            })
        }
        AuthMethod::Key { key_path } => {
            let (key, passphrase) = load_key(app, server, key_path, passphrase).await?;
            Ok(ResolvedAuth {
                // A server may still ask for a password through keyboard-interactive.
                password,
                key: Some(key),
                passphrase,
            })
        }
        AuthMethod::Agent => Ok(ResolvedAuth {
            password,
            ..Default::default()
        }),
    }
}

/// Loads the private key of a `key` auth record and returns it with the passphrase that
/// unlocked it (so a successful connect can store that passphrase).
///
/// The passphrase argument wins; an encrypted key without one falls back to the keychain
/// and finally to `PassphraseRequired`.
async fn load_key(
    app: &AppHandle,
    server: &ServerRecord,
    key_path: &str,
    passphrase: Option<String>,
) -> AppResult<(Arc<PrivateKey>, Option<String>)> {
    let path = expand_tilde(app, key_path);
    let had_passphrase = passphrase.is_some();
    match read_key_file(&path, passphrase.clone()).await {
        Ok(key) => Ok((Arc::new(key), passphrase)),
        // Encrypted and nothing was passed in: the keychain may know the passphrase.
        Err(err) if err.code == ErrorCode::PassphraseRequired && !had_passphrase => {
            let stored = secrets::get(&server.id, CredentialKind::Passphrase).await?;
            let Some(stored) = stored else {
                return Err(AppError::passphrase_required(format!(
                    "the private key {} is encrypted and no passphrase is stored",
                    path.display()
                )));
            };
            let key = read_key_file(&path, Some(stored.clone())).await?;
            Ok((Arc::new(key), Some(stored)))
        }
        Err(err) => Err(err),
    }
}

/// Reads and decodes a private key file on the blocking pool (decryption is CPU work).
///
/// `PassphraseRequired` means the key is encrypted and the passphrase was missing or
/// wrong; anything else about the file is an `AuthFailed` with the path in the message.
async fn read_key_file(path: &Path, passphrase: Option<String>) -> AppResult<PrivateKey> {
    let display = path.display().to_string();
    let path = path.to_path_buf();
    let loaded = spawn_blocking(move || {
        russh::keys::load_secret_key(&path, passphrase.as_deref()).map_err(AppError::from)
    })
    .await?;
    loaded.map_err(|err| match err.code {
        ErrorCode::PassphraseRequired => err,
        _ => AppError::auth_failed(format!(
            "could not use the private key {display}: {}",
            err.message
        )),
    })
}

/// Expands a leading `~` with the user's home directory; `~user` is left untouched.
fn expand_tilde(app: &AppHandle, path: &str) -> PathBuf {
    let trimmed = path.trim();
    let Some(rest) = trimmed.strip_prefix('~') else {
        return PathBuf::from(trimmed);
    };
    let rest = match rest.strip_prefix(['/', '\\']) {
        Some(rest) => rest,
        None if rest.is_empty() => rest,
        None => return PathBuf::from(trimmed),
    };
    let Ok(home) = app.path().home_dir() else {
        return PathBuf::from(trimmed);
    };
    if rest.is_empty() {
        home
    } else {
        home.join(rest)
    }
}

/// Runs the configured auth method and, when the server asks for it, the
/// keyboard-interactive fallback.
async fn authenticate(
    app: &AppHandle,
    state: &AppState,
    handle: &mut client::Handle<ClientHandler>,
    server: &ServerRecord,
    auth: &ResolvedAuth,
) -> AppResult<()> {
    let user = server.username.as_str();
    let result = match &server.auth {
        AuthMethod::Password => {
            let password = auth.password.as_deref().ok_or_else(|| {
                AppError::password_required(format!(
                    "no password available for {user}@{}",
                    server.host
                ))
            })?;
            handle
                .authenticate_password(user, password)
                .await
                .map_err(auth_error)?
        }
        AuthMethod::Key { .. } => {
            let key = auth
                .key
                .as_ref()
                .ok_or_else(|| AppError::internal("the private key was not loaded"))?;
            let hash_alg = rsa_hash_alg(handle, key.algorithm().is_rsa()).await?;
            handle
                .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::clone(key), hash_alg))
                .await
                .map_err(auth_error)?
        }
        AuthMethod::Agent => authenticate_with_agent(handle, user).await?,
    };

    let remaining = match &result {
        AuthResult::Success => {
            tracing::debug!(user, method = ?server.auth.method_type(), "authenticated");
            return Ok(());
        }
        AuthResult::Failure {
            remaining_methods,
            partial_success,
        } => {
            tracing::debug!(
                user,
                method = ?server.auth.method_type(),
                partial_success,
                remaining = ?remaining_methods.iter().collect::<Vec<_>>(),
                "the server did not accept the authentication yet"
            );
            remaining_methods.clone()
        }
    };

    // The server either rejected the method or never offered it, but it is willing to ask
    // the user questions instead (OTP/2FA, or password logins behind PAM).
    if remaining.contains(&MethodKind::KeyboardInteractive) {
        let mut interactive = InteractiveAuth {
            app,
            state,
            server,
            // `password` auth has already resolved its password (argument or keychain);
            // the other methods only looked at the argument, so the keychain is still
            // worth a look - but only once a prompt actually needs it.
            keychain_checked: auth.password.is_some(),
            password: auth.password.clone(),
            auto_answered: false,
        };
        return interactive.run(handle).await;
    }
    Err(rejected(server))
}

/// The error for a method the server would not accept.
fn rejected(server: &ServerRecord) -> AppError {
    let what = match &server.auth {
        AuthMethod::Password => "the password".to_string(),
        AuthMethod::Key { key_path } => format!("the private key {key_path}"),
        AuthMethod::Agent => "every identity of the ssh-agent".to_string(),
    };
    AppError::auth_failed(format!(
        "the server rejected {what} of {}@{}",
        server.username, server.host
    ))
}

/// A session that drops during authentication is an auth problem, not a bug.
fn auth_error(err: russh::Error) -> AppError {
    match AppError::from(err) {
        err if err.code == ErrorCode::NotConnected => AppError::auth_failed(format!(
            "the server closed the connection during authentication: {}",
            err.message
        )),
        err => err,
    }
}

/// The RSA signature hash this server prefers; `None` for non-RSA keys and old servers.
///
/// Asking costs a short wait for the server's `EXT_INFO`, so it only happens when an RSA
/// key is actually in play.
async fn rsa_hash_alg(
    handle: &client::Handle<ClientHandler>,
    needed: bool,
) -> AppResult<Option<HashAlg>> {
    if !needed {
        return Ok(None);
    }
    Ok(handle
        .best_supported_rsa_hash()
        .await
        .map_err(auth_error)?
        .flatten())
}

/// How this platform talks to its ssh-agent: a named pipe on Windows, a Unix socket
/// everywhere else.
#[cfg(windows)]
type AgentTransport = tokio::net::windows::named_pipe::NamedPipeClient;
#[cfg(unix)]
type AgentTransport = tokio::net::UnixStream;

/// Connects to the OpenSSH agent for Windows.
///
/// Windows has no `SSH_AUTH_SOCK` by default, the agent listens on a named pipe; a
/// variable that points at a pipe is honoured as well.
#[cfg(windows)]
async fn connect_agent() -> AppResult<AgentClient<AgentTransport>> {
    let pipe = std::env::var("SSH_AUTH_SOCK")
        .ok()
        .filter(|path| path.starts_with(r"\\.\pipe\") || path.starts_with(r"\\?\pipe\"))
        .unwrap_or_else(|| WINDOWS_AGENT_PIPE.to_string());
    AgentClient::<AgentTransport>::connect_named_pipe(&pipe)
        .await
        .map_err(|err| AppError::agent_unavailable(format!("no ssh-agent on {pipe}: {err}")))
}

/// Connects to the ssh-agent `SSH_AUTH_SOCK` points at.
#[cfg(unix)]
async fn connect_agent() -> AppResult<AgentClient<AgentTransport>> {
    AgentClient::<AgentTransport>::connect_env()
        .await
        .map_err(|err| AppError::agent_unavailable(format!("no ssh-agent on SSH_AUTH_SOCK: {err}")))
}

/// Authenticates with every identity the ssh-agent offers, until one is accepted.
async fn authenticate_with_agent(
    handle: &mut client::Handle<ClientHandler>,
    user: &str,
) -> AppResult<AuthResult> {
    let mut agent = connect_agent().await?;
    agent_identities_auth(handle, user, &mut agent).await
}

/// The part of agent authentication that does not depend on the agent's transport.
async fn agent_identities_auth<S: AgentStream + Unpin + Send>(
    handle: &mut client::Handle<ClientHandler>,
    user: &str,
    agent: &mut AgentClient<S>,
) -> AppResult<AuthResult> {
    let identities = agent.request_identities().await.map_err(|err| {
        AppError::agent_unavailable(format!("the ssh-agent did not list its identities: {err}"))
    })?;
    if identities.is_empty() {
        return Err(AppError::agent_unavailable(
            "the ssh-agent holds no identities",
        ));
    }

    let any_rsa = identities
        .iter()
        .any(|identity| identity.public_key().algorithm().is_rsa());
    let hash_alg = rsa_hash_alg(handle, any_rsa).await?;
    let mut last: Option<AuthResult> = None;
    for identity in identities {
        let key = identity.public_key().into_owned();
        let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
        let result = handle
            .authenticate_publickey_with(user, key, hash_alg, agent)
            .await
            .map_err(AppError::from)?;
        match &result {
            AuthResult::Success => {
                tracing::debug!(%fingerprint, "the server accepted an agent identity");
                return Ok(result);
            }
            // The key was accepted but the server wants a second factor as well; the
            // caller continues with the keyboard-interactive fallback.
            AuthResult::Failure {
                partial_success: true,
                ..
            } => return Ok(result),
            AuthResult::Failure { .. } => {
                tracing::debug!(%fingerprint, "the server rejected an agent identity");
                last = Some(result);
            }
        }
    }
    Ok(last.unwrap_or_else(|| AuthResult::Failure {
        remaining_methods: russh::MethodSet::empty(),
        partial_success: false,
    }))
}

/// The keyboard-interactive conversation of one `ssh_connect` call.
struct InteractiveAuth<'a> {
    app: &'a AppHandle,
    state: &'a AppState,
    server: &'a ServerRecord,
    /// Password available for a single hidden "password" prompt.
    password: Option<String>,
    /// Whether the keychain was already consulted for that password.
    keychain_checked: bool,
    /// Whether the password was already offered, so a rejected one is not retried.
    auto_answered: bool,
}

impl InteractiveAuth<'_> {
    /// Starts keyboard-interactive and answers info requests until the server decides.
    async fn run(&mut self, handle: &mut client::Handle<ClientHandler>) -> AppResult<()> {
        let mut response = handle
            .authenticate_keyboard_interactive_start(self.server.username.as_str(), None::<String>)
            .await
            .map_err(auth_error)?;
        loop {
            match response {
                KeyboardInteractiveAuthResponse::Success => {
                    tracing::debug!(
                        user = %self.server.username,
                        "authenticated with keyboard-interactive"
                    );
                    return Ok(());
                }
                KeyboardInteractiveAuthResponse::Failure { .. } => {
                    return Err(rejected(self.server));
                }
                KeyboardInteractiveAuthResponse::InfoRequest {
                    name,
                    instructions,
                    prompts,
                } => {
                    let answers = self.answers(&name, &instructions, &prompts).await?;
                    response = handle
                        .authenticate_keyboard_interactive_respond(answers)
                        .await
                        .map_err(auth_error)?;
                }
            }
        }
    }

    /// The password that may answer a password prompt, consulting the keychain at most
    /// once. A keychain that cannot be read just means "no password".
    async fn password(&mut self) -> Option<String> {
        if self.password.is_none() && !self.keychain_checked {
            self.keychain_checked = true;
            match secrets::get(&self.server.id, CredentialKind::Password).await {
                Ok(password) => self.password = password,
                Err(err) => {
                    tracing::debug!(error = %err.message, "could not read the stored password");
                }
            }
        }
        self.password.clone()
    }

    /// Answers one info request, asking the user only when it has to.
    async fn answers(
        &mut self,
        name: &str,
        instructions: &str,
        prompts: &[client::Prompt],
    ) -> AppResult<Vec<String>> {
        // A request without prompts only carries text (a banner); it is answered at once.
        if prompts.is_empty() {
            tracing::debug!(
                name,
                instructions,
                "keyboard-interactive info without prompts"
            );
            return Ok(Vec::new());
        }

        // Exactly one hidden prompt asking for a password: answer it from the password we
        // have, once. If the server asks again it was wrong, and the user is asked.
        if !self.auto_answered
            && let [only] = prompts
            && !only.echo
            && only.prompt.to_lowercase().contains("password")
            && let Some(password) = self.password().await
        {
            self.auto_answered = true;
            tracing::debug!("answering the keyboard-interactive password prompt");
            return Ok(vec![password]);
        }

        let answers = self.ask_user(name, instructions, prompts).await?;
        // The protocol requires exactly one answer per prompt.
        let mut answers = answers;
        if answers.len() != prompts.len() {
            tracing::warn!(
                got = answers.len(),
                expected = prompts.len(),
                "the frontend answered the wrong number of auth prompts"
            );
            answers.resize(prompts.len(), String::new());
        }
        Ok(answers)
    }

    /// Emits `auth:prompt` and waits for `ssh_auth_respond`.
    async fn ask_user(
        &self,
        name: &str,
        instructions: &str,
        prompts: &[client::Prompt],
    ) -> AppResult<Vec<String>> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let receiver = self.state.register_prompt(request_id.clone()).await;
        let payload = AuthPrompt {
            request_id: request_id.clone(),
            server_id: self.server.id.clone(),
            name: name.to_string(),
            instructions: instructions.to_string(),
            prompts: prompts
                .iter()
                .map(|prompt| AuthPromptItem {
                    prompt: prompt.prompt.clone(),
                    echo: prompt.echo,
                })
                .collect(),
        };
        if let Err(err) = self.app.emit("auth:prompt", payload) {
            self.state.take_prompt(&request_id).await;
            return Err(AppError::internal(format!(
                "could not ask for the authentication answers: {err}"
            )));
        }

        tracing::debug!(
            request_id,
            count = prompts.len(),
            "waiting for auth answers"
        );
        match tokio::time::timeout(PROMPT_TIMEOUT, receiver).await {
            Ok(Ok(Some(answers))) => Ok(answers),
            Ok(Ok(None)) => Err(AppError::cancelled(
                "the authentication prompt was cancelled",
            )),
            Ok(Err(_)) => Err(AppError::internal(
                "the authentication prompt was dropped before it was answered",
            )),
            Err(_) => {
                self.state.take_prompt(&request_id).await;
                Err(AppError::timeout(
                    "the authentication prompt was not answered in time",
                ))
            }
        }
    }
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
/// Sessions tunnelled through this one (and through those, recursively) go with it,
/// because their transport is one of its channels. Safe to call more than once; only the
/// call that actually removes a connection emits its `connection:closed`.
pub async fn close_connection(app: &AppHandle, connection_id: &str, reason: Option<String>) {
    let state = app.state::<AppState>();
    let Some(connection) = state.remove_connection(connection_id).await else {
        return;
    };

    // Everything is taken out of the registry first, so a tunnelled session cannot report
    // a random transport error while its jump host is being torn down.
    let mut doomed: VecDeque<(Arc<Connection>, Option<String>)> = VecDeque::new();
    doomed.push_back((connection, reason));
    let mut index = 0;
    while let Some((parent, _)) = doomed.get(index) {
        let parent_id = parent.info.id.clone();
        for child_id in state.connection_ids_via(&parent_id).await {
            if let Some(child) = state.remove_connection(&child_id).await {
                doomed.push_back((child, Some(JUMP_HOST_CLOSED.to_string())));
            }
        }
        index += 1;
    }

    for (connection, reason) in doomed {
        finish_connection(app, state.inner(), connection, reason).await;
    }
}

/// Ends one session: stop its terminals, say goodbye to the server, tell the UI.
async fn finish_connection(
    app: &AppHandle,
    state: &AppState,
    connection: Arc<Connection>,
    reason: Option<String>,
) {
    let connection_id = connection.info.id.clone();

    // Ask every terminal of this connection to finish; each one emits `terminal:exit`.
    // Dropping the sender would be enough, but the explicit command makes the terminal
    // close its channel cleanly when the session is still alive.
    for (terminal_id, entry) in state.take_terminals_of(&connection_id).await {
        if entry.commands.send(TermCmd::Close).await.is_err() {
            tracing::debug!(terminal_id, "terminal task had already finished");
        }
    }

    connection.shutdown().await;
    tracing::info!(connection_id, ?reason, "connection closed");
    if let Err(err) = app.emit(
        "connection:closed",
        ConnectionClosed {
            connection_id: connection_id.clone(),
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

/// Answers (or cancels, with `responses: None`) a pending keyboard-interactive prompt
/// emitted as the `auth:prompt` event. Unknown or expired `request_id` => `NotFound`.
#[tauri::command]
pub async fn ssh_auth_respond(
    state: tauri::State<'_, AppState>,
    request_id: String,
    responses: Option<Vec<String>>,
) -> AppResult<()> {
    let waiting = state
        .take_prompt(&request_id)
        .await
        .ok_or_else(|| AppError::not_found(format!("no pending auth prompt {request_id}")))?;
    waiting.send(responses).map_err(|_| {
        AppError::not_found(format!(
            "the auth prompt {request_id} is no longer being waited for"
        ))
    })?;
    Ok(())
}
