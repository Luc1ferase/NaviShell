/**
 * Installing external plugins (Settings > Plugins and the marketplace list).
 *
 * The host-side part of `plugins_install_from_url` / `plugins_install_from_file`: ask
 * before replacing an existing install, reload the plugins afterwards so the new one
 * shows up (and activates) without a restart, and report the outcome as a toast.
 */

import { resolveLocalized } from '@navishell/plugin-api';

import type { ExternalPluginInfo } from '../ipc/contract';
import { errorMessage, toHostError } from '../ipc/client';
import { currentLocale, t } from '../i18n';
import { useUiStore } from '../stores/ui';
import { reloadPlugins } from './loader';

/** One install attempt; `replace` overwrites an existing plugin with the same id. */
export type InstallAttempt = (replace: boolean) => Promise<ExternalPluginInfo>;

export interface InstallOptions {
  /** Replace an existing install without asking (the "Update" action already did). */
  replace?: boolean;
}

/**
 * `plugins_install_from_*` rejects with `InvalidArgument` and
 * `data: { exists: true, version }` when that id is installed and `replace` was not set.
 */
export function existingInstall(error: unknown): { version: string | null } | null {
  const host = toHostError(error);
  if (host.code !== 'InvalidArgument') return null;
  const data = host.data;
  if (!data || data.exists !== true) return null;
  // `version` is null when the installed plugin.json could not be read.
  return { version: typeof data.version === 'string' ? data.version : null };
}

/**
 * Runs one install attempt; when that id is already installed, asks whether to replace it
 * and retries once with `replace: true`. Resolves to `null` when the user declined or the
 * install failed (a toast is shown in that case), never rejects.
 */
export async function installPlugin(
  attempt: InstallAttempt,
  options: InstallOptions = {},
): Promise<ExternalPluginInfo | null> {
  const { confirm, toast } = useUiStore.getState();
  try {
    let info: ExternalPluginInfo;
    try {
      info = await attempt(options.replace === true);
    } catch (error) {
      const existing = existingInstall(error);
      if (!existing) throw error;
      const replace = await confirm({
        title: t('plugins.install.replaceTitle'),
        message: existing.version
          ? t('plugins.install.replaceMessage', { version: existing.version })
          : t('plugins.install.replaceMessageUnknown'),
        okLabel: t('plugins.install.replaceOk'),
      });
      if (!replace) return null;
      info = await attempt(true);
    }
    await reloadPlugins();
    const name = resolveLocalized(info.manifest.name, currentLocale()) || info.manifest.id;
    toast(t('plugins.install.done', { name, version: info.manifest.version }), 'success');
    return info;
  } catch (error) {
    toast(errorMessage(error), 'error');
    return null;
  }
}
