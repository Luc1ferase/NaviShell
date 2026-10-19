//! SFTP primitives: listing, metadata, directory and file operations, transfers.
//!
//! All commands run on the single [`russh_sftp::client::SftpSession`] of their connection,
//! which is opened the first time it is needed. The session handle is cloned out of the
//! connection before any work starts, so a long transfer never blocks other SFTP calls.
//!
//! Transfers stream in 256 KiB chunks, report progress through a `Channel<TransferProgress>`
//! after every chunk and can be stopped with `sftp_cancel`, which cancels the token that
//! the transfer checks between chunks.

use std::path::Path;

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use serde::Serialize;
use tauri::ipc::Channel;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Chunk size of up- and downloads.
const CHUNK_SIZE: usize = 256 * 1024;
/// Largest file `sftp_read_text` returns without an explicit `maxBytes`.
const DEFAULT_MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
/// Mask keeping the permission and setuid/setgid/sticky bits of a POSIX mode.
const PERMISSION_BITS: u32 = 0o7777;

/// What a directory entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SftpEntryKind {
    File,
    Dir,
    Symlink,
    Other,
}

/// One remote file or directory.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    /// Absolute remote path.
    pub path: String,
    pub kind: SftpEntryKind,
    /// Size in bytes; `None` when the server did not report it.
    pub size: Option<u64>,
    /// Modification time in Unix epoch seconds.
    pub mtime: Option<i64>,
    /// POSIX mode bits without the file type, e.g. `0o644`.
    pub permissions: Option<u32>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub owner: Option<String>,
    pub group: Option<String>,
}

/// Progress of a running transfer, pushed to the frontend after every chunk.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transfer_id: String,
    pub transferred: u64,
    /// Total size when it is known up front.
    pub total: Option<u64>,
}

/// Joins a remote directory and an entry name with `/`.
fn join_remote(dir: &str, name: &str) -> String {
    match dir {
        "" => name.to_string(),
        dir if dir.ends_with('/') => format!("{dir}{name}"),
        dir => format!("{dir}/{name}"),
    }
}

/// The last segment of a remote path (`/` for the root itself).
fn base_name(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rsplit('/').next() {
        Some(name) if !name.is_empty() => name.to_string(),
        _ => "/".to_string(),
    }
}

fn kind_of(metadata: &FileAttributes) -> SftpEntryKind {
    if metadata.is_dir() {
        SftpEntryKind::Dir
    } else if metadata.is_symlink() {
        SftpEntryKind::Symlink
    } else if metadata.is_regular() {
        SftpEntryKind::File
    } else {
        SftpEntryKind::Other
    }
}

/// Builds an entry from the attributes the server sent.
fn entry_from(name: String, path: String, metadata: &FileAttributes) -> SftpEntry {
    SftpEntry {
        name,
        path,
        kind: kind_of(metadata),
        size: metadata.size,
        mtime: metadata.mtime.map(i64::from),
        permissions: metadata.permissions.map(|mode| mode & PERMISSION_BITS),
        uid: metadata.uid,
        gid: metadata.gid,
        owner: metadata.user.clone(),
        group: metadata.group.clone(),
    }
}

/// The SFTP session of a connection, opening the subsystem if needed.
async fn session(state: &AppState, connection_id: &str) -> AppResult<std::sync::Arc<SftpSession>> {
    state.connection(connection_id).await?.sftp().await
}

fn require_path(path: &str) -> AppResult<()> {
    if path.trim().is_empty() {
        return Err(AppError::invalid_argument("path must not be empty"));
    }
    Ok(())
}

