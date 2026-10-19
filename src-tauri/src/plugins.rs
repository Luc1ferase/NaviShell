//! Discovery, installation and persistent storage of externally installed plugins.
//!
//! An external plugin is a directory `<appData>/plugins/<pluginId>/` containing a
//! `plugin.json` manifest plus the files it references. The core only ever reads those
//! files and hands the text to the frontend loader; it never executes plugin code.
//!
//! Installation (`plugins_install_from_url` / `plugins_install_from_file`) unpacks a zip
//! archive into `<appData>/tmp/install-*/`, validates the manifest there, and only then
//! renames the staged directory into `<appData>/plugins/<id>`. Nothing partially unpacked
//! is ever visible to [`plugins_list_external`], and the scratch directory is removed on
//! every path out.

use std::io::Read as _;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::storage;

/// Manifest file name inside a plugin directory or archive.
const MANIFEST_FILE: &str = "plugin.json";
/// Entry bundle assumed when the manifest has no `main`; mirrors the frontend loader.
const DEFAULT_MAIN: &str = "main.js";
/// Prefix of every built-in plugin id; an installed plugin may never claim one.
const BUILTIN_ID_PREFIX: &str = "navishell.";
/// Cap on the downloaded archive *and* on everything unpacked out of it.
const MAX_ARCHIVE_BYTES: u64 = 50 * 1024 * 1024;
/// Deadline for the whole download, connection setup included.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60);
/// Registry index used when the caller passes none; mirrors `DEFAULT_PLUGIN_REGISTRY_URL`
/// of the IPC contract.
const DEFAULT_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/Luc1ferase/NaviShell/master/registry/plugins.json";
/// Cap on a downloaded registry index. It is a listing, not a payload.
const MAX_REGISTRY_BYTES: u64 = 1024 * 1024;
/// Deadline for fetching a registry index, connection setup included.
const REGISTRY_TIMEOUT: Duration = Duration::from_secs(15);

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
        let manifest_path = dir.join(MANIFEST_FILE);
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

// ---------------------------------------------------------------------------
// Installing and removing plugins (issue #7)
// ---------------------------------------------------------------------------

/// Downloads a zip archive and installs it as an external plugin.
///
/// `sha256` is a hex digest (case-insensitive) checked against the download when given;
/// `replace` must be true to overwrite an already installed plugin with the same id.
#[tauri::command]
pub async fn plugins_install_from_url(
    app: AppHandle,
    url: String,
    sha256: Option<String>,
    replace: Option<bool>,
) -> AppResult<ExternalPluginInfo> {
    let work = work_dir(&app).await?;
    let archive = work.path().join("plugin.zip");
    download_archive(&url, &archive).await?;
    if let Some(expected) = &sha256 {
        verify_sha256(&archive, expected).await?;
    }
    install_archive(&app, archive, work.path(), replace.unwrap_or(false)).await
}

/// Installs an external plugin from a zip archive already on this machine.
#[tauri::command]
pub async fn plugins_install_from_file(
    app: AppHandle,
    path: String,
    replace: Option<bool>,
) -> AppResult<ExternalPluginInfo> {
    let archive = PathBuf::from(&path);
    let metadata = tokio::fs::metadata(&archive)
        .await
        .map_err(|_| AppError::not_found(format!("{path} does not exist")))?;
    if !metadata.is_file() {
        return Err(AppError::invalid_argument(format!("{path} is not a file")));
    }
    if metadata.len() > MAX_ARCHIVE_BYTES {
        return Err(too_large(metadata.len()));
    }

    let work = work_dir(&app).await?;
    install_archive(&app, archive, work.path(), replace.unwrap_or(false)).await
}

