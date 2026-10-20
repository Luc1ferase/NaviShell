//! Application info, user settings and the persisted window layout.
//!
//! The defaults below mirror `DEFAULT_SETTINGS` in `src/core/ipc/contract.ts`. Every
//! struct carries `#[serde(default)]`, so a settings file written by an older (or newer)
//! version is merged field by field onto the defaults instead of being rejected.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::error::AppResult;
use crate::state::AppState;
use crate::storage::{self, AppPaths};

/// Colour theme.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Dark,
    Light,
    System,
}

/// Terminal cursor shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CursorStyle {
    #[default]
    Block,
    Underline,
    Bar,
}

/// Appearance and behaviour of terminal panels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TerminalSettings {
    pub font_family: String,
    pub font_size: f64,
    pub line_height: f64,
    pub cursor_blink: bool,
    pub cursor_style: CursorStyle,
    pub scrollback: u32,
    /// Prefer the WebGL renderer when the WebView supports it.
    pub webgl: bool,
    /// Value sent as `TERM` when opening a PTY.
    pub term_type: String,
    /// Built-in color scheme ids used while the UI theme is dark / light (resolved by the
    /// frontend; unknown ids fall back there).
    pub color_scheme: ColorSchemeSettings,
    /// xterm `minimumContrastRatio`; 1 disables it, 4.5 is WCAG AA.
    pub minimum_contrast_ratio: f64,
}

/// Which terminal color scheme to use under each resolved UI theme.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ColorSchemeSettings {
    pub dark: String,
    pub light: String,
}

impl Default for ColorSchemeSettings {
    fn default() -> Self {
        Self {
            dark: "navishell-dark".to_string(),
            light: "navishell-light".to_string(),
        }
    }
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            font_family: "\"Cascadia Mono\", \"JetBrains Mono\", Menlo, Consolas, \"DejaVu Sans Mono\", monospace".to_string(),
            font_size: 14.0,
            line_height: 1.2,
            cursor_blink: true,
            cursor_style: CursorStyle::Block,
            scrollback: 5000,
            webgl: true,
            term_type: "xterm-256color".to_string(),
            color_scheme: ColorSchemeSettings::default(),
            minimum_contrast_ratio: 4.5,
        }
    }
}

/// Plugin related preferences.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PluginSettings {
    /// Plugin ids the user switched off.
    pub disabled: Vec<String>,
    /// Marketplace index URL; `None` means the built-in default.
    pub registry_url: Option<String>,
    /// Panel ids that were auto-opened once already.
    pub seen_panels: Vec<String>,
    /// Fetch the marketplace index in the background and badge available updates.
    pub check_updates: bool,
    /// Install the updates this host supports as soon as a check finds them.
    pub auto_update: bool,
}

impl Default for PluginSettings {
    fn default() -> Self {
        Self {
            disabled: Vec::new(),
            registry_url: None,
            seen_panels: Vec::new(),
            check_updates: true,
            auto_update: false,
        }
    }
}

/// Everything stored in `settings.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// UI language tag (`en`, `zh-CN`, or one contributed by a language-pack plugin);
    /// `system` follows the OS locale. Resolved by the frontend, so it is an open string.
    pub locale: String,
    pub theme: Theme,
    pub terminal: TerminalSettings,
    pub plugins: PluginSettings,
    /// Close the SSH connection when its last terminal closes.
    pub close_connection_with_last_terminal: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            locale: "system".to_string(),
            theme: Theme::default(),
            terminal: TerminalSettings::default(),
            plugins: PluginSettings::default(),
            close_connection_with_last_terminal: true,
        }
    }
}

/// Host platform, as reported to the frontend.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Windows,
    Macos,
    Linux,
    Other,
}

impl Platform {
    fn current() -> Self {
        match std::env::consts::OS {
            "windows" => Self::Windows,
            "macos" => Self::Macos,
            "linux" => Self::Linux,
            _ => Self::Other,
        }
    }
}

/// Version, platform and data directories.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub platform: Platform,
    pub arch: String,
    pub paths: AppPaths,
}

/// Version, platform and the absolute paths the frontend may show to the user.
#[tauri::command]
pub async fn app_info(app: AppHandle) -> AppResult<AppInfo> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        platform: Platform::current(),
        arch: std::env::consts::ARCH.to_string(),
        paths: storage::app_paths(&app)?,
    })
}

/// Current settings; defaults for everything the file does not (or cannot) provide.
#[tauri::command]
pub async fn settings_get(app: AppHandle) -> AppResult<AppSettings> {
    let path = storage::data_file(&app, storage::SETTINGS_FILE)?;
    Ok(storage::read_json_lenient::<AppSettings>(&path)
        .await
        .unwrap_or_default())
}

/// Replaces the whole settings file.
#[tauri::command]
pub async fn settings_set(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    settings: AppSettings,
) -> AppResult<()> {
    let path = storage::data_file(&app, storage::SETTINGS_FILE)?;
    let _guard = state.storage_guard().await;
    storage::write_json(&path, &settings).await
}

/// The serialised dockview layout, or `null` when nothing was saved yet.
#[tauri::command]
pub async fn layout_get(app: AppHandle) -> AppResult<Option<serde_json::Value>> {
    let path = storage::data_file(&app, storage::LAYOUT_FILE)?;
    Ok(storage::read_json_lenient::<serde_json::Value>(&path).await)
}

/// Stores the serialised dockview layout.
#[tauri::command]
pub async fn layout_set(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    layout: serde_json::Value,
) -> AppResult<()> {
    let path = storage::data_file(&app, storage::LAYOUT_FILE)?;
    let _guard = state.storage_guard().await;
    storage::write_json(&path, &layout).await
}
