/**
 * Side effects the Extensions panel shares between the list and the detail pane.
 */

import { openUrl } from '@tauri-apps/plugin-opener';

import { errorMessage, call } from '@/core/ipc/client';
import type { InstallAttempt } from '@/core/plugins/install';

/**
 * `plugins_install_from_url` as an {@link installPlugin} attempt: the zip URL and its
 * checksum are fixed, `replace` is decided per attempt (the first one may fail with
 * "already installed" and be retried after the user agrees).
 */
export function installAttempt(url: string, sha256: string | undefined): InstallAttempt {
  return (replace) =>
    call('plugins_install_from_url', {
      url,
      ...(sha256 ? { sha256 } : {}),
      ...(replace ? { replace: true } : {}),
    });
}

/** Opens a web page in the system browser; reports failures through `onError`. */
export async function openExternal(url: string, onError: (message: string) => void): Promise<void> {
  try {
    await openUrl(url);
  } catch (error) {
    onError(errorMessage(error));
  }
}
