/**
 * Side effects the Extensions panel shares between the list and the detail pane.
 */

import { openUrl } from '@tauri-apps/plugin-opener';

import { t } from '@/core/i18n';
import { errorMessage, call } from '@/core/ipc/client';
import type { InstallAttempt } from '@/core/plugins/install';
import { deactivatePlugin, reloadPlugins, setPluginEnabled } from '@/core/plugins/loader';
import { useUiStore } from '@/core/stores/ui';

import type { ExtensionItem } from './model';

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

/** Switches an installed extension on or off; a failure is toasted. */
export async function toggleExtension(item: ExtensionItem, enabled: boolean): Promise<void> {
  try {
    await setPluginEnabled(item.id, enabled);
  } catch (error) {
    useUiStore.getState().toast(errorMessage(error), 'error');
  }
}

/**
 * Asks, then removes an external extension: it is torn down before its files disappear
 * and the plugins are rediscovered afterwards. Resolves to whether it happened.
 */
export async function uninstallExtension(item: ExtensionItem): Promise<boolean> {
  const ui = useUiStore.getState();
  const confirmed = await ui.confirm({
    title: t('plugins.uninstall.title'),
    message: t('plugins.uninstall.message', { name: item.name }),
    okLabel: t('plugins.uninstall.ok'),
    danger: true,
  });
  if (!confirmed) return false;
  try {
    if (item.installed?.status === 'active') await deactivatePlugin(item.id);
    await call('plugins_uninstall', { pluginId: item.id });
    await reloadPlugins();
    ui.toast(t('plugins.uninstall.done', { name: item.name }), 'success');
    return true;
  } catch (error) {
    ui.toast(errorMessage(error), 'error');
    return false;
  }
}
