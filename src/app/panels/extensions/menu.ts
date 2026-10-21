/**
 * The context menu of a row in the Extensions list: the same install, update, enable,
 * disable and uninstall actions as the detail pane, plus the repository link and the id.
 */

import type { MenuItem } from '@navishell/plugin-api';

import { t } from '@/core/i18n';
import { installPlugin } from '@/core/plugins/install';
import { getSettings } from '@/core/stores/settings';
import { useUiStore } from '@/core/stores/ui';

import { installAttempt, openExternal, toggleExtension, uninstallExtension } from './actions';
import type { ExtensionItem } from './model';

const SEPARATOR: MenuItem = { label: '', separator: true };

export function extensionMenuItems(item: ExtensionItem): MenuItem[] {
  const actions: MenuItem[] = [];
  const entry = item.registry;
  const { action, installed } = item;
  const requiresHost = t('ext.badge.requiresHost', { version: entry?.minHostVersion ?? '' });

  if (action.kind === 'install' && entry) {
    actions.push({
      id: 'install',
      label: item.hostTooOld
        ? `${t('ext.action.install')} (${requiresHost})`
        : t('ext.action.install'),
      icon: 'Download',
      disabled: item.hostTooOld,
      onClick: () => void installPlugin(installAttempt(entry.url, entry.sha256)),
    });
  }
  if (action.kind === 'update' && entry) {
    actions.push({
      id: 'update',
      label: t('ext.action.update', { version: action.latest }),
      icon: 'CircleArrowUp',
      disabled: item.hostTooOld,
      onClick: () => void installPlugin(installAttempt(entry.url, entry.sha256), { replace: true }),
    });
  }
  if (installed) {
    const enabled = !getSettings().plugins.disabled.includes(item.id);
    actions.push({
      id: 'toggle',
      label: enabled ? t('ext.action.disable') : t('ext.action.enable'),
      icon: enabled ? 'CircleOff' : 'CircleCheck',
      onClick: () => void toggleExtension(item, !enabled),
    });
    if (installed.source === 'external') {
      actions.push({
        id: 'uninstall',
        label: t('ext.action.uninstall'),
        icon: 'Trash2',
        danger: true,
        onClick: () => void uninstallExtension(item),
      });
    }
  }

  const links: MenuItem[] = [];
  const repository = entry?.repository;
  if (repository) {
    links.push({
      id: 'repository',
      label: t('ext.menu.openRepository'),
      icon: 'ExternalLink',
      onClick: () =>
        void openExternal(repository, (message) => useUiStore.getState().toast(message, 'error')),
    });
  }
  links.push({
    id: 'copy-id',
    label: t('ext.menu.copyId'),
    icon: 'Copy',
    onClick: () =>
      void navigator.clipboard
        .writeText(item.id)
        .catch((error: unknown) => console.warn('[navishell] clipboard write failed', error)),
  });

  return actions.length > 0 ? [...actions, SEPARATOR, ...links] : links;
}
