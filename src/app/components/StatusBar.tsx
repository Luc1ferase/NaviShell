import type { MouseEvent } from 'react';
import {
  CircleArrowUp,
  Fingerprint,
  Languages,
  Monitor,
  Plug,
  ShieldCheck,
  SquareTerminal,
  SunMoon,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { ConnectionInfo, MenuItem } from '@navishell/plugin-api';

import { localeName } from '@/core/i18n';
import { useAvailableLocales, useI18n } from '@/core/i18n/useI18n';
import { openExtensionsPanel } from '@/core/services/layout';
import { usePluginUpdates } from '@/core/services/pluginUpdates';
import { useConnectionsStore } from '@/core/stores/connections';
import { usePluginsStore } from '@/core/stores/plugins';
import { useServersStore } from '@/core/stores/servers';
import { useSettingsStore } from '@/core/stores/settings';
import { useTerminalsStore } from '@/core/stores/terminals';
import { useUiStore } from '@/core/stores/ui';
import { panelMenuItems } from '@/app/menus/panels';

function shortFingerprint(fingerprint: string): string {
  const body = fingerprint.startsWith('SHA256:') ? fingerprint.slice(7) : fingerprint;
  return body.length > 14 ? `${body.slice(0, 14)}…` : body;
}

export function StatusBar() {
  const { t, locale } = useI18n();
  const locales = useAvailableLocales();
  const connections = useConnectionsStore((state) => state.connections);
  const servers = useServersStore((state) => state.servers);
  const records = useTerminalsStore((state) => state.records);
  const activeId = useTerminalsStore((state) => state.activeId);
  const terminalCount = useTerminalsStore((state) => state.order.length);
  const activePlugins = usePluginsStore(
    (state) => state.entries.filter((entry) => entry.status === 'active').length,
  );
  const pluginUpdates = usePluginUpdates().length;
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const showContextMenu = useUiStore((state) => state.showContextMenu);

  const activeRecord = activeId ? records[activeId] : undefined;
  const localActive = activeRecord?.kind === 'local';
  const activeConnection = localActive
    ? undefined
    : (connections.find((connection) => connection.id === activeRecord?.connectionId) ??
      connections[0]);

  /** Name of the jump host a connection is tunnelled through, if any. */
  const viaLabel = (connection: ConnectionInfo): string | null => {
    if (!connection.viaConnectionId) return null;
    const via = connections.find((candidate) => candidate.id === connection.viaConnectionId);
    if (!via) return t('status.viaUnknown');
    return servers.find((server) => server.id === via.serverId)?.name ?? via.host;
  };

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
    ...locales.map((info) => ({
      id: info.id,
      label: info.name,
      onClick: () => update((prev) => ({ ...prev, locale: info.id })),
    })),
  ];
  // Short label for the status bar; packs show their native name.
  const localeLabel = locale === 'en' ? 'EN' : locale === 'zh-CN' ? '中文' : localeName(locale);

  const themeItems: MenuItem[] = (['system', 'dark', 'light'] as const).map((theme) => ({
    id: theme,
    label: t(`settings.theme.${theme}`),
    onClick: () => update((prev) => ({ ...prev, theme })),
  }));

  const via = activeConnection ? viaLabel(activeConnection) : null;

  return (
    <footer className="ns-statusbar">
      <span className="ns-statusbar__item">
        {localActive ? (
          <Monitor size={12} />
        ) : activeConnection ? (
          <Wifi size={12} />
        ) : (
          <WifiOff size={12} />
        )}
        <span className="ns-statusbar__mono">
          {localActive
            ? t('status.localShell')
            : activeConnection
              ? `${activeConnection.username}@${activeConnection.host}:${activeConnection.port}${
                  via ? ` ${t('servers.via', { name: via })}` : ''
                }`
              : t('status.notConnected')}
        </span>
      </span>

      {activeConnection ? (
        <span
          className="ns-statusbar__item"
          title={t('status.authMethodTooltip', {
            method: t(`servers.auth.${activeConnection.authMethod}`),
          })}
        >
          <ShieldCheck size={12} />
          {t(`servers.auth.${activeConnection.authMethod}`)}
        </span>
      ) : null}

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

      <button
        type="button"
        className="ns-statusbar__item ns-statusbar__item--button"
        onClick={(event) => openMenu(event, panelMenuItems())}
        title={t('topbar.panelsTooltip')}
      >
        <Plug size={12} />
        {t('status.plugins', { n: activePlugins })}
      </button>

      {pluginUpdates > 0 ? (
        <button
          type="button"
          className="ns-statusbar__item ns-statusbar__item--button ns-statusbar__item--accent"
          onClick={() => openExtensionsPanel('updates')}
          title={t('topbar.extensionsUpdatesTooltip', { count: pluginUpdates })}
        >
          <CircleArrowUp size={12} />
          {t('status.pluginUpdates', { n: pluginUpdates })}
        </button>
      ) : null}

      <span className="ns-statusbar__spacer" />

      <button
        type="button"
        className="ns-statusbar__item ns-statusbar__item--button"
        onClick={(event) => openMenu(event, localeItems)}
        title={t('status.localeTooltip')}
      >
        <Languages size={12} />
        {localeLabel}
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
