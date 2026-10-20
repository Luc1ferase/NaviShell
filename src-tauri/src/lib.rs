//! NaviShell core (Rust side).
//!
//! The core deliberately stays small: server records, credentials, SSH connections,
//! terminals (PTY channels), command execution, SFTP primitives, plugin discovery,
//! installation and storage. Everything user-facing beyond that lives in frontend
//! plugins.
//!
//! The command surface is specified in `src/core/ipc/contract.ts` (frontend repo root);
//! every command registered below appears there, and every error is an [`error::AppError`]
//! which the frontend reads as `HostError`.

mod error;
mod fonts;
mod known_hosts;
mod local_pty;
mod plugins;
mod secrets;
mod servers;
mod settings;
mod ssh;
mod state;
mod storage;
mod util;

use tauri::Manager;

use crate::state::AppState;

/// Installs the log subscriber. `RUST_LOG` overrides the default `info` level.
fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    if let Err(err) = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init()
    {
        eprintln!("could not install the log subscriber: {err}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    // In-app updates (issue #5). Both plugins are desktop-only: the updater replaces the
    // installed bundle, and `process` restarts into it once the user accepts. The feed is
    // configured under `plugins.updater` in tauri.conf.json.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .setup(|app| {
            let handle = app.handle().clone();
            storage::ensure_layout(&handle)?;
            tracing::info!(
                version = %app.package_info().version,
                data_dir = %storage::path_string(&storage::app_data_dir(&handle)?),
                "NaviShell starting"
            );
            app.manage(AppState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // app, settings and layout
            settings::app_info,
            settings::settings_get,
            settings::settings_set,
            settings::layout_get,
            settings::layout_set,
            // installed fonts (Settings font picker)
            fonts::fonts_list,
            // server records
            servers::servers_list,
            servers::servers_save,
            servers::servers_delete,
            // credentials
            secrets::credential_exists,
            secrets::credential_set,
            secrets::credential_delete,
            // ssh sessions
            ssh::connection::ssh_connect,
            ssh::connection::ssh_disconnect,
            ssh::connection::ssh_list_connections,
            ssh::connection::ssh_auth_respond,
            ssh::exec::ssh_exec,
            // terminals
            ssh::terminal::term_open,
            local_pty::term_open_local,
            ssh::terminal::term_write,
            ssh::terminal::term_resize,
            ssh::terminal::term_close,
            // sftp
            ssh::sftp::sftp_home,
            ssh::sftp::sftp_list,
            ssh::sftp::sftp_stat,
            ssh::sftp::sftp_mkdir,
            ssh::sftp::sftp_rename,
            ssh::sftp::sftp_remove,
            ssh::sftp::sftp_read_text,
            ssh::sftp::sftp_write_text,
            ssh::sftp::sftp_download,
            ssh::sftp::sftp_upload,
            ssh::sftp::sftp_cancel,
            // plugins
            plugins::plugins_list_external,
            plugins::plugins_read_file,
            plugins::plugins_install_from_url,
            plugins::plugins_install_from_file,
            plugins::plugins_uninstall,
            plugins::plugins_fetch_registry,
            plugins::plugin_storage_get,
            plugins::plugin_storage_set,
            plugins::plugin_storage_remove,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
