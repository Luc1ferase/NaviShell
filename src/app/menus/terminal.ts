/**
 * The terminal's context menu: clipboard, selection, clearing, another shell on the same
 * host, whatever plugins add for terminals, and closing the tab.
 */

import type { MenuItem } from '@navishell/plugin-api';

import { t } from '@/core/i18n';
import { errorMessage } from '@/core/ipc/client';
import { withMenuContributions } from '@/core/menus/contributions';
import { isMac, shortcutLabel } from '@/core/menus/shortcuts';
import { useUiStore } from '@/core/stores/ui';
import {
  openLocalTerminal,
  openTerminalForServer,
  requestCloseTerminalPanel,
} from '@/core/terminal/manager';
import type { TerminalSession } from '@/core/terminal/session';

const SEPARATOR: MenuItem = { label: '', separator: true };

function report(error: unknown): void {
  const message = errorMessage(error);
  if (message) useUiStore.getState().toast(message, 'error');
}

/** Another terminal like this one: a local shell, or a shell on the same server. */
function openAnotherItem(session: TerminalSession): MenuItem {
  const serverId = session.serverId;
  if (session.kind === 'local' || serverId === null) {
    return {
      id: 'new-local-shell',
      label: t('menu.terminal.newLocalShell'),
      icon: 'SquareTerminal',
      shortcut: shortcutLabel('Ctrl+Shift+`'),
      onClick: () => void openLocalTerminal().catch(report),
    };
  }
  return {
    id: 'new-terminal',
    label: t('menu.terminal.newTerminalHere', { name: session.serverName }),
    icon: 'SquareTerminal',
    onClick: () => void openTerminalForServer(serverId).catch(report),
  };
}

export function terminalMenuItems(session: TerminalSession): MenuItem[] {
  const selection = session.xterm.getSelection();
  // On macOS the native Cmd+C/V reach xterm; elsewhere the session binds Ctrl+Shift+C/V.
  const base: MenuItem[] = [
    {
      id: 'copy',
      label: t('menu.terminal.copy'),
      icon: 'Copy',
      shortcut: shortcutLabel(isMac ? 'Mod+C' : 'Ctrl+Shift+C'),
      disabled: selection === '',
      onClick: () => void session.copySelection(),
    },
    {
      id: 'paste',
      label: t('menu.terminal.paste'),
      icon: 'ClipboardPaste',
      shortcut: shortcutLabel(isMac ? 'Mod+V' : 'Ctrl+Shift+V'),
      onClick: () => void session.pasteFromClipboard(),
    },
    {
      id: 'select-all',
      label: t('menu.terminal.selectAll'),
      icon: 'TextSelect',
      onClick: () => session.xterm.selectAll(),
    },
    SEPARATOR,
    {
      id: 'clear',
      label: t('menu.terminal.clear'),
      icon: 'Eraser',
      onClick: () => session.xterm.clear(),
    },
    SEPARATOR,
    openAnotherItem(session),
  ];
  const items = withMenuContributions(base, 'terminal', { terminal: session, selection });
  return [
    ...items,
    SEPARATOR,
    {
      id: 'close',
      label: t('menu.terminal.close'),
      icon: 'X',
      onClick: () => requestCloseTerminalPanel(session.id),
    },
  ];
}