/// Removes `<pluginsDir>/<pluginId>` and the plugin's stored data.
#[tauri::command]
pub async fn plugins_uninstall(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    plugin_id: String,
) -> AppResult<()> {
    validate_plugin_id(&plugin_id)?;
    let dir = storage::plugins_dir(&app)?.join(&plugin_id);

    // `symlink_metadata` does not follow links, so a link planted in the plugins
    // directory counts as "not installed" instead of having its target removed.
    if !tokio::fs::symlink_metadata(&dir)
        .await
        .is_ok_and(|meta| meta.is_dir())
    {
        return Err(AppError::not_found(format!(
            "plugin {plugin_id} is not installed"
        )));
    }
    tokio::fs::remove_dir_all(&dir)
        .await
        .map_err(|e| AppError::io(format!("could not remove {}: {e}", dir.display())))?;

    // The plugin is gone either way, so failing to drop its storage is only logged.
    let data = storage::plugin_data_dir(&app)?.join(format!("{plugin_id}.json"));
    let _guard = state.storage_guard().await;
    if let Err(e) = tokio::fs::remove_file(&data).await
        && e.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!(path = %data.display(), error = %e, "could not remove the plugin's storage");
    }
    tracing::info!(plugin = %plugin_id, "external plugin uninstalled");
    Ok(())
}

/// A scratch directory under `<appData>/tmp`, removed when the returned guard drops.
///
/// It sits inside the app data directory rather than in the OS temp directory so that
/// moving the staged plugin into `<appData>/plugins` is a rename on the same filesystem.
async fn work_dir(app: &AppHandle) -> AppResult<TempDir> {
    let root = storage::tmp_dir(app)?;
    storage::ensure_dir(&root).await?;
    tempfile::Builder::new()
        .prefix("install-")
        .tempdir_in(&root)
        .map_err(|e| {
            AppError::io(format!(
                "could not create a scratch directory in {}: {e}",
                root.display()
            ))
        })
}

/// Unpacks `archive`, validates what came out of it and moves it into place.
///
/// `work` is the scratch directory whose guard the caller holds, so returning early here
/// is enough to leave nothing behind.
async fn install_archive(
    app: &AppHandle,
    archive: PathBuf,
    work: &Path,
    replace: bool,
) -> AppResult<ExternalPluginInfo> {
    let unpacked = work.join("unpacked");
    storage::ensure_dir(&unpacked).await?;

    // `zip` is a blocking API and an archive may hold a few MiB of files.
    let (staged, manifest) = tokio::task::spawn_blocking(move || {
        unpack_archive(&archive, &unpacked)?;
        let staged = manifest_root(&unpacked)?;
        let manifest = read_staged_manifest(&staged)?;
        Ok::<_, AppError>((staged, manifest))
    })
    .await??;

    place_plugin(app, &staged, work, manifest, replace).await
}

/// Streams an http(s) URL into `dest`, refusing anything over [`MAX_ARCHIVE_BYTES`].
async fn download_archive(url: &str, dest: &Path) -> AppResult<()> {
    let parsed = parse_http_url(url)?;
    let client = http_client(DOWNLOAD_TIMEOUT)?;

    let mut response = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| http_error(url, &e, DOWNLOAD_TIMEOUT))?;
    let status = response.status();
    if !status.is_success() {
        return Err(AppError::io(format!("{url} returned HTTP {status}"))
            .with_data(serde_json::json!({ "status": status.as_u16() })));
    }
    if let Some(length) = response.content_length()
        && length > MAX_ARCHIVE_BYTES
    {
        return Err(too_large(length));
    }

    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| AppError::io(format!("could not create {}: {e}", dest.display())))?;
    let mut total: u64 = 0;
    // `Content-Length` is a hint at best, so the running total is what actually enforces
    // the limit; the connection is dropped as soon as it is passed.
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| http_error(url, &e, DOWNLOAD_TIMEOUT))?
    {
        total = total.saturating_add(chunk.len() as u64);
        if total > MAX_ARCHIVE_BYTES {
            return Err(too_large(total));
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::io(format!("could not write {}: {e}", dest.display())))?;
    }
    file.flush()
        .await
        .map_err(|e| AppError::io(format!("could not write {}: {e}", dest.display())))?;
    // A `tokio::fs::File` closes in the background when dropped, and Windows refuses to
    // remove a directory holding an open file - which is what the scratch guard tries to
    // do on the way out. `into_std` waits for the pending writes, so the plain `File` it
    // returns closes right here.
    drop(file.into_std().await);

    tracing::info!(url, bytes = total, "plugin archive downloaded");
    Ok(())
}