/// The canonical home directory of the session (`realpath "."`).
#[tauri::command]
pub async fn sftp_home(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> AppResult<String> {
    let sftp = session(&state, &connection_id).await?;
    Ok(sftp.canonicalize(".").await?)
}

/// Lists a directory. `.` and `..` are never included; the caller sorts.
#[tauri::command]
pub async fn sftp_list(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    path: String,
) -> AppResult<Vec<SftpEntry>> {
    require_path(&path)?;
    let sftp = session(&state, &connection_id).await?;
    let entries = sftp.read_dir(path.clone()).await?;

    let mut result = Vec::new();
    for entry in entries {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let metadata = entry.metadata();
        let full_path = join_remote(&path, &name);
        result.push(entry_from(name, full_path, &metadata));
    }
    Ok(result)
}

/// Metadata of one path. Symlinks are reported as symlinks, not as their target.
#[tauri::command]
pub async fn sftp_stat(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    path: String,
) -> AppResult<SftpEntry> {
    require_path(&path)?;
    let sftp = session(&state, &connection_id).await?;
    let metadata = sftp.symlink_metadata(path.clone()).await?;
    Ok(entry_from(base_name(&path), path, &metadata))
}

/// Creates a directory. Parents must exist.
#[tauri::command]
pub async fn sftp_mkdir(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    path: String,
) -> AppResult<()> {
    require_path(&path)?;
    let sftp = session(&state, &connection_id).await?;
    Ok(sftp.create_dir(path).await?)
}

/// Renames (or moves) a file or directory.
#[tauri::command]
pub async fn sftp_rename(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    require_path(&from)?;
    require_path(&to)?;
    let sftp = session(&state, &connection_id).await?;
    Ok(sftp.rename(from, to).await?)
}

/// Deletes a file, or a directory when it is empty or `recursive` is set.
#[tauri::command]
pub async fn sftp_remove(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    path: String,
    recursive: Option<bool>,
) -> AppResult<()> {
    require_path(&path)?;
    let sftp = session(&state, &connection_id).await?;
    let metadata = sftp.symlink_metadata(path.clone()).await?;

    if !metadata.is_dir() {
        // Symlinks are unlinked, never followed.
        return Ok(sftp.remove_file(path).await?);
    }
    if recursive.unwrap_or(false) {
        return remove_tree(&sftp, &path).await;
    }
    Ok(sftp.remove_dir(path).await?)
}

/// Deletes a directory tree depth first, without recursing in Rust.
async fn remove_tree(sftp: &SftpSession, root: &str) -> AppResult<()> {
    let mut pending = vec![root.to_string()];
    // Parents are always discovered before their children, so deleting this list in
    // reverse order deletes every directory after its contents.
    let mut directories: Vec<String> = Vec::new();

    while let Some(dir) = pending.pop() {
        directories.push(dir.clone());
        for entry in sftp.read_dir(dir.clone()).await? {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let child = join_remote(&dir, &name);
            if entry.metadata().is_dir() {
                pending.push(child);
            } else {
                sftp.remove_file(child).await?;
            }
        }
    }

    for dir in directories.into_iter().rev() {
        sftp.remove_dir(dir).await?;
    }
    Ok(())
}

/// Reads a small text file. Fails with `InvalidArgument` when it is too large.
#[tauri::command]
pub async fn sftp_read_text(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    path: String,
    max_bytes: Option<u64>,
) -> AppResult<String> {
    require_path(&path)?;
    let limit = max_bytes.unwrap_or(DEFAULT_MAX_TEXT_BYTES);
    let sftp = session(&state, &connection_id).await?;

    if let Some(size) = sftp.metadata(path.clone()).await?.size
        && size > limit
    {
        return Err(AppError::invalid_argument(format!(
            "{path} is {size} bytes, which is more than the {limit} byte limit"
        )));
    }

    let bytes = sftp.read(path.clone()).await?;
    if bytes.len() as u64 > limit {
        return Err(AppError::invalid_argument(format!(
            "{path} is {} bytes, which is more than the {limit} byte limit",
            bytes.len()
        )));
    }
    String::from_utf8(bytes).map_err(|_| AppError::io(format!("{path} is not valid UTF-8 text")))
}

/// Writes a text file, creating or truncating it.
#[tauri::command]
pub async fn sftp_write_text(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    path: String,
    content: String,
) -> AppResult<()> {
    require_path(&path)?;
    let sftp = session(&state, &connection_id).await?;
    let mut file = sftp
        .open_with_flags(
            path,
            OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE,
        )
        .await?;
    file.write_all(content.as_bytes()).await?;
    file.close().await?;
    Ok(())
}

/// Downloads a remote file to a local path, reporting progress per chunk.
#[tauri::command]
pub async fn sftp_download(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
    on_progress: Channel<TransferProgress>,
) -> AppResult<()> {
    require_path(&remote_path)?;
    require_path(&local_path)?;
    let token = state.register_transfer(&transfer_id).await;
    let result = run_download(
        &state,
        &connection_id,
        &remote_path,
        &local_path,
        &transfer_id,
        &on_progress,
        &token,
    )
    .await;
    state.finish_transfer(&transfer_id).await;

    if result.is_err() && token.is_cancelled() {
        // The local file is a partial copy nobody asked for; the handle is closed by now.
        if let Err(err) = tokio::fs::remove_file(&local_path).await {
            tracing::debug!(local_path, %err, "could not delete the cancelled download");
        }
    }
    result
}

#[allow(clippy::too_many_arguments)]
async fn run_download(
    state: &AppState,
    connection_id: &str,
    remote_path: &str,
    local_path: &str,
    transfer_id: &str,
    on_progress: &Channel<TransferProgress>,
    token: &CancellationToken,
) -> AppResult<()> {
    let sftp = session(state, connection_id).await?;
    let total = sftp.metadata(remote_path.to_string()).await?.size;

    let mut remote = sftp.open(remote_path.to_string()).await?;
    let parent = Path::new(local_path)
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    if let Some(parent) = parent {
        crate::storage::ensure_dir(parent).await?;
    }
    let mut local = tokio::fs::File::create(local_path).await?;

    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut transferred: u64 = 0;
    loop {
        let read = tokio::select! {
            biased;
            () = token.cancelled() => return Err(cancelled(transfer_id)),
            read = remote.read(&mut buffer) => read?,
        };
        if read == 0 {
            break;
        }
        local.write_all(&buffer[..read]).await?;
        transferred += read as u64;
        report(on_progress, transfer_id, transferred, total);
    }
    local.flush().await?;
    tracing::debug!(
        transfer_id,
        remote_path,
        local_path,
        transferred,
        "download finished"
    );
    Ok(())
}

/// Uploads a local file to a remote path, reporting progress per chunk.
#[tauri::command]
pub async fn sftp_upload(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
    on_progress: Channel<TransferProgress>,
) -> AppResult<()> {
    require_path(&local_path)?;
    require_path(&remote_path)?;
    let token = state.register_transfer(&transfer_id).await;
    let result = run_upload(
        &state,
        &connection_id,
        &local_path,
        &remote_path,
        &transfer_id,
        &on_progress,
        &token,
    )
    .await;
    state.finish_transfer(&transfer_id).await;
    result
}

#[allow(clippy::too_many_arguments)]
async fn run_upload(
    state: &AppState,
    connection_id: &str,
    local_path: &str,
    remote_path: &str,
    transfer_id: &str,
    on_progress: &Channel<TransferProgress>,
    token: &CancellationToken,
) -> AppResult<()> {
    let sftp = session(state, connection_id).await?;
    let mut local = tokio::fs::File::open(local_path).await?;
    let total = local.metadata().await.ok().map(|metadata| metadata.len());
    let mut remote = sftp.create(remote_path.to_string()).await?;

    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut transferred: u64 = 0;
    loop {
        if token.is_cancelled() {
            return Err(cancelled(transfer_id));
        }
        let read = local.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        tokio::select! {
            biased;
            () = token.cancelled() => return Err(cancelled(transfer_id)),
            written = remote.write_all(&buffer[..read]) => written?,
        }
        transferred += read as u64;
        report(on_progress, transfer_id, transferred, total);
    }
    // Flushes the pending writes and closes the remote handle.
    remote.close().await?;
    tracing::debug!(
        transfer_id,
        local_path,
        remote_path,
        transferred,
        "upload finished"
    );
    Ok(())
}

/// Stops a running transfer. Unknown (or already finished) ids are ignored.
#[tauri::command]
pub async fn sftp_cancel(state: tauri::State<'_, AppState>, transfer_id: String) -> AppResult<()> {
    if !state.cancel_transfer(&transfer_id).await {
        tracing::debug!(transfer_id, "no running transfer to cancel");
    }
    Ok(())
}

fn cancelled(transfer_id: &str) -> AppError {
    AppError::cancelled(format!("transfer {transfer_id} was cancelled"))
}

/// Pushes one progress message; a frontend that stopped listening is not an error.
fn report(
    on_progress: &Channel<TransferProgress>,
    transfer_id: &str,
    transferred: u64,
    total: Option<u64>,
) {
    let _ = on_progress.send(TransferProgress {
        transfer_id: transfer_id.to_string(),
        transferred,
        total,
    });
}
