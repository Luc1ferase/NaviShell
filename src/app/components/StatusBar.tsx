import type { MouseEvent } from 'react';
import { Fingerprint, Languages, Plug, SquareTerminal, SunMoon, Wifi, WifiOff } from 'lucide-react';
import type { MenuItem } from '@navishell/plugin-api';

import { useI18n } from '@/core/i18n/useI18n';
import { useConnectionsStore } from '@/core/stores/connections';
import { usePluginsStore } from '@/core/stores/plugins';
import { useSettingsStore } from '@/core/stores/settings';
import { useTerminalsStore } from '@/core/stores/terminals';
import { useUiStore } from '@/core/stores/ui';

function shortFingerprint(fingerprint: string): string {
  const body = fingerprint.startsWith('SHA256:') ? fingerprint.slice(7) : fingerprint;
  return body.length > 14 ? `${body.slice(0, 14)}…` : body;
}

export function StatusBar() {
  const { t, locale } = useI18n();
  const connections = useConnectionsStore((state) => state.connections);
  const records = useTerminalsStore((state) => state.records);
  const activeId = useTerminalsStore((state) => state.activeId);
  const terminalCount = useTerminalsStore((state) => state.order.length);
  const activePlugins = usePluginsStore(
    (state) => state.entries.filter((entry) => entry.status === 'active').length,
  );
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const showContextMenu = useUiStore((state) => state.showContextMenu);

  const activeRecord = activeId ? records[activeId] : undefined;
  const activeConnection =
    connections.find((connection) => connection.id === activeRecord?.connectionId) ??
    connections[0];

  const openMenu = (event: MouseEvent<HTMLButtonElement>, items: MenuItem[]) => {
    const rect = event.currentTarget.getBoundingClientRect();
    showContextMenu(items, { x: rect.left, y: rect.top - 6 - items.length * 26 });
  };

  const localeItems: MenuItem[] = [
    {
      id: 'system',
      label: t('settings.locale.system'),
      onClick: () => update((prev) => ({ ...prev, locale: 'system' })),
    },
    {
      id: 'zh-CN',
      label: '简体中文',
      onClick: () => update((prev) => ({ ...prev, locale: 'zh-CN' })),
    },
    {
      id: 'en',
      label: 'English',
      onClick: () => update((prev) => ({ ...prev, locale: 'en' })),
    },
  ];

  const themeItems: MenuItem[] = (['system', 'dark', 'light'] as const).map((theme) => ({
    id: theme,
    label: t(`settings.theme.${theme}`),
    onClick: () => update((prev) => ({ ...prev, theme })),
  }));

  return (
    <footer className="ns-statusbar">
      <span className="ns-statusbar__item">
        {activeConnection ? <Wifi size={12} /> : <WifiOff size={12} />}
        <span className="ns-statusbar__mono">
          {activeConnection
            ? `${activeConnection.username}@${activeConnection.host}:${activeConnection.port}`
            : t('status.notConnected')}
        </span>
      </span>

      {activeConnection ? (
        <span className="ns-statusbar__item" title={activeConnection.hostKeyFingerprint}>
          <Fingerprint size={12} />
          <span className="ns-statusbar__mono">
            {shortFingerprint(activeConnection.hostKeyFingerprint)}
          </span>
        </span>
      ) : null}

      <span className="ns-statusbar__item">
        <SquareTerminal size={12} />
        {t('status.terminals', { n: terminalCount })}
      </span>

      <span className="ns-statusbar__item">
        <Plug size={12} />
        {t('status.plugins', { n: activePlugins })}
      </span>

      <span className="ns-statusbar__spacer" />

      <button
        type="button"
        className="ns-statusbar__item ns-statusbar__item--button"
        onClick={(event) => openMenu(event, localeItems)}
        title={t('status.localeTooltip')}
      >
        <Languages size={12} />
        {locale === 'zh-CN' ? '中文' : 'EN'}
      </button>

      <button
        type="button"
        className="ns-statusbar__item ns-statusbar__item--button"
        onClick={(event) => openMenu(event, themeItems)}
        title={t('status.themeTooltip')}
      >
        <SunMoon size={12} />
        {t(`settings.theme.${settings.theme}`)}
      </button>
    </footer>
  );
}
