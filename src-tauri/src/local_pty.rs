//! Local shell terminals (issue #6).
//!
//! `term_open_local` spawns a shell on this machine through `portable-pty` and streams it
//! to the frontend exactly like an SSH terminal: raw bytes over
//! `Channel<tauri::ipc::Response>`, commands over the shared [`TermCmd`] channel (so
//! `term_write`, `term_resize` and `term_close` work unchanged) and a single
//! `terminal:exit` event when the shell ends.
//!
//! A local terminal owns three OS threads for its whole life, because every `portable-pty`
//! operation is blocking:
//!
//! * the *reader* drains the pty master and forwards chunks to the webview,
//! * the *writer* receives [`TermCmd`]s and writes/resizes/kills,
//! * the *waiter* parks on `child.wait()` and is the single place that reports the exit.
//!
//! Contract: `src/core/ipc/contract.ts` (`term_open_local`).

use std::io::{Read, Write};
use std::path::PathBuf;

use portable_pty::{Child, ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

use crate::error::{AppError, AppResult};
use crate::ssh::terminal::{COMMAND_BUFFER, TermCmd};
use crate::state::{AppState, TerminalEntry};

/// Fallback when the frontend sends an empty `term`.
const DEFAULT_TERM: &str = "xterm-256color";
/// Upper bound of one chunk pushed to the webview.
const READ_CHUNK: usize = 32 * 1024;

/// Result of `term_open_local`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTerminalOpened {
    pub terminal_id: String,
}

/// Payload of the `terminal:exit` event (same shape as the SSH one).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    terminal_id: String,
    exit_code: Option<i32>,
}

