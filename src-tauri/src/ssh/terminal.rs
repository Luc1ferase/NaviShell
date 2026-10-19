//! Interactive shells on a PTY channel.
//!
//! `term_open` opens a session channel, requests a PTY and a shell, and then hands the
//! channel to a task that owns it for the rest of its life. The task multiplexes two
//! directions:
//!
//! * remote to frontend: `ChannelMsg::Data`/`ExtendedData` bytes are pushed into the
//!   `Channel<Response>` the frontend passed in, which xterm.js writes verbatim,
//! * frontend to remote: [`TermCmd`] messages from `term_write`, `term_resize` and
//!   `term_close`.
//!
//! When the loop ends, `terminal:exit` is emitted exactly once and the terminal is
//! removed from the registry.
//!
//! `term_write`, `term_resize` and `term_close` live here but are not SSH-specific: they
//! look the terminal up in the registry and send it a [`TermCmd`], so they drive local
//! shells (`crate::local_pty`) through exactly the same path.

use russh::client::Msg;
use russh::{ChannelMsg, ChannelReadHalf, ChannelWriteHalf};
use serde::Serialize;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

use crate::error::{AppError, AppResult};
use crate::ssh::connection;
use crate::state::{AppState, TerminalEntry};

/// How many outgoing commands may queue up before `term_write` has to wait.
pub(crate) const COMMAND_BUFFER: usize = 128;
/// Fallback when the frontend sends an empty `term`.
const DEFAULT_TERM: &str = "xterm-256color";

/// A message for the task (SSH) or thread (local) that owns a terminal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TermCmd {
    /// Raw bytes to write to the shell.
    Write(Vec<u8>),
    /// New window size in cells (cols, rows).
    Resize(u32, u32),
    /// Finish: close the SSH channel, or kill the local child process.
    Close,
}

/// Result of `term_open`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOpened {
    pub terminal_id: String,
}

/// Payload of the `terminal:exit` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    terminal_id: String,
    exit_code: Option<i32>,
}

/// Opens a shell with a PTY and streams its output through `on_data`.
///
/// The extra argument `onData` is a `Channel<ArrayBuffer>` on the JS side; every message
/// is one chunk of raw bytes exactly as the remote sent it.
#[tauri::command]
pub async fn term_open(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    cols: u32,
    rows: u32,
    term: String,
    on_data: Channel<Response>,
) -> AppResult<TerminalOpened> {
    let connection = state.connection(&connection_id).await?;
    let term_type = match term.trim() {
        "" => DEFAULT_TERM,
        value => value,
    };

    let channel = connection.open_channel().await?;
    channel
        .request_pty(true, term_type, cols.max(1), rows.max(1), 0, 0, &[])
        .await?;
    channel.request_shell(true).await?;

    let terminal_id = uuid::Uuid::new_v4().to_string();
    let (read, write) = channel.split();
    let (commands, receiver) = mpsc::channel(COMMAND_BUFFER);
    state
        .insert_terminal(
            terminal_id.clone(),
            TerminalEntry {
                connection_id: Some(connection_id.clone()),
                commands,
            },
        )
        .await;

    tracing::debug!(
        terminal_id,
        connection_id,
        cols,
        rows,
        term_type,
        "terminal opened"
    );
    let task_app = app.clone();
    let task_id = terminal_id.clone();
    tauri::async_runtime::spawn(async move {
        pump(
            task_app,
            task_id,
            connection_id,
            read,
            write,
            receiver,
            on_data,
        )
        .await;
    });

    Ok(TerminalOpened { terminal_id })
}

/// Owns one terminal channel until either side closes it.
#[allow(clippy::too_many_arguments)]
async fn pump(
    app: AppHandle,
    terminal_id: String,
    connection_id: String,
    mut read: ChannelReadHalf,
    write: ChannelWriteHalf<Msg>,
    mut commands: mpsc::Receiver<TermCmd>,
    on_data: Channel<Response>,
) {
    let mut exit_code: Option<i32> = None;
    // Cleared once the webview has dropped its end of the data channel.
    let mut forwarding = true;

    loop {
        tokio::select! {
            message = read.wait() => match message {
                Some(ChannelMsg::Data { data }) => {
                    if forwarding && on_data.send(Response::new(data.to_vec())).is_err() {
                        tracing::debug!(terminal_id, "the frontend stopped listening for output");
                        forwarding = false;
                    }
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    if forwarding && on_data.send(Response::new(data.to_vec())).is_err() {
                        forwarding = false;
                    }
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    exit_code = Some(exit_status as i32);
                }
                // A shell sends `Eof`, then its exit status, then `Close`, so stopping at
                // `Eof` would throw the exit code away.
                Some(ChannelMsg::Close) | None => break,
                Some(_) => {}
            },
            command = commands.recv() => match command {
                Some(TermCmd::Write(bytes)) => {
                    if let Err(err) = write.data_bytes(bytes).await {
                        tracing::debug!(terminal_id, %err, "writing to the shell failed");
                        break;
                    }
                }
                Some(TermCmd::Resize(cols, rows)) => {
                    if let Err(err) = write.window_change(cols.max(1), rows.max(1), 0, 0).await {
                        tracing::debug!(terminal_id, %err, "resizing the PTY failed");
                    }
                }
                // `None` means the registry entry was dropped, which is how a dying
                // connection asks its terminals to finish.
                Some(TermCmd::Close) | None => {
                    let _ = write.eof().await;
                    let _ = write.close().await;
                    break;
                }
            },
        }
    }

    app.state::<AppState>().remove_terminal(&terminal_id).await;
    tracing::debug!(terminal_id, ?exit_code, "terminal closed");
    if let Err(err) = app.emit(
        "terminal:exit",
        TerminalExit {
            terminal_id: terminal_id.clone(),
            exit_code,
        },
    ) {
        tracing::warn!(terminal_id, %err, "could not emit terminal:exit");
    }
    connection::close_connection_if_session_died(&app, &connection_id).await;
}

/// Sends UTF-8 text to the shell as raw bytes.
#[tauri::command]
pub async fn term_write(
    state: tauri::State<'_, AppState>,
    terminal_id: String,
    data: String,
) -> AppResult<()> {
    let commands = state.terminal_commands(&terminal_id).await?;
    commands
        .send(TermCmd::Write(data.into_bytes()))
        .await
        .map_err(|_| AppError::not_found(format!("terminal {terminal_id} has exited")))
}

/// Tells the PTY, remote or local, about a new window size.
#[tauri::command]
pub async fn term_resize(
    state: tauri::State<'_, AppState>,
    terminal_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    let commands = state.terminal_commands(&terminal_id).await?;
    commands
        .send(TermCmd::Resize(cols, rows))
        .await
        .map_err(|_| AppError::not_found(format!("terminal {terminal_id} has exited")))
}

/// Closes a terminal. A terminal that already exited is not an error.
#[tauri::command]
pub async fn term_close(state: tauri::State<'_, AppState>, terminal_id: String) -> AppResult<()> {
    if let Ok(commands) = state.terminal_commands(&terminal_id).await {
        let _ = commands.send(TermCmd::Close).await;
    }
    Ok(())
}