/// Parses a URL the core is willing to fetch: http(s) and nothing else, so that neither a
/// `file:` nor a `data:` URL can reach the download paths.
fn parse_http_url(url: &str) -> AppResult<reqwest::Url> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| AppError::invalid_argument(format!("{url:?} is not a valid URL: {e}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::invalid_argument(format!(
            "unsupported URL scheme {:?}: only http and https can be downloaded from",
            parsed.scheme()
        )));
    }
    Ok(parsed)
}

/// An HTTP client carrying the core's user agent and `timeout` as its whole-request
/// deadline.
fn http_client(timeout: Duration) -> AppResult<reqwest::Client> {
    // `rustls` is built without a default crypto provider (see Cargo.toml), so pick one
    // before the first client exists. Installing it can only fail if another thread won
    // the race, which is just as good.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    reqwest::Client::builder()
        .user_agent(concat!("NaviShell/", env!("CARGO_PKG_VERSION")))
        .timeout(timeout)
        .build()
        .map_err(|e| AppError::io(format!("could not build the HTTP client: {e}")))
}

/// Maps a `reqwest` failure onto the `Io` code the contract promises, carrying the HTTP
/// status in `data` whenever there was one. `timeout` is the deadline the request ran
/// under, so that a timed-out request says which one it blew.
fn http_error(url: &str, err: &reqwest::Error, timeout: Duration) -> AppError {
    let error = AppError::io(if err.is_timeout() {
        format!("{url} did not answer within {} s", timeout.as_secs())
    } else if err.is_connect() {
        format!("could not connect to {url}: {err}")
    } else {
        format!("could not download {url}: {err}")
    });
    match err.status() {
        Some(status) => error.with_data(serde_json::json!({ "status": status.as_u16() })),
        None => error,
    }
}

/// The single error for anything that busts [`MAX_ARCHIVE_BYTES`].
fn too_large(bytes: u64) -> AppError {
    AppError::invalid_argument(format!(
        "the plugin archive exceeds the {} MiB limit ({bytes} bytes)",
        MAX_ARCHIVE_BYTES / (1024 * 1024)
    ))
}

/// Checks the archive against a hex SHA-256 digest.
async fn verify_sha256(archive: &Path, expected: &str) -> AppResult<()> {
    let expected = expected.trim();
    if expected.len() != 64 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::invalid_argument(format!(
            "sha256 {expected:?} is not a 64-character hex digest"
        )));
    }

    let mut file = tokio::fs::File::open(archive).await?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    // Closed here rather than in the background, see `download_archive`.
    drop(file.into_std().await);

    let actual = hex_lower(&hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(AppError::invalid_argument(format!(
            "the download does not match the expected sha256: got {actual}, expected {}",
            expected.to_ascii_lowercase()
        )));
    }
    Ok(())
}

/// Lowercase hex, the shape `sha256` is given and reported in.
fn hex_lower(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut out, byte| {
            let _ = write!(out, "{byte:02x}");
            out
        })
}