/// Everything one running local shell is made of, handed over to the three threads.
struct Shell {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    reader: Box<dyn Read + Send>,
    child: Box<dyn Child + Send + Sync>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// Opens a local shell. `program`/`args` fall back to the host settings and finally to
/// platform defaults; `cwd` falls back to the home directory.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn term_open_local(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    cols: u32,
    rows: u32,
    term: String,
    program: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    on_data: Channel<Response>,
) -> AppResult<LocalTerminalOpened> {
    let term_type = match term.trim() {
        "" => DEFAULT_TERM.to_string(),
        value => value.to_string(),
    };
    let program = non_empty(program).unwrap_or_else(default_program);
    let args = args.unwrap_or_default();
    // A cwd that no longer exists would fail the spawn, so fall through to the home
    // directory and finally to "wherever the app was started".
    let cwd = non_empty(cwd)
        .map(PathBuf::from)
        .filter(|dir| dir.is_dir())
        .or_else(|| home_dir(&app).filter(|dir| dir.is_dir()));

    let size = pty_size(cols, rows);
    let spawn_program = program.clone();
    let spawn_term = term_type.clone();
    let shell = tauri::async_runtime::spawn_blocking(move || {
        spawn_shell(size, spawn_program, args, cwd, spawn_term)
    })
    .await??;

    let terminal_id = uuid::Uuid::new_v4().to_string();
    let (commands, receiver) = mpsc::channel(COMMAND_BUFFER);
    state
        .insert_terminal(
            terminal_id.clone(),
            TerminalEntry {
                connection_id: None,
                commands,
            },
        )
        .await;

    tracing::debug!(
        terminal_id,
        program,
        cols,
        rows,
        term_type,
        "local terminal opened"
    );

    let Shell {
        master,
        writer,
        reader,
        child,
        killer,
    } = shell;
    // `std::thread::spawn` only fails when the OS refuses a thread, which is fatal for the
    // whole process anyway; a terminal lives for minutes to hours, so these are real
    // threads rather than tasks parked on the tokio blocking pool.
    let reader_id = terminal_id.clone();
    std::thread::spawn(move || forward_output(reader_id, reader, on_data));
    let writer_id = terminal_id.clone();
    std::thread::spawn(move || pump_commands(writer_id, receiver, writer, master, killer));
    let waiter_id = terminal_id.clone();
    std::thread::spawn(move || wait_for_exit(app, waiter_id, child));

    Ok(LocalTerminalOpened { terminal_id })
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

/// Opens the pty and starts the shell in it. Blocking; runs on the blocking pool.
fn spawn_shell(
    size: PtySize,
    program: String,
    args: Vec<String>,
    cwd: Option<PathBuf>,
    term: String,
) -> AppResult<Shell> {
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|err| AppError::io(format!("could not open a pseudo terminal: {err}")))?;

    // `CommandBuilder::new` starts from the current environment, so the shell inherits
    // everything (PATH, LANG, …) and we only override what a terminal has to announce.
    let mut command = CommandBuilder::new(&program);
    command.args(&args);
    command.env("TERM", &term);
    command.env("COLORTERM", "truecolor");
    if let Some(dir) = cwd {
        command.cwd(dir);
    }

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|err| AppError::io(format!("could not start {program}: {err}")))?;
    // The child has its own descriptors now. Dropping our end of the slave is what makes
    // the master readable-until-EOF instead of forever.
    drop(pair.slave);

    let killer = child.clone_killer();
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| AppError::io(format!("could not read from {program}: {err}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| AppError::io(format!("could not write to {program}: {err}")))?;

    Ok(Shell {
        master: pair.master,
        writer,
        reader,
        child,
        killer,
    })
}

/// `None` for a missing, empty or whitespace-only value.
fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn pty_size(cols: u32, rows: u32) -> PtySize {
    PtySize {
        cols: cols.clamp(1, u16::MAX as u32) as u16,
        rows: rows.clamp(1, u16::MAX as u32) as u16,
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// The user's home directory, which is where a fresh terminal starts.
fn home_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app.path().home_dir() {
        return Some(dir);
    }
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// PowerShell 7 when it is installed, else the Windows PowerShell that always is.
#[cfg(windows)]
fn default_program() -> String {
    const PWSH: &str = "pwsh.exe";
    match std::env::var_os("PATH") {
        Some(path) if std::env::split_paths(&path).any(|dir| dir.join(PWSH).is_file()) => {
            PWSH.to_string()
        }
        _ => "powershell.exe".to_string(),
    }
}

/// The login shell from `$SHELL`, else bash, else the shell every unix has.
#[cfg(unix)]
fn default_program() -> String {
    if let Some(shell) = std::env::var_os("SHELL") {
        let shell = shell.to_string_lossy().trim().to_string();
        if !shell.is_empty() {
            return shell;
        }
    }
    if std::path::Path::new("/bin/bash").is_file() {
        "/bin/bash".to_string()
    } else {
        "/bin/sh".to_string()
    }
}

// ---------------------------------------------------------------------------
// The three threads
// ---------------------------------------------------------------------------

/// Reads the pty master until it ends and forwards every chunk to the webview.
///
/// Once the webview has dropped its end of the channel we keep reading and discard the
/// bytes: a full pty buffer would block the shell instead of letting it exit.
fn forward_output(
    terminal_id: String,
    mut reader: Box<dyn Read + Send>,
    on_data: Channel<Response>,
) {
    let mut buffer = vec![0u8; READ_CHUNK];
    let mut forwarding = true;
    loop {
        match reader.read(&mut buffer) {
            // EOF on Windows and on unix when something closed the master cleanly.
            Ok(0) => break,
            Ok(count) => {
                if forwarding
                    && on_data
                        .send(Response::new(buffer[..count].to_vec()))
                        .is_err()
                {
                    tracing::debug!(terminal_id, "the frontend stopped listening for output");
                    forwarding = false;
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            // Linux reports EIO on the master once the last slave is gone; ConPTY reports
            // a broken pipe. Both mean "the shell is finished".
            Err(err) => {
                tracing::debug!(terminal_id, %err, "the local pty stopped producing output");
                break;
            }
        }
    }
    tracing::trace!(terminal_id, "local output reader finished");
}

/// Owns the writable side of the pty until the terminal is closed or the shell is gone.
fn pump_commands(
    terminal_id: String,
    mut commands: mpsc::Receiver<TermCmd>,
    mut writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    mut killer: Box<dyn ChildKiller + Send + Sync>,
) {
    // `None` means every sender is gone, which is how the waiter thread (after removing
    // the registry entry) tells us the shell has exited.
    while let Some(command) = commands.blocking_recv() {
        match command {
            TermCmd::Write(bytes) => {
                if let Err(err) = writer.write_all(&bytes).and_then(|()| writer.flush()) {
                    tracing::debug!(terminal_id, %err, "writing to the local shell failed");
                    break;
                }
            }
            TermCmd::Resize(cols, rows) => {
                if let Err(err) = master.resize(pty_size(cols, rows)) {
                    tracing::debug!(terminal_id, %err, "resizing the local pty failed");
                }
            }
            TermCmd::Close => {
                if let Err(err) = killer.kill() {
                    tracing::debug!(terminal_id, %err, "the local shell was already gone");
                }
                break;
            }
        }
    }
    // Dropping the writer sends EOF to the shell and dropping the master releases the pty,
    // which is what lets the reader thread finish.
    drop(writer);
    drop(master);
    tracing::trace!(terminal_id, "local command pump finished");
}

/// Parks on the child process and reports its exit exactly once.
fn wait_for_exit(app: AppHandle, terminal_id: String, mut child: Box<dyn Child + Send + Sync>) {
    let exit_code = match child.wait() {
        Ok(status) => Some(status.exit_code() as i32),
        Err(err) => {
            tracing::warn!(terminal_id, %err, "could not wait for the local shell");
            None
        }
    };
    drop(child);

    // Both the registry and `emit` need the async runtime, which is reachable from any
    // thread through the global handle.
    tauri::async_runtime::spawn(async move {
        app.state::<AppState>().remove_terminal(&terminal_id).await;
        tracing::debug!(terminal_id, ?exit_code, "local terminal closed");
        if let Err(err) = app.emit(
            "terminal:exit",
            TerminalExit {
                terminal_id: terminal_id.clone(),
                exit_code,
            },
        ) {
            tracing::warn!(terminal_id, %err, "could not emit terminal:exit");
        }
    });
}
