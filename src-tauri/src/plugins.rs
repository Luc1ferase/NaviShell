//! Discovery of externally installed plugins and their persistent storage.
//!
//! An external plugin is a directory `<appData>/plugins/<pluginId>/` containing a
//! `plugin.json` manifest plus the files it references. The core only ever reads those
//! files and hands the text to the frontend loader; it never executes plugin code.

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::storage;

/// `plugin.json`, mirroring `PluginManifest` of the plugin API.
///
/// `name` and `description` are either a string or a per-locale object, so they stay raw
/// JSON here; unknown keys are preserved through [`PluginManifest::extra`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: serde_json::Value,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    /// Entry bundle relative to the plugin directory; the frontend defaults to `main.js`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub styles: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_host_version: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl PluginManifest {
    /// Placeholder manifest used when `plugin.json` is missing or broken, so the UI can
    /// still list the directory and show why it was not loaded.
    fn stub(dir_name: &str) -> Self {
        Self {
            id: dir_name.to_string(),
            name: serde_json::Value::String(dir_name.to_string()),
            version: "0.0.0".to_string(),
            description: None,
            author: None,
            homepage: None,
            main: None,
            styles: None,
            icon: None,
            min_host_version: None,
            extra: serde_json::Map::new(),
        }
    }
}

/// One entry of `plugins_list_external`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPluginInfo {
    pub manifest: PluginManifest,
    /// Absolute path of the plugin directory.
    pub dir: String,
    /// Why the manifest could not be used; `manifest` is then a best-effort stub.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Accepts the plugin id shape documented in the plugin API: `^[a-z0-9][a-z0-9._-]*$`.
///
/// Besides catching typos this keeps a plugin id from ever reaching the filesystem as
/// something like `../../etc`.
pub fn validate_plugin_id(plugin_id: &str) -> AppResult<()> {
    let starts_well =
        matches!(plugin_id.chars().next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit());
    let body_ok = plugin_id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'));
    if starts_well && body_ok {
        Ok(())
    } else {
        Err(AppError::invalid_argument(format!(
            "invalid plugin id {plugin_id:?}: expected lowercase letters, digits, '.', '_' or '-'"
        )))
    }
}

/// Lists every directory under `<appData>/plugins` with its manifest.
#[tauri::command]
pub async fn plugins_list_external(app: AppHandle) -> AppResult<Vec<ExternalPluginInfo>> {
    let root = storage::plugins_dir(&app)?;
    storage::ensure_dir(&root).await?;

    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut entries = tokio::fs::read_dir(&root).await?;
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        if entry.file_type().await.is_ok_and(|kind| kind.is_dir()) {
            dirs.push(entry.path());
        }
    }
    dirs.sort();

    let mut plugins = Vec::with_capacity(dirs.len());
    for dir in dirs {
        let dir_name = dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let manifest_path = dir.join("plugin.json");
        let (manifest, error) = match storage::read_text_opt(&manifest_path).await {
            Ok(Some(text)) => match serde_json::from_str::<PluginManifest>(&text) {
                Ok(manifest) => (manifest, None),
                Err(err) => (
                    PluginManifest::stub(&dir_name),
                    Some(format!("plugin.json is invalid: {err}")),
                ),
            },
            Ok(None) => (
                PluginManifest::stub(&dir_name),
                Some("plugin.json is missing".to_string()),
            ),
            Err(err) => (PluginManifest::stub(&dir_name), Some(err.message)),
        };
        if let Some(error) = &error {
            tracing::warn!(dir = %dir.display(), error, "external plugin could not be read");
        }
        plugins.push(ExternalPluginInfo {
            manifest,
            dir: storage::path_string(&dir),
            error,
        });
    }
    Ok(plugins)
}

/// Joins `rel_path` onto the plugin directory, refusing anything that escapes it.
fn resolve_in_plugin_dir(root: &Path, rel_path: &str) -> AppResult<PathBuf> {
    if rel_path.trim().is_empty() {
        return Err(AppError::invalid_argument("relPath must not be empty"));
    }
    let relative = Path::new(rel_path);
    for component in relative.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir => {
                return Err(AppError::invalid_argument(format!(
                    "relPath {rel_path:?} must not contain a parent directory segment"
                )));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::invalid_argument(format!(
                    "relPath {rel_path:?} must be relative to the plugin directory"
                )));
            }
        }
    }
    Ok(root.join(relative))
}

/// Reads a UTF-8 file from inside an external plugin directory.
#[tauri::command]
pub async fn plugins_read_file(
    app: AppHandle,
    plugin_id: String,
    rel_path: String,
) -> AppResult<String> {
    validate_plugin_id(&plugin_id)?;
    let root = storage::plugins_dir(&app)?.join(&plugin_id);
    let target = resolve_in_plugin_dir(&root, &rel_path)?;

    // Resolve symlinks on both sides before comparing them, so that a link inside the
    // plugin directory cannot point somewhere else either.
    let canonical_root = tokio::fs::canonicalize(&root)
        .await
        .map_err(|_| AppError::not_found(format!("plugin {plugin_id} is not installed")))?;
    let canonical_target = tokio::fs::canonicalize(&target).await.map_err(|_| {
        AppError::not_found(format!("{rel_path} does not exist in plugin {plugin_id}"))
    })?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err(AppError::invalid_argument(format!(
            "relPath {rel_path:?} escapes the directory of plugin {plugin_id}"
        )));
    }

    storage::read_text(&canonical_target).await
}

/// Path of the JSON object backing one plugin's storage.
fn plugin_storage_file(app: &AppHandle, plugin_id: &str) -> AppResult<PathBuf> {
    validate_plugin_id(plugin_id)?;
    Ok(storage::plugin_data_dir(app)?.join(format!("{plugin_id}.json")))
}

/// Reads a plugin's storage object. Anything unreadable is treated as empty.
async fn read_plugin_storage(path: &Path) -> serde_json::Map<String, serde_json::Value> {
    match storage::read_json_lenient::<serde_json::Value>(path).await {
        Some(serde_json::Value::Object(map)) => map,
        _ => serde_json::Map::new(),
    }
}

/// Reads one key of a plugin's storage; `null` when it was never set.
#[tauri::command]
pub async fn plugin_storage_get(
    app: AppHandle,
    plugin_id: String,
    key: String,
) -> AppResult<Option<serde_json::Value>> {
    let path = plugin_storage_file(&app, &plugin_id)?;
    Ok(read_plugin_storage(&path).await.get(&key).cloned())
}

/// Writes one key of a plugin's storage.
#[tauri::command]
pub async fn plugin_storage_set(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    plugin_id: String,
    key: String,
    value: serde_json::Value,
) -> AppResult<()> {
    let path = plugin_storage_file(&app, &plugin_id)?;
    let _guard = state.storage_guard().await;
    let mut data = read_plugin_storage(&path).await;
    data.insert(key, value);
    storage::write_json(&path, &serde_json::Value::Object(data)).await
}

/// Removes one key of a plugin's storage.
#[tauri::command]
pub async fn plugin_storage_remove(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    plugin_id: String,
    key: String,
) -> AppResult<()> {
    let path = plugin_storage_file(&app, &plugin_id)?;
    let _guard = state.storage_guard().await;
    let mut data = read_plugin_storage(&path).await;
    if data.remove(&key).is_none() {
        return Ok(());
    }
    storage::write_json(&path, &serde_json::Value::Object(data)).await
}