/// Unpacks `archive` into the empty directory `dest`.
///
/// Entry names go through `enclosed_name`, which is the one check that rejects absolute
/// paths, `..` segments and Windows drive prefixes alike. Symlinks are skipped rather
/// than recreated: a plugin bundle has no use for them, and a link is the one entry whose
/// *target* could still point out of the directory after extraction.
fn unpack_archive(archive: &Path, dest: &Path) -> AppResult<()> {
    let file = std::fs::File::open(archive)
        .map_err(|e| AppError::io(format!("could not open {}: {e}", archive.display())))?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file))
        .map_err(|e| AppError::invalid_argument(format!("not a readable zip archive: {e}")))?;

    let mut written: u64 = 0;
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|e| AppError::invalid_argument(format!("broken zip entry: {e}")))?;
        if entry.is_symlink() {
            tracing::warn!(
                entry = %String::from_utf8_lossy(entry.name_raw()),
                "skipping a symlink in a plugin archive"
            );
            continue;
        }
        let Some(relative) = entry.enclosed_name() else {
            return Err(AppError::invalid_argument(format!(
                "the archive entry {:?} is not a path inside the archive",
                String::from_utf8_lossy(entry.name_raw())
            )));
        };
        // An entry named "" or "./" resolves to `dest` itself, which exists already.
        if relative.components().next().is_none() {
            continue;
        }

        let target = dest.join(&relative);
        if entry.is_dir() {
            create_dir(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            create_dir(parent)?;
        }
        let mut out = std::fs::File::create(&target)
            .map_err(|e| AppError::io(format!("could not create {}: {e}", target.display())))?;

        // One byte past what is left of the budget is enough to tell that the archive
        // does not fit, without trusting the size its central directory claims.
        let budget = MAX_ARCHIVE_BYTES - written + 1;
        written += std::io::copy(&mut entry.by_ref().take(budget), &mut out).map_err(|e| {
            AppError::invalid_argument(format!("could not unpack {}: {e}", relative.display()))
        })?;
        if written > MAX_ARCHIVE_BYTES {
            return Err(too_large(written));
        }
    }
    Ok(())
}

/// [`storage::ensure_dir`] for the blocking unpacking task.
fn create_dir(path: &Path) -> AppResult<()> {
    std::fs::create_dir_all(path).map_err(|e| {
        AppError::io(format!(
            "could not create directory {}: {e}",
            path.display()
        ))
    })
}

/// Locates the directory holding `plugin.json`: either `root` itself, or the single
/// top-level directory inside it (the shape a zipped-up source tree has).
fn manifest_root(root: &Path) -> AppResult<PathBuf> {
    if root.join(MANIFEST_FILE).is_file() {
        return Ok(root.to_path_buf());
    }

    let read_error =
        |e: std::io::Error| AppError::io(format!("could not read {}: {e}", root.display()));
    let mut dirs: Vec<PathBuf> = Vec::new();
    for entry in std::fs::read_dir(root).map_err(read_error)? {
        let entry = entry.map_err(read_error)?;
        if entry.path().is_dir() {
            dirs.push(entry.path());
        }
    }
    if let [single] = dirs.as_slice()
        && single.join(MANIFEST_FILE).is_file()
    {
        return Ok(single.clone());
    }
    Err(AppError::invalid_argument(
        "the archive must contain plugin.json at its root or inside a single top-level directory",
    ))
}

/// Reads and checks the staged `plugin.json` before anything is moved into place.
fn read_staged_manifest(dir: &Path) -> AppResult<PluginManifest> {
    let text = std::fs::read_to_string(dir.join(MANIFEST_FILE))
        .map_err(|e| AppError::invalid_argument(format!("could not read plugin.json: {e}")))?;
    let manifest: PluginManifest = serde_json::from_str(&text)
        .map_err(|e| AppError::invalid_argument(format!("plugin.json is invalid: {e}")))?;

    validate_plugin_id(&manifest.id)?;
    if manifest.id.starts_with(BUILTIN_ID_PREFIX) {
        return Err(AppError::invalid_argument(format!(
            "plugin id {:?} is reserved: {BUILTIN_ID_PREFIX}* belongs to the built-in plugins",
            manifest.id
        )));
    }
    if manifest.version.trim().is_empty() {
        return Err(AppError::invalid_argument(
            "plugin.json must declare a non-empty version",
        ));
    }

    let main = manifest.main.as_deref().unwrap_or(DEFAULT_MAIN);
    if !resolve_in_plugin_dir(dir, main)?.is_file() {
        return Err(AppError::invalid_argument(format!(
            "plugin.json declares main {main:?}, which the archive does not contain"
        )));
    }
    Ok(manifest)
}

