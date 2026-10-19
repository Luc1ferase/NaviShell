//! The single error type crossing the IPC boundary.
//!
//! [`AppError`] serialises to `{ code, message, data? }`, which the frontend consumes as
//! `HostError` (see `packages/plugin-api/src/index.ts`). Commands never panic; everything
//! fallible returns [`AppResult`].

use serde::Serialize;

/// Machine-readable error kind. The variant names are the wire values and must stay in
/// sync with `HostErrorCode` in the plugin API.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ErrorCode {
    /// `ssh_connect` needs a password: none was passed and none is stored.
    PasswordRequired,
    /// The server rejected the credentials.
    AuthFailed,
    /// The host key differs from the stored one.
    HostKeyMismatch,
    /// The TCP/SSH connection could not be established.
    ConnectFailed,
    /// No such connection, or the session is gone.
    NotConnected,
    /// A server record, file, terminal or transfer does not exist.
    NotFound,
    /// Local filesystem or socket error.
    Io,
    /// Remote SFTP error.
    Sftp,
    /// OS keychain error.
    Keyring,
    /// The operation was cancelled by the user.
    Cancelled,
    /// The operation exceeded its deadline.
    Timeout,
    /// The caller passed something unusable.
    InvalidArgument,
    /// Anything unexpected.
    Internal,
}

/// Error returned by every Tauri command of the core.
#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("{code:?}: {message}")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// Result alias used throughout the core.
pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    /// Builds an error with no extra data.
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    /// Attaches structured data (surfaced as `HostError.data`).
    pub fn with_data(mut self, data: serde_json::Value) -> Self {
        self.data = Some(data);
        self
    }

    pub fn password_required(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::PasswordRequired, message)
    }

    pub fn auth_failed(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::AuthFailed, message)
    }

    /// Mismatching host key; carries both fingerprints so the UI can show them.
    pub fn host_key_mismatch(observed: &str, expected: &str) -> Self {
        Self::new(
            ErrorCode::HostKeyMismatch,
            format!("the host key changed: the server offered {observed} but {expected} is stored"),
        )
        .with_data(serde_json::json!({
            "fingerprint": observed,
            "expectedFingerprint": expected,
        }))
    }

    pub fn connect_failed(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::ConnectFailed, message)
    }

    pub fn not_connected(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotConnected, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Io, message)
    }

    pub fn sftp(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Sftp, message)
    }

    pub fn keyring(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Keyring, message)
    }

    pub fn cancelled(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Cancelled, message)
    }

    pub fn timeout(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Timeout, message)
    }

    pub fn invalid_argument(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidArgument, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }
}

impl From<russh::Error> for AppError {
    fn from(err: russh::Error) -> Self {
        use russh::Error as E;
        match &err {
            E::ConnectionTimeout | E::KeepaliveTimeout | E::InactivityTimeout | E::Elapsed(_) => {
                Self::timeout(err.to_string())
            }
            E::Disconnect | E::HUP | E::SendError | E::WrongChannel | E::NotAuthenticated => {
                Self::not_connected(format!("the SSH session is no longer usable: {err}"))
            }
            E::UnknownKey | E::KeyChanged { .. } => {
                Self::new(ErrorCode::HostKeyMismatch, err.to_string())
            }
            E::IO(io) => Self::io(io.to_string()),
            _ => Self::internal(format!("ssh error: {err}")),
        }
    }
}

impl From<russh_sftp::client::error::Error> for AppError {
    fn from(err: russh_sftp::client::error::Error) -> Self {
        use russh_sftp::client::error::Error as E;
        use russh_sftp::protocol::StatusCode;
        match &err {
            E::Status(status) => {
                let message = if status.error_message.is_empty() {
                    status.status_code.to_string()
                } else {
                    status.error_message.clone()
                };
                match status.status_code {
                    StatusCode::NoSuchFile => Self::not_found(message),
                    _ => Self::sftp(message),
                }
            }
            E::Timeout => Self::timeout("the SFTP server did not answer in time"),
            E::IO(message) => Self::io(message.clone()),
            _ => Self::sftp(err.to_string()),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        match err.kind() {
            std::io::ErrorKind::NotFound => Self::not_found(err.to_string()),
            std::io::ErrorKind::TimedOut => Self::timeout(err.to_string()),
            _ => Self::io(err.to_string()),
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::internal(format!("JSON error: {err}"))
    }
}

impl From<keyring::Error> for AppError {
    fn from(err: keyring::Error) -> Self {
        match &err {
            keyring::Error::NoEntry => Self::not_found("no credential stored for this server"),
            _ => Self::keyring(format!("keychain error: {err}")),
        }
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        Self::internal(format!("tauri error: {err}"))
    }
}

impl From<tokio::task::JoinError> for AppError {
    fn from(err: tokio::task::JoinError) -> Self {
        Self::internal(format!("background task failed: {err}"))
    }
}
