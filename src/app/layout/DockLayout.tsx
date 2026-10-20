import { useCallback, useEffect, useRef, type FunctionComponent } from 'react';
import {
  DockviewDefaultTab,
  DockviewReact,
  themeDark,
  themeLight,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from 'dockview-react';
import type { JsonValue } from '@navishell/plugin-api';

import { useI18n } from '@/core/i18n/useI18n';
import { useAppliedTheme } from '@/core/services/theme';
import { onDidRegisterPanel } from '@/core/plugins/registry';
import {
  FIXED_TAB_COMPONENT,
  TERMINAL_PANEL_PREFIX,
  TERMINAL_TAB_COMPONENT,
  applyDefaultLayout,
  maybeAutoOpenPanel,
  restoreLayout,
  runPendingAutoOpen,
  scheduleLayoutPersist,
  setDockApi,
  type TerminalPanelParams,
} from '@/core/services/layout';
import { useConnectionsStore } from '@/core/stores/connections';
import { useServersStore } from '@/core/stores/servers';
import { useTerminalsStore } from '@/core/stores/terminals';
import { closeTerminal, setActiveTerminal } from '@/core/terminal/manager';
import { HomePanel } from '@/app/panels/HomePanel';
import { PanelHost } from '@/app/panels/PluginPanel';
import { TerminalPanel } from '@/app/panels/TerminalPanel';

function FixedTab(props: IDockviewPanelHeaderProps) {
  return <DockviewDefaultTab hideClose {...props} />;
}

/** Terminal tab with a tooltip describing where the session runs. */
function TerminalTab(props: IDockviewPanelHeaderProps<TerminalPanelParams>) {
  const { t } = useI18n();
  const params = props.params;
  const record = useTerminalsStore((state) => state.records[params.terminalId]);
  const connections = useConnectionsStore((state) => state.connections);
  const servers = useServersStore((state) => state.servers);

  let tooltip = params.serverName;
  if (params.kind === 'local') {
    tooltip = t('terminal.localTitle');
  } else {
    const connection = connections.find((entry) => entry.id === record?.connectionId);
    if (connection) {
      tooltip = `${connection.username}@${connection.host}:${connection.port}`;
      if (connection.viaConnectionId) {
        const via = connections.find((entry) => entry.id === connection.viaConnectionId);
        const viaName = via
          ? (servers.find((server) => server.id === via.serverId)?.name ?? via.host)
          : t('status.viaUnknown');
        tooltip = `${tooltip} ${t('servers.via', { name: viaName })}`;
      }
    }
  }

  return <DockviewDefaultTab {...props} title={tooltip} />;
}

function Watermark() {
  return <div className="ns-placeholder" />;
}

const COMPONENTS: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  panel: PanelHost,
  terminal: TerminalPanel,
  home: HomePanel,
};

const TAB_COMPONENTS = {
  [FIXED_TAB_COMPONENT]: FixedTab,
  [TERMINAL_TAB_COMPONENT]: TerminalTab,
};

export interface DockLayoutProps {
  savedLayout: JsonValue | null;
}

export function DockLayout({ savedLayout }: DockLayoutProps) {
  const appliedTheme = useAppliedTheme();
  // Only used for its side effect: re-render (and thus re-title) on locale change.
  useI18n();
  const disposables = useRef<Array<{ dispose(): void }>>([]);
  const savedLayoutRef = useRef(savedLayout);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api;
    setDockApi(api);

    if (!restoreLayout(api, savedLayoutRef.current)) {
      applyDefaultLayout(api);
    }
    runPendingAutoOpen();

    disposables.current.push(
      api.onDidLayoutChange(() => scheduleLayoutPersist()),
      api.onDidRemovePanel((panel) => {
        if (!panel.id.startsWith(TERMINAL_PANEL_PREFIX)) return;
        // Dragging a tab into another group also fires this event, so wait a tick and
        // only tear the terminal down when the panel really is gone.
        const panelId = panel.id;
        setTimeout(() => {
          if (api.getPanel(panelId)) return;
          void closeTerminal(panelId.slice(TERMINAL_PANEL_PREFIX.length));
        }, 0);
      }),
      api.onDidActivePanelChange((change) => {
        const id = change.panel?.id;
        if (id && id.startsWith(TERMINAL_PANEL_PREFIX)) {
          setActiveTerminal(id.slice(TERMINAL_PANEL_PREFIX.length));
        }
      }),
    );
  }, []);

  useEffect(() => {
    const subscription = onDidRegisterPanel((entry) => maybeAutoOpenPanel(entry));
    return () => subscription.dispose();
  }, []);

  useEffect(() => {
    const current = disposables.current;
    return () => {
      for (const disposable of current.splice(0)) disposable.dispose();
      setDockApi(null);
    };
  }, []);

  return (
    <DockviewReact
      className="ns-dock"
      theme={appliedTheme === 'light' ? themeLight : themeDark}
      components={COMPONENTS}
      tabComponents={TAB_COMPONENTS}
      watermarkComponent={Watermark}
      // Drive tab/group drags with pointer events instead of HTML5 drag-and-drop:
      // Tauri replaces WebView2's drag-drop handler on Windows (`dragDropEnabled`,
      // on by default), which silently breaks HTML5 drags, and webkit2gtk on Linux
      // is flaky with them too. Nothing here needs the native drag image or
      // cross-window drags that the pointer backend gives up.
      dndStrategy="pointer"
      onReady={onReady}
    />
  );
}