/// Moves the staged directory to `<pluginsDir>/<id>`, replacing an existing install only
/// when asked to.
async fn place_plugin(
    app: &AppHandle,
    staged: &Path,
    work: &Path,
    manifest: PluginManifest,
    replace: bool,
) -> AppResult<ExternalPluginInfo> {
    let root = storage::plugins_dir(app)?;
    storage::ensure_dir(&root).await?;
    let target = root.join(&manifest.id);

    let occupied = tokio::fs::symlink_metadata(&target).await.is_ok();
    if occupied && !replace {
        return Err(AppError::invalid_argument(format!(
            "plugin {} is already installed",
            manifest.id
        ))
        .with_data(serde_json::json!({
            "exists": true,
            "version": installed_version(&target).await,
        })));
    }

    // When replacing, the installed directory is parked in the scratch space first, so a
    // failed move leaves the working install behind rather than nothing at all. Renaming
    // over an existing directory is an error on Windows anyway.
    let backup = work.join("replaced");
    if occupied {
        tokio::fs::rename(&target, &backup).await.map_err(|e| {
            AppError::io(format!(
                "could not move the installed plugin {} aside: {e}",
                manifest.id
            ))
        })?;
    }
    if let Err(e) = tokio::fs::rename(staged, &target).await {
        if occupied {
            let _ = tokio::fs::rename(&backup, &target).await;
        }
        return Err(AppError::io(format!(
            "could not move the plugin into {}: {e}",
            target.display()
        )));
    }
    if occupied {
        // The scratch guard would take care of this too; doing it here keeps the old
        // copy from outliving the command.
        let _ = tokio::fs::remove_dir_all(&backup).await;
    }

    tracing::info!(
        plugin = %manifest.id,
        version = %manifest.version,
        dir = %target.display(),
        "external plugin installed"
    );
    Ok(ExternalPluginInfo {
        manifest,
        dir: storage::path_string(&target),
        error: None,
    })
}

/// `version` of an installed plugin, for the conflict payload; `None` when unreadable.
async fn installed_version(dir: &Path) -> Option<String> {
    storage::read_json_lenient::<PluginManifest>(&dir.join(MANIFEST_FILE))
        .await
        .map(|manifest| manifest.version)
}

// ---------------------------------------------------------------------------
// Registry index: the plugin marketplace list (issue #7)
// ---------------------------------------------------------------------------

/// One entry of a registry index, mirroring `PluginRegistryEntry` of the IPC contract.
///
/// `name` and `description` are either a string or a per-locale object, so they stay raw
/// JSON and the frontend picks the locale, exactly as in [`PluginManifest`]. The three
/// required strings default to empty instead of failing the whole entry, so that
/// [`registry_entry_problem`] is the one place that says why an entry was dropped;
/// `name` has no sensible default and a missing one drops the entry at parse time.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRegistryEntry {
    #[serde(default)]
    pub id: String,
    pub name: serde_json::Value,
    #[serde(default)]
    pub version: String,
    /// Direct http(s) URL of the plugin zip, installable with `plugins_install_from_url`.
    #[serde(default)]
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<serde_json::Value>,
    /// Hex SHA-256 of the zip, verified by `plugins_install_from_url` at install time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_host_version: Option<String>,
    /// `lucide-react` icon name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

/// A validated registry index, the result of [`plugins_fetch_registry`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRegistry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// ISO date of the last index update.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    pub plugins: Vec<PluginRegistryEntry>,
}

/// The index as downloaded: entries stay raw JSON so that one unreadable entry costs that
/// entry rather than the whole listing. Unknown keys (`$schema`) are ignored.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRegistry {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    plugins: Vec<serde_json::Value>,
}

