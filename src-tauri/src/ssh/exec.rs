//! One-shot command execution on its own channel.
//!
//! `ssh_exec` never touches a terminal: it opens a fresh channel, runs `exec`, collects
//! stdout and stderr until the remote closes the channel and returns the exit status.

use std::time::Duration;

use russh::client::Msg;
use russh::{Channel, ChannelMsg};
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Timeout applied when the caller does not pass `timeoutMs`.
const DEFAULT_TIMEOUT_MS: u64 = 30_000;
/// stderr is delivered as extended data with this code (RFC 4254).
const EXTENDED_DATA_STDERR: u32 = 1;

/// Output of a finished command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub stdout: String,
    pub stderr: String,
    /// `None` when the remote never reported an exit status.
    pub exit_code: Option<i32>,
}

/// Runs a command and waits for its output.
///
/// Output is decoded as UTF-8 with invalid sequences replaced, because a command may well
/// print binary data and losing the whole result over one byte would be worse.
#[tauri::command]
pub async fn ssh_exec(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    command: String,
    timeout_ms: Option<u64>,
) -> AppResult<ExecResult> {
    let connection = state.connection(&connection_id).await?;
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).max(1));

    let mut channel = connection.open_channel().await?;
    let result = tokio::time::timeout(timeout, collect(&mut channel, &command)).await;
    match result {
        Ok(Ok(result)) => {
            // A channel that ends without an exit status because the session died is a
            // failure, not a command that happened to report nothing.
            if result.exit_code.is_none() && connection.is_closed() {
                return Err(AppError::not_connected(
                    "the SSH session ended before the command finished",
                ));
            }
            Ok(result)
        }
        Ok(Err(err)) => Err(err),
        Err(_) => {
            // The borrow of `channel` ends with the timed-out future, so the channel can
            // still be closed here instead of being left to the session teardown.
            let _ = channel.close().await;
            Err(AppError::timeout(format!(
                "the command did not finish within {} ms",
                timeout.as_millis()
            )))
        }
    }
}

/// Drives one exec channel to completion.
async fn collect(channel: &mut Channel<Msg>, command: &str) -> AppResult<ExecResult> {
    channel.exec(true, command).await?;

    let mut stdout: Vec<u8> = Vec::new();
    let mut stderr: Vec<u8> = Vec::new();
    let mut exit_code: Option<i32> = None;

    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
            ChannelMsg::ExtendedData { data, ext } => {
                if ext == EXTENDED_DATA_STDERR {
                    stderr.extend_from_slice(&data);
                } else {
                    stdout.extend_from_slice(&data);
                }
            }
            ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status as i32),
            // `Eof` arrives before the exit status, so only `Close` (or a dropped
            // channel) ends the loop; the timeout covers a server that sends neither.
            ChannelMsg::Close => break,
            _ => {}
        }
    }

    Ok(ExecResult {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        exit_code,
    })
}
