/**
 * The four dropdowns of the title bar's menu bar: Connection, Terminal, View and Help.
 *
 * Each builder returns a fresh `MenuItem[]`, because every entry's contents depend on
 * live state (the server list, the active terminal, which panels are open, the theme) and
 * the menu bar calls the builder again on every open.
 */

import { openUrl } from '@tauri-apps/plugin-opener';
import type { MenuItem } from '@navishell/plugin-api';

import { t } from '@/core/i18n';
import { errorMessage } from '@/core/ipc/client';
import { shortcutLabel } from '@/core/menus/shortcuts';
import { disconnectConnection } from '@/core/services/connect';
import { openSettingsPanel } from '@/core/services/layout';
import { checkForUpdates } from '@/core/services/updater';
import { useConnectionsStore } from '@/core/stores/connections';
import { useServersStore } from '@/core/stores/servers';
import { useSettingsStore } from '@/core/stores/settings';
import { useUiStore } from '@/core/stores/ui';
import {
  getActiveTerminal,
  openLocalTerminal,
  openTerminalForServer,
  requestCloseTerminalPanel,
  revealOrOpenTerminal,
} from '@/core/terminal/manager';
import { panelMenuItems } from './panels';

const SEPARATOR: MenuItem = { label: '', separator: true };

const REPOSITORY_URL = 'https://github.com/Luc1ferase/NaviShell';
const NEW_ISSUE_URL = `${REPOSITORY_URL}/issues/new`;

/** Surfaces a failed action as a toast; menus have nowhere else to put an error. */
function report(error: unknown): void {
  const message = errorMessage(error);
  if (message) useUiStore.getState().toast(message, 'error');
}

/** Servers, each opening (or revealing) a shell on it, like the old quick-connect list. */
function serverItems(): MenuItem[] {
  const { servers } = useServersStore.getState();
  if (servers.length === 0) {
    return [{ label: t('menu.connection.noServers'), disabled: true }];
  }
  return servers.map((server) => ({
    id: server.id,
    label: `${server.name} — ${server.username}@${server.host}`,
    icon: 'Server',
    onClick: () => void revealOrOpenTerminal(server.id).catch(report),
  }));
}

export function connectionMenuItems(): MenuItem[] {
  const { connections } = useConnectionsStore.getState();
  return [
    {
      id: 'new-server',
      label: t('menu.connection.newServer'),
      icon: 'Plus',
      onClick: () => useUiStore.getState().openServerForm(),
    },
    SEPARATOR,
    ...serverItems(),
    SEPARATOR,
    {
      id: 'disconnect-all',
      label: t('menu.connection.disconnectAll'),
      icon: 'Unplug',
      disabled: connections.length === 0,
      onClick: () => {
        void Promise.all(
          connections.map((connection) => disconnectConnection(connection.id)),
        ).catch(report);
      },
    },
  ];
}

export function terminalMenuBarItems(): MenuItem[] {
  const session = getActiveTerminal();
  const serverId = session && session.kind !== 'local' ? session.serverId : null;
  const items: MenuItem[] = [
    {
      id: 'new-local-shell',
      label: t('menu.terminal.newLocalShell'),
      icon: 'SquareTerminal',
      shortcut: shortcutLabel('Ctrl+Shift+`'),
      onClick: () => void openLocalTerminal().catch(report),
    },
  ];
  // Only an SSH terminal has a host to open another shell on.
  if (session && serverId !== null) {
    items.push({
      id: 'new-terminal',
      label: t('menu.terminal.newTerminalHere', { name: session.serverName }),
      icon: 'SquareTerminal',
      onClick: () => void openTerminalForServer(serverId).catch(report),
    });
  }
  items.push(
    SEPARATOR,
    {
      id: 'clear',
      label: t('menu.terminal.clear'),
      icon: 'Eraser',
      disabled: !session,
      onClick: () => session?.xterm.clear(),
    },
    {
      id: 'close',
      label: t('menu.terminal.close'),
      icon: 'X',
      disabled: !session,
      onClick: () => {
        if (session) requestCloseTerminalPanel(session.id);
      },
    },
  );
  return items;
}

/** The three UI themes as a radio group; the active one carries the check mark. */
function themeItems(): MenuItem[] {
  const { settings, update } = useSettingsStore.getState();
  return (['system', 'dark', 'light'] as const).map((theme) => ({
    id: theme,
    label: t(`settings.theme.${theme}`),
    checked: settings.theme === theme,
    onClick: () => update((prev) => ({ ...prev, theme })),
  }));
}

export function viewMenuItems(): MenuItem[] {
  return [
    ...panelMenuItems(),
    SEPARATOR,
    {
      id: 'theme',
      label: t('menu.view.theme'),
      icon: 'SunMoon',
      submenu: themeItems(),
    },
  ];
}

export function helpMenuItems(): MenuItem[] {
  return [
    {
      id: 'about',
      label: t('menu.help.about'),
      icon: 'Info',
      onClick: () => {
        useUiStore.getState().focusSettingsSection('about');
        openSettingsPanel();
      },
    },
    {
      id: 'check-updates',
      label: t('menu.help.checkUpdates'),
      icon: 'RefreshCw',
      onClick: () => void checkForUpdates({ silent: false }).catch(report),
    },
    SEPARATOR,
    {
      // lucide dropped its brand icons, so the generic "leaves the app" icon stands in.
      id: 'repository',
      label: t('menu.help.repository'),
      icon: 'ExternalLink',
      onClick: () => void openUrl(REPOSITORY_URL).catch(report),
    },
    {
      id: 'report-issue',
      label: t('menu.help.reportIssue'),
      icon: 'Bug',
      onClick: () => void openUrl(NEW_ISSUE_URL).catch(report),
    },
  ];
}

/** One top-level menu bar entry: its label key and the builder for its dropdown. */
export interface MenuBarEntry {
  id: string;
  labelKey: string;
  items(): MenuItem[];
}

export const MENU_BAR_ENTRIES: readonly MenuBarEntry[] = [
  { id: 'connection', labelKey: 'menubar.connection', items: connectionMenuItems },
  { id: 'terminal', labelKey: 'menubar.terminal', items: terminalMenuBarItems },
  { id: 'view', labelKey: 'menubar.view', items: viewMenuItems },
  { id: 'help', labelKey: 'menubar.help', items: helpMenuItems },
];
