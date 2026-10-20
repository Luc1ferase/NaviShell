import type { MouseEvent } from 'react';
import {
  Blocks,
  ChevronRight,
  PanelsTopLeft,
  Plus,
  Settings as SettingsIcon,
  SquareTerminal,
} from 'lucide-react';
import type { MenuItem } from '@navishell/plugin-api';

import { useI18n } from '@/core/i18n/useI18n';
import { errorMessage } from '@/core/ipc/client';
import { openExtensionsPanel, openSettingsPanel } from '@/core/services/layout';
import { usePluginUpdates } from '@/core/services/pluginUpdates';
import { useServersStore } from '@/core/stores/servers';
import { useUiStore } from '@/core/stores/ui';
import { panelMenuItems } from '@/app/menus/panels';
import { openLocalTerminal, revealOrOpenTerminal } from '@/core/terminal/manager';

export function TopBar() {
  const { t } = useI18n();
  const servers = useServersStore((state) => state.servers);
  const showContextMenu = useUiStore((state) => state.showContextMenu);
  const openServerForm = useUiStore((state) => state.openServerForm);
  const toast = useUiStore((state) => state.toast);

  const connect = (serverId: string) => {
    void revealOrOpenTerminal(serverId).catch((error) => {
      if (errorMessage(error)) toast(errorMessage(error), 'error');
    });
  };

  const newLocalTerminal = () => {
    void openLocalTerminal().catch((error) => {
      if (errorMessage(error)) toast(errorMessage(error), 'error');
    });
  };

  const openQuickConnect = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const items: MenuItem[] =
      servers.length === 0
        ? [{ label: t('topbar.noServers'), disabled: true }]
        : servers.map((server) => ({
            id: server.id,
            label: `${server.name} — ${server.username}@${server.host}`,
            icon: 'Server',
            onClick: () => connect(server.id),
          }));
    showContextMenu(items, { x: rect.left, y: rect.bottom + 4 });
  };

  const pluginUpdates = usePluginUpdates().length;

  const openPanelsMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    showContextMenu(panelMenuItems(), { x: rect.left, y: rect.bottom + 4 });
  };

  return (
    <header className="ns-topbar">
      <div className="ns-topbar__brand">
        <SquareTerminal size={16} />
        NaviShell
      </div>

      <button
        type="button"
        className="ns-btn ns-btn--ghost"
        onClick={openQuickConnect}
        title={t('topbar.quickConnect')}
      >
        <ChevronRight size={14} />
        {t('topbar.quickConnect')}
      </button>

      <button
        type="button"
        className="ns-btn ns-btn--ghost"
        onClick={newLocalTerminal}
        title={t('topbar.newLocalTerminalTooltip')}
      >
        <SquareTerminal size={14} />
        {t('topbar.newLocalTerminal')}
      </button>

      <button
        type="button"
        className="ns-btn ns-btn--ghost"
        onClick={openPanelsMenu}
        title={t('topbar.panelsTooltip')}
      >
        <PanelsTopLeft size={14} />
        {t('topbar.panels')}
      </button>

      <button
        type="button"
        className="ns-btn ns-btn--ghost"
        onClick={() => openExtensionsPanel(pluginUpdates > 0 ? 'updates' : undefined)}
        title={
          pluginUpdates > 0
            ? t('topbar.extensionsUpdatesTooltip', { count: pluginUpdates })
            : t('topbar.extensionsTooltip')
        }
      >
        <Blocks size={14} />
        {t('topbar.extensions')}
        {pluginUpdates > 0 ? (
          <span className="ns-badge ns-badge--accent ns-badge--xs">{pluginUpdates}</span>
        ) : null}
      </button>

      <div className="ns-topbar__spacer" />

      <button type="button" className="ns-btn ns-btn--ghost" onClick={() => openServerForm()}>
        <Plus size={14} />
        {t('topbar.newServer')}
      </button>
      <button type="button" className="ns-btn ns-btn--ghost" onClick={openSettingsPanel}>
        <SettingsIcon size={14} />
        {t('topbar.settings')}
      </button>
    </header>
  );
}
