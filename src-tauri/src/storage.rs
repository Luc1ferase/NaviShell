//! JSON file storage under the application data directory.
//!
//! Every persistent file of the core lives directly in `app_data_dir()`:
//!
//! ```text
//! <appData>/servers.json
//! <appData>/settings.json
//! <appData>/layout.json
//! <appData>/known_hosts.json
//! <appData>/plugin-data/<pluginId>.json
//! <appData>/plugins/<pluginId>/...
//! <appData>/logs/
//! <appData>/tmp/            (scratch space, emptied on startup)
//! ```
//!
//! Writes go through [`write_json`], which serialises to a temporary file in the same
//! directory and renames it over the target so a crash can never leave a half-written
//! file behind.

use std::path::{Path, PathBuf};

use serde::{Serialize, de::DeserializeOwned};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// Server records (`Vec<ServerRecord>`).
pub const SERVERS_FILE: &str = "servers.json";
/// Application settings (`AppSettings`).
pub const SETTINGS_FILE: &str = "settings.json";
/// Serialised dockview layout (arbitrary JSON).
pub const LAYOUT_FILE: &str = "layout.json";
/// Trust-on-first-use host key store (`HashMap<"host:port", KnownHost>`).
pub const KNOWN_HOSTS_FILE: &str = "known_hosts.json";

/// Directory holding externally installed plugins.
pub const PLUGINS_DIR: &str = "plugins";
/// Directory holding one JSON object per plugin (`plugin_storage_*`).
pub const PLUGIN_DATA_DIR: &str = "plugin-data";
/// Directory for log files.
pub const LOGS_DIR: &str = "logs";
/// Scratch directory for downloads and half-unpacked plugin archives.
///
/// It deliberately lives next to [`PLUGINS_DIR`] rather than in the OS temp directory, so
/// that moving a staged plugin into place is a rename on the same filesystem.
pub const TMP_DIR: &str = "tmp";

/// Absolute paths reported to the frontend by `app_info`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub app_data: String,
    pub plugins_dir: String,
    pub plugin_data_dir: String,
    pub logs_dir: String,
}

/// Root of all persistent core state.
pub fn app_data_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path().app_data_dir().map_err(|e| {
        AppError::internal(format!(
            "could not resolve the application data directory: {e}"
        ))
    })
}

/// `<appData>/plugins`
pub fn plugins_dir(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app_data_dir(app)?.join(PLUGINS_DIR))
}

/// `<appData>/plugin-data`
pub fn plugin_data_dir(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app_data_dir(app)?.join(PLUGIN_DATA_DIR))
}

/// `<appData>/logs`
pub fn logs_dir(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app_data_dir(app)?.join(LOGS_DIR))
}

/// `<appData>/tmp`
pub fn tmp_dir(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app_data_dir(app)?.join(TMP_DIR))
}

/// Path of a top-level state file such as [`SERVERS_FILE`].
pub fn data_file(app: &AppHandle, name: &str) -> AppResult<PathBuf> {
    Ok(app_data_dir(app)?.join(name))
}

/// The paths handed to the frontend.
pub fn app_paths(app: &AppHandle) -> AppResult<AppPaths> {
    Ok(AppPaths {
        app_data: path_string(&app_data_dir(app)?),
        plugins_dir: path_string(&plugins_dir(app)?),
        plugin_data_dir: path_string(&plugin_data_dir(app)?),
        logs_dir: path_string(&logs_dir(app)?),
    })
}

/// Lossy, display-friendly absolute path.
pub fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Creates a directory and all of its parents; a pre-existing directory is not an error.
pub async fn ensure_dir(path: &Path) -> AppResult<()> {
    tokio::fs::create_dir_all(path).await.map_err(|e| {
        AppError::io(format!(
            "could not create directory {}: {e}",
            path.display()
        ))
    })
}

/// Creates every directory the core expects to exist.
///
/// Called from `setup`, which runs before the async runtime has anything to do, hence the
/// blocking filesystem calls. Nothing can be in flight at that point, so this is also
/// where [`TMP_DIR`] is emptied of whatever a previous crash left behind.
pub fn ensure_layout(app: &AppHandle) -> AppResult<()> {
    let tmp = tmp_dir(app)?;
    if let Err(e) = std::fs::remove_dir_all(&tmp)
        && e.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!(path = %tmp.display(), error = %e, "could not clear the scratch directory");
    }

    for dir in [
        app_data_dir(app)?,
        plugins_dir(app)?,
        plugin_data_dir(app)?,
        logs_dir(app)?,
        tmp,
    ] {
        std::fs::create_dir_all(&dir).map_err(|e| {
            AppError::io(format!("could not create directory {}: {e}", dir.display()))
        })?;
    }
    Ok(())
}

/// Reads and parses a JSON file. `Ok(None)` when the file does not exist.
pub async fn read_json<T: DeserializeOwned>(path: &Path) -> AppResult<Option<T>> {
    let Some(text) = read_text_opt(path).await? else {
        return Ok(None);
    };
    let value = serde_json::from_str(&text)
        .map_err(|e| AppError::internal(format!("{} is not valid JSON: {e}", path.display())))?;
    Ok(Some(value))
}

/// Like [`read_json`] but treats a corrupt file as missing (logged as a warning).
///
/// Used for files the user never edits directly and that we can safely regenerate
/// (settings, layout) so that one bad byte cannot keep the app from starting.
pub async fn read_json_lenient<T: DeserializeOwned>(path: &Path) -> Option<T> {
    match read_json(path).await {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err.message, "ignoring unreadable JSON file");
            None
        }
    }
}

/// Reads a UTF-8 file, returning `None` when it does not exist.
pub async fn read_text_opt(path: &Path) -> AppResult<Option<String>> {
    match tokio::fs::read(path).await {
        Ok(bytes) => Ok(Some(decode_utf8(&bytes, path)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::io(format!(
            "could not read {}: {e}",
            path.display()
        ))),
    }
}

/// Reads a UTF-8 file, failing with `NotFound` when it does not exist.
pub async fn read_text(path: &Path) -> AppResult<String> {
    read_text_opt(path)
        .await?
        .ok_or_else(|| AppError::not_found(format!("{} does not exist", path.display())))
}

fn decode_utf8(bytes: &[u8], path: &Path) -> AppResult<String> {
    String::from_utf8(bytes.to_vec())
        .map_err(|_| AppError::io(format!("{} is not valid UTF-8", path.display())))
}

/// Serialises `value` as pretty JSON and atomically replaces `path`.
pub async fn write_json<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let text = serde_json::to_string_pretty(value)?;
    write_atomic(path, text.as_bytes()).await
}

/// Writes `bytes` to a sibling temporary file and renames it over `path`.
pub async fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::internal(format!("{} has no parent directory", path.display())))?;
    ensure_dir(parent).await?;

    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "state".to_string());
    let tmp = parent.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));

    if let Err(e) = tokio::fs::write(&tmp, bytes).await {
        return Err(AppError::io(format!(
            "could not write {}: {e}",
            tmp.display()
        )));
    }
    // `rename` replaces an existing destination on every platform we target.
    if let Err(e) = tokio::fs::rename(&tmp, path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(AppError::io(format!(
            "could not replace {}: {e}",
            path.display()
        )));
    }
    Ok(())
}
