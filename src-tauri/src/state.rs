//! Shared, mutable runtime state of the core.
//!
//! One [`AppState`] is managed by Tauri (`app.manage`) and reachable from every command
//! through `tauri::State<'_, AppState>`. It owns four registries:
//!
//! * live SSH connections, keyed by connection id,
//! * live terminals, SSH and local alike (the sending end of their command channel),
//!   keyed by terminal id,
//! * running transfers (their cancellation token), keyed by transfer id,
//! * keyboard-interactive prompts waiting for an answer, keyed by request id.
//!
//! All locks are `tokio` locks, so holding one across an `.await` is safe; they are still
//! kept for as short a time as possible and never held while doing network I/O.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{Mutex, MutexGuard, RwLock, mpsc, oneshot};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::ssh::connection::{Connection, ConnectionInfo};
use crate::ssh::terminal::TermCmd;

/// A live terminal: the connection it belongs to plus the channel its task listens on.
#[derive(Debug, Clone)]
pub struct TerminalEntry {
    /// `Some` for an SSH shell channel, `None` for a local shell on this machine.
    pub connection_id: Option<String>,
    pub commands: mpsc::Sender<TermCmd>,
}

/// The answers to one `auth:prompt`, or `None` when the user cancelled it.
pub type PromptAnswers = Option<Vec<String>>;

/// Runtime state shared by all commands.
#[derive(Default)]
pub struct AppState {
    connections: RwLock<HashMap<String, Arc<Connection>>>,
    terminals: Mutex<HashMap<String, TerminalEntry>>,
    transfers: Mutex<HashMap<String, CancellationToken>>,
    prompts: Mutex<HashMap<String, oneshot::Sender<PromptAnswers>>>,
    storage: Mutex<()>,
}

impl AppState {
    // -- connections --------------------------------------------------------

    /// Registers a freshly authenticated connection.
    pub async fn insert_connection(&self, connection: Arc<Connection>) {
        self.connections
            .write()
            .await
            .insert(connection.info.id.clone(), connection);
    }

    /// Looks a connection up, failing with `NotConnected` when it is gone.
    pub async fn connection(&self, connection_id: &str) -> AppResult<Arc<Connection>> {
        self.connections
            .read()
            .await
            .get(connection_id)
            .cloned()
            .ok_or_else(|| {
                AppError::not_connected(format!("connection {connection_id} is not open"))
            })
    }

    /// Removes a connection from the registry, returning it when it was still there.
    pub async fn remove_connection(&self, connection_id: &str) -> Option<Arc<Connection>> {
        self.connections.write().await.remove(connection_id)
    }

    /// Snapshot of all open connections.
    pub async fn connection_infos(&self) -> Vec<ConnectionInfo> {
        let mut infos: Vec<ConnectionInfo> = self
            .connections
            .read()
            .await
            .values()
            .map(|c| c.info.clone())
            .collect();
        infos.sort_by_key(|i| i.connected_at);
        infos
    }

    /// The ids of the connections tunnelled through this one (ProxyJump children).
    pub async fn connection_ids_via(&self, connection_id: &str) -> Vec<String> {
        let connections = self.connections.read().await;
        let mut ids: Vec<&Arc<Connection>> = connections
            .values()
            .filter(|c| c.info.via_connection_id.as_deref() == Some(connection_id))
            .collect();
        ids.sort_by_key(|c| c.info.connected_at);
        ids.into_iter().map(|c| c.info.id.clone()).collect()
    }

    // -- auth prompts -------------------------------------------------------

    /// Registers a keyboard-interactive prompt and returns the receiver to await.
    ///
    /// A request id that is somehow already pending is replaced; the previous waiter is
    /// told the prompt was cancelled so no `ssh_connect` can hang forever.
    pub async fn register_prompt(&self, request_id: String) -> oneshot::Receiver<PromptAnswers> {
        let (sender, receiver) = oneshot::channel();
        if let Some(previous) = self.prompts.lock().await.insert(request_id, sender) {
            let _ = previous.send(None);
        }
        receiver
    }

    /// Takes the waiting end of a prompt, so exactly one answer can be delivered.
    pub async fn take_prompt(&self, request_id: &str) -> Option<oneshot::Sender<PromptAnswers>> {
        self.prompts.lock().await.remove(request_id)
    }

    // -- terminals ----------------------------------------------------------

    /// Registers a terminal and its command channel.
    pub async fn insert_terminal(&self, terminal_id: String, entry: TerminalEntry) {
        self.terminals.lock().await.insert(terminal_id, entry);
    }

    /// The command channel of a terminal, failing with `NotFound` when it is gone.
    pub async fn terminal_commands(&self, terminal_id: &str) -> AppResult<mpsc::Sender<TermCmd>> {
        self.terminals
            .lock()
            .await
            .get(terminal_id)
            .map(|entry| entry.commands.clone())
            .ok_or_else(|| AppError::not_found(format!("terminal {terminal_id} does not exist")))
    }

    /// Forgets a terminal. Called by the terminal task once it has emitted `terminal:exit`.
    pub async fn remove_terminal(&self, terminal_id: &str) {
        self.terminals.lock().await.remove(terminal_id);
    }

    /// Removes and returns every terminal of a connection (used when the session dies).
    ///
    /// Local terminals have no connection id, so they are never collected here.
    pub async fn take_terminals_of(&self, connection_id: &str) -> Vec<(String, TerminalEntry)> {
        let mut terminals = self.terminals.lock().await;
        let ids: Vec<String> = terminals
            .iter()
            .filter(|(_, entry)| entry.connection_id.as_deref() == Some(connection_id))
            .map(|(id, _)| id.clone())
            .collect();
        ids.into_iter()
            .filter_map(|id| terminals.remove(&id).map(|entry| (id, entry)))
            .collect()
    }

    // -- transfers ----------------------------------------------------------

    /// Registers a transfer and returns its cancellation token.
    ///
    /// A transfer id that is already running is replaced; the previous token is cancelled
    /// so no transfer can be left without a way to stop it.
    pub async fn register_transfer(&self, transfer_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        let mut transfers = self.transfers.lock().await;
        if let Some(previous) = transfers.insert(transfer_id.to_string(), token.clone()) {
            previous.cancel();
        }
        token
    }

    /// Forgets a finished transfer.
    pub async fn finish_transfer(&self, transfer_id: &str) {
        self.transfers.lock().await.remove(transfer_id);
    }

    /// Cancels a running transfer. Returns `false` when the id is unknown.
    pub async fn cancel_transfer(&self, transfer_id: &str) -> bool {
        match self.transfers.lock().await.get(transfer_id) {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    // -- storage ------------------------------------------------------------

    /// Serialises read-modify-write cycles on the JSON state files.
    pub async fn storage_guard(&self) -> MutexGuard<'_, ()> {
        self.storage.lock().await
    }
}
