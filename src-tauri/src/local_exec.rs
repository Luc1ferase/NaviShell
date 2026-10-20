//! One-shot command execution on this machine for plugins (`local_exec`).
//!
//! The counterpart of `ssh_exec` for the local side: run a program without a shell,
//! collect stdout and stderr and return the exit status. Nothing here is interactive, so
//! stdin is closed and, on Windows, no console window is created.

use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

use crate::error::{AppError, AppResult};
use crate::ssh::exec::ExecResult;

/// Timeout applied when the caller does not pass `timeoutMs`.
const DEFAULT_TIMEOUT_MS: u64 = 30_000;
/// Longest timeout a caller may ask for.
const MAX_TIMEOUT_MS: u64 = 10 * 60 * 1000;
/// Per-stream cap; anything beyond it is drained and dropped so the child never blocks.
const OUTPUT_CAP: u64 = 8 * 1024 * 1024;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Runs `program` with `args` and waits for it to finish.
///
/// Output is decoded as UTF-8 with invalid sequences replaced. A process that outlives the
/// timeout is killed and reported as `Timeout`; one that is killed by a signal has
/// `exit_code: None`.
#[tauri::command]
pub async fn local_exec(
    program: String,
    args: Vec<String>,
    timeout_ms: Option<u64>,
    cwd: Option<String>,
) -> AppResult<ExecResult> {
    if program.trim().is_empty() {
        return Err(AppError::invalid_argument("program must not be empty"));
    }
    let timeout = Duration::from_millis(
        timeout_ms
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .clamp(1, MAX_TIMEOUT_MS),
    );

    let mut command = Command::new(&program);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(dir) = cwd.as_deref().map(str::trim).filter(|dir| !dir.is_empty()) {
        command.current_dir(dir);
    }
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|err| AppError::io(format!("could not start `{program}`: {err}")))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let outcome = tokio::time::timeout(timeout, async {
        tokio::join!(read_capped(stdout), read_capped(stderr), child.wait())
    })
    .await;

    match outcome {
        Ok((stdout, stderr, status)) => {
            let status = status?;
            Ok(ExecResult {
                stdout,
                stderr,
                exit_code: status.code(),
            })
        }
        Err(_) => {
            // The timed-out future released its borrow of `child`, so it can be killed
            // explicitly instead of relying on `kill_on_drop`.
            let _ = child.kill().await;
            Err(AppError::timeout(format!(
                "`{program}` did not finish within {} ms",
                timeout.as_millis()
            )))
        }
    }
}

/// Reads a pipe to the end, keeping the first `OUTPUT_CAP` bytes and draining the rest.
async fn read_capped(pipe: Option<impl AsyncRead + Unpin>) -> String {
    let Some(pipe) = pipe else {
        return String::new();
    };
    let mut buffer = Vec::new();
    let mut limited = pipe.take(OUTPUT_CAP);
    let _ = limited.read_to_end(&mut buffer).await;
    let mut rest = limited.into_inner();
    let mut sink = [0u8; 8192];
    while matches!(rest.read(&mut sink).await, Ok(n) if n > 0) {}
    String::from_utf8_lossy(&buffer).into_owned()
}
