/**
 * Context menus of the dock: a tab (close this, others, to the right, all; split out to
 * a new group; maximize) and the empty part of a tab bar (new local shell, the Panels
 * menu, close all). Tabs that cannot be closed (the Home tab, plugin panels declared
 * `closable: false`) are skipped by every close action.
 */

import type { DockviewGroupPanel, IDockviewPanel } from 'dockview-react';
import type { MenuItem } from '@navishell/plugin-api';

import { t } from '@/core/i18n';
import { errorMessage } from '@/core/ipc/client';
import { withMenuContributions } from '@/core/menus/contributions';
import { shortcutLabel } from '@/core/menus/shortcuts';
import { FIXED_TAB_COMPONENT, TERMINAL_PANEL_PREFIX } from '@/core/services/layout';
import { useUiStore } from '@/core/stores/ui';
import { getTerminal, openLocalTerminal } from '@/core/terminal/manager';
import { panelMenuItems } from './panels';

const SEPARATOR: MenuItem = { label: '', separator: true };

function report(error: unknown): void {
  const message = errorMessage(error);
  if (message) useUiStore.getState().toast(message, 'error');
}

function closable(panel: IDockviewPanel): boolean {
  return panel.api.tabComponent !== FIXED_TAB_COMPONENT;
}

function closeAll(panels: IDockviewPanel[]): void {
  for (const panel of panels) {
    if (closable(panel)) panel.api.close();
  }
}

function newLocalShellItem(): MenuItem {
  return {
    id: 'new-local-shell',
    label: t('menu.terminal.newLocalShell'),
    icon: 'SquareTerminal',
    shortcut: shortcutLabel('Ctrl+Shift+`'),
    onClick: () => void openLocalTerminal().catch(report),
  };
}

export function tabMenuItems(panel: IDockviewPanel): MenuItem[] {
  const group = panel.api.group;
  const siblings = group.panels;
  const index = siblings.indexOf(panel);
  const others = siblings.filter((candidate) => candidate !== panel && closable(candidate));
  const right = siblings.slice(index + 1).filter(closable);
  const maximized = panel.api.isMaximized();
  const base: MenuItem[] = [
    {
      id: 'close',
      label: t('menu.tab.close'),
      icon: 'X',
      disabled: !closable(panel),
      onClick: () => panel.api.close(),
    },
    {
      id: 'close-others',
      label: t('menu.tab.closeOthers'),
      disabled: others.length === 0,
      onClick: () => closeAll(others),
    },
    {
      id: 'close-right',
      label: t('menu.tab.closeRight'),
      disabled: right.length === 0,
      onClick: () => closeAll(right),
    },
    {
      id: 'close-all',
      label: t('menu.tab.closeAll'),
      disabled: siblings.every((candidate) => !closable(candidate)),
      onClick: () => closeAll(siblings),
    },
    SEPARATOR,
    // Moving the only tab of a group next to its own group changes nothing.
    {
      id: 'split-right',
      label: t('menu.tab.splitRight'),
      icon: 'SquareSplitHorizontal',
      disabled: siblings.length < 2,
      onClick: () => panel.api.moveTo({ group, position: 'right' }),
    },
    {
      id: 'split-down',
      label: t('menu.tab.splitDown'),
      icon: 'SquareSplitVertical',
      disabled: siblings.length < 2,
      onClick: () => panel.api.moveTo({ group, position: 'bottom' }),
    },
    SEPARATOR,
    maximized
      ? {
          id: 'restore',
          label: t('menu.tab.restore'),
          icon: 'Minimize2',
          onClick: () => panel.api.exitMaximized(),
        }
      : {
          id: 'maximize',
          label: t('menu.tab.maximize'),
          icon: 'Maximize2',
          onClick: () => panel.api.maximize(),
        },
  ];
  const terminal = panel.id.startsWith(TERMINAL_PANEL_PREFIX)
    ? getTerminal(panel.id.slice(TERMINAL_PANEL_PREFIX.length))
    : undefined;
  return withMenuContributions(base, 'tab', {
    panelId: panel.id,
    title: panel.title ?? panel.id,
    ...(terminal ? { terminal } : {}),
  });
}

/** The menu of the empty part of a group's tab bar. */
export function tabBarMenuItems(group: DockviewGroupPanel | undefined): MenuItem[] {
  const panels = group?.panels ?? [];
  return [
    newLocalShellItem(),
    SEPARATOR,
    {
      id: 'panels',
      label: t('menu.tab.panels'),
      icon: 'PanelsTopLeft',
      submenu: panelMenuItems(),
    },
    SEPARATOR,
    {
      id: 'close-all',
      label: t('menu.tab.closeAll'),
      disabled: panels.every((candidate) => !closable(candidate)),
      onClick: () => closeAll(panels),
    },
  ];
}