/// Downloads a registry index and keeps the entries that could actually be installed.
///
/// `url` defaults to [`DEFAULT_REGISTRY_URL`]. Per the contract, an entry that cannot be
/// read or cannot be installed is dropped and logged rather than failing the call; only a
/// bad URL, the download itself, the HTTP status and the JSON parse are errors.
#[tauri::command]
pub async fn plugins_fetch_registry(url: Option<String>) -> AppResult<PluginRegistry> {
    // An empty `registryUrl` in the settings means the same as none at all.
    let url = match url.as_deref().map(str::trim) {
        Some(url) if !url.is_empty() => url,
        _ => DEFAULT_REGISTRY_URL,
    };
    let body = fetch_registry(url).await?;
    let raw: RawRegistry = serde_json::from_str(&body)
        .map_err(|e| AppError::io(format!("{url} is not a usable plugin registry: {e}")))?;

    let listed = raw.plugins.len();
    let mut plugins: Vec<PluginRegistryEntry> = Vec::with_capacity(listed);
    for value in raw.plugins {
        match serde_json::from_value::<PluginRegistryEntry>(value) {
            Ok(entry) => match registry_entry_problem(&entry) {
                Some(reason) => {
                    tracing::warn!(url, reason, "dropping a plugin registry entry");
                }
                None => plugins.push(entry),
            },
            Err(e) => {
                tracing::warn!(url, error = %e, "dropping an unreadable plugin registry entry");
            }
        }
    }
    tracing::info!(url, listed, kept = plugins.len(), "plugin registry fetched");

    Ok(PluginRegistry {
        name: raw.name,
        updated_at: raw.updated_at,
        plugins,
    })
}

/// Why a registry entry cannot be offered for install, or `None` when it can.
///
/// These are the install-time rules of [`read_staged_manifest`] applied early, so the
/// marketplace never lists something `plugins_install_from_url` would refuse anyway.
fn registry_entry_problem(entry: &PluginRegistryEntry) -> Option<String> {
    if let Err(e) = validate_plugin_id(&entry.id) {
        return Some(e.message);
    }
    if entry.id.starts_with(BUILTIN_ID_PREFIX) {
        return Some(format!(
            "plugin id {:?} is reserved: {BUILTIN_ID_PREFIX}* belongs to the built-in plugins",
            entry.id
        ));
    }
    if entry.version.trim().is_empty() {
        return Some(format!("plugin {} declares no version", entry.id));
    }
    if let Err(e) = parse_http_url(&entry.url) {
        return Some(format!("plugin {}: {}", entry.id, e.message));
    }
    None
}

/// Downloads a registry index into memory, refusing anything over [`MAX_REGISTRY_BYTES`].
async fn fetch_registry(url: &str) -> AppResult<String> {
    let parsed = parse_http_url(url)?;
    let client = http_client(REGISTRY_TIMEOUT)?;

    let mut response = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| http_error(url, &e, REGISTRY_TIMEOUT))?;
    let status = response.status();
    if !status.is_success() {
        return Err(AppError::io(format!("{url} returned HTTP {status}"))
            .with_data(serde_json::json!({ "status": status.as_u16() })));
    }
    if let Some(length) = response.content_length()
        && length > MAX_REGISTRY_BYTES
    {
        return Err(registry_too_large(length));
    }

    let mut body: Vec<u8> = Vec::new();
    // `Content-Length` is a hint at best, so the running total is what actually enforces
    // the limit; the connection is dropped as soon as it is passed.
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| http_error(url, &e, REGISTRY_TIMEOUT))?
    {
        let total = (body.len() as u64).saturating_add(chunk.len() as u64);
        if total > MAX_REGISTRY_BYTES {
            return Err(registry_too_large(total));
        }
        body.extend_from_slice(&chunk);
    }

    let text = String::from_utf8(body)
        .map_err(|_| AppError::io(format!("{url} did not return UTF-8 JSON")))?;
    // A self-hosted index saved by a Windows editor tends to start with a BOM, which
    // `serde_json` refuses.
    Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_string())
}

/// The single error for a registry index past [`MAX_REGISTRY_BYTES`].
fn registry_too_large(bytes: u64) -> AppError {
    AppError::io(format!(
        "the registry index exceeds the {} MiB limit ({bytes} bytes)",
        MAX_REGISTRY_BYTES / (1024 * 1024)
    ))
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
