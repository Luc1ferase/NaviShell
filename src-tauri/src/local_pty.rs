//! Local shell terminals (issue #6).
//!
//! `term_open_local` spawns a shell on this machine through `portable-pty` and streams it
//! to the frontend exactly like an SSH terminal: raw bytes over
//! `Channel<tauri::ipc::Response>`, commands over the shared [`TermCmd`] channel (so
//! `term_write`, `term_resize` and `term_close` work unchanged) and a single
//! `terminal:exit` event when the shell ends.
//!
//! Contract: `src/core/ipc/contract.ts` (`term_open_local`).

use serde::Serialize;
use tauri::ipc::{Channel, Response};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Result of `term_open_local`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTerminalOpened {
    pub terminal_id: String,
}

/// Opens a local shell. `program`/`args` fall back to the host settings and finally to
/// platform defaults; `cwd` falls back to the home directory.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn term_open_local(
    _app: tauri::AppHandle,
    _state: tauri::State<'_, AppState>,
    _cols: u32,
    _rows: u32,
    _term: String,
    _program: Option<String>,
    _args: Option<Vec<String>>,
    _cwd: Option<String>,
    _on_data: Channel<Response>,
) -> AppResult<LocalTerminalOpened> {
    Err(AppError::internal("local terminals are not implemented yet"))
}
