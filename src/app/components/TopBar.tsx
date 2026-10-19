import type { MouseEvent } from 'react';
import { ChevronRight, Plus, Settings as SettingsIcon, SquareTerminal } from 'lucide-react';
import type { MenuItem } from '@navishell/plugin-api';

import { useI18n } from '@/core/i18n/useI18n';
import { errorMessage } from '@/core/ipc/client';
import { openSettingsPanel } from '@/core/services/layout';
import { useServersStore } from '@/core/stores/servers';
import { useUiStore } from '@/core/stores/ui';
import { revealOrOpenTerminal } from '@/core/terminal/manager';

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
