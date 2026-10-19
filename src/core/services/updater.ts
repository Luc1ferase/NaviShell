/**
 * In-app updates (issue #5).
 *
 * Wraps `@tauri-apps/plugin-updater`: a check hits the endpoints configured in
 * `tauri.conf.json` and returns an {@link Update} handle (or `null` when this build is
 * current). All progress lands in {@link useUpdaterStore} so Settings > About can render
 * it; callers only decide whether failures are reported to the user.
 *
 * A missing/404 endpoint (no release published yet) is an ordinary "could not check"
 * error here: silent on startup, a toast for a manual check.
 */

import { isTauri } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';

import { t } from '../i18n';
import { errorMessage } from '../ipc/client';
import { getSettings } from '../stores/settings';
import { useUiStore } from '../stores/ui';
import { useUpdaterStore } from '../stores/updater';
import { openSettingsPanel } from './layout';

/** Give up on an unresponsive update endpoint instead of staying in `checking`. */
const CHECK_TIMEOUT_MS = 30_000;

export interface CheckForUpdatesOptions {
  /** `true` => failures and "up to date" only land in the store, never in a toast. */
  silent?: boolean;
}

/** A check or a download is in flight; the UI disables its buttons on the same test. */
export function isUpdaterBusy(): boolean {
  const { status } = useUpdaterStore.getState();
  return status === 'checking' || status === 'downloading';
}

/** Release the Rust-side resource of an update we are not going to install. */
function dropUpdate(update: Update | null): void {
  if (!update) return;
  void update.close().catch((error) => {
    console.warn('[navishell] could not release the update handle', error);
  });
}

/**
 * Ask the update endpoint for a newer release.
 *
 * Resolves to the announced update, or `null` when this build is current, the check
 * failed, or one was already running.
 */
export async function checkForUpdates(
  options: CheckForUpdatesOptions = {},
): Promise<Update | null> {
  const { silent = false } = options;
  const store = useUpdaterStore.getState();
  if (isUpdaterBusy()) return null;

  if (!isTauri()) {
    // Running in a plain browser (vite dev without Tauri): there is nothing to update.
    store.patch({ status: 'error', error: t('updates.unavailable'), update: null });
    if (!silent) useUiStore.getState().toast(t('updates.unavailable'), 'warning');
    return null;
  }

  dropUpdate(store.update);
  store.patch({
    status: 'checking',
    error: null,
    update: null,
    downloaded: 0,
    contentLength: null,
  });

  try {
    const update = await check({ timeout: CHECK_TIMEOUT_MS });
    if (!update) {
      useUpdaterStore
        .getState()
        .patch({ status: 'upToDate', version: null, date: null, body: null, update: null });
      if (!silent) useUiStore.getState().toast(t('updates.upToDate'), 'success');
      return null;
    }

    useUpdaterStore.getState().patch({
      status: 'available',
      version: update.version,
      date: update.date ?? null,
      body: update.body ?? null,
      update,
    });
    return update;
  } catch (error) {
    const message = errorMessage(error);
    console.warn('[navishell] update check failed', error);
    useUpdaterStore.getState().patch({ status: 'error', error: message, update: null });
    if (!silent) useUiStore.getState().toast(t('updates.checkFailed', { message }), 'error');
    return null;
  }
}

/**
 * Download the update and hand it to the platform installer.
 *
 * On Windows the installer takes over and the app exits (it relaunches itself when it is
 * done); on macOS and Linux the new version is in place and the host stays up, so the UI
 * offers {@link restartApp}.
 */
export async function downloadAndInstall(
  update: Update,
  progressCb?: (downloaded: number, contentLength: number | null) => void,
): Promise<boolean> {
  const store = useUpdaterStore.getState();
  if (store.status === 'downloading') return false;

  let downloaded = 0;
  let contentLength: number | null = null;
  store.patch({ status: 'downloading', downloaded: 0, contentLength: null, error: null });

  const onEvent = (event: DownloadEvent) => {
    switch (event.event) {
      case 'Started':
        contentLength = event.data.contentLength ?? null;
        downloaded = 0;
        useUpdaterStore.getState().patch({ downloaded, contentLength });
        break;
      case 'Progress':
        downloaded += event.data.chunkLength;
        useUpdaterStore.getState().patch({ downloaded });
        break;
      case 'Finished':
        useUpdaterStore.getState().patch({ downloaded, contentLength });
        break;
    }
    progressCb?.(downloaded, contentLength);
  };

  try {
    await update.downloadAndInstall(onEvent);
    useUpdaterStore.getState().patch({ status: 'ready', update: null });
    dropUpdate(update);
    return true;
  } catch (error) {
    const message = errorMessage(error);
    console.error('[navishell] update install failed', error);
    useUpdaterStore.getState().patch({ status: 'error', error: message });
    useUiStore.getState().toast(t('updates.installFailed', { message }), 'error');
    return false;
  }
}

/** Restart into the version that was just installed. */
export async function restartApp(): Promise<void> {
  try {
    await relaunch();
  } catch (error) {
    const message = errorMessage(error);
    useUiStore.getState().toast(t('updates.restartFailed', { message }), 'error');
  }
}

/** Open Settings and scroll to the About section, where the update lives. */
export function revealUpdateSettings(): void {
  openSettingsPanel();
  useUiStore.getState().focusSettingsSection('about');
}

let startupCheckStarted = false;

/**
 * One silent check per app start, right after the plugins are up. An available update is
 * announced with a toast that leads to Settings > About; anything else stays quiet.
 */
export async function runStartupUpdateCheck(): Promise<void> {
  if (startupCheckStarted) return;
  startupCheckStarted = true;
  if (!isTauri() || !getSettings().updates.checkOnStartup) return;

  const update = await checkForUpdates({ silent: true });
  if (!update) return;
  useUiStore.getState().toast(t('updates.availableToast', { version: update.version }), 'info', {
    label: t('updates.view'),
    run: revealUpdateSettings,
  });
}
