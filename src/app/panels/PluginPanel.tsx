/**
 * The generic `panel` dockview component.
 *
 * It resolves `params.panelId` in the panel registry and renders the core component or
 * the plugin component, handing the latter a {@link PanelApi} adapter over dockview's
 * own panel api. When the id is unknown (plugin disabled, failed or not installed) it
 * renders a placeholder instead of breaking the layout.
 */

import { useMemo } from 'react';
import type { DockviewPanelApi, IDockviewPanelProps } from 'dockview-react';
import type { Disposable, PanelApi } from '@navishell/plugin-api';

import { PluginErrorBoundary } from '@/app/components/ErrorBoundary';
import { useI18n } from '@/core/i18n/useI18n';
import { useRegistryStore } from '@/core/plugins/registry';
import { setCloseGuard, type GenericPanelParams } from '@/core/services/layout';

function asDisposable(disposable: { dispose(): void }): Disposable {
  return { dispose: () => disposable.dispose() };
}

export function createPanelApiAdapter(api: DockviewPanelApi): PanelApi {
  return {
    get id() {
      return api.id;
    },
    get isActive() {
      return api.isActive;
    },
    get isVisible() {
      return api.isVisible;
    },
    get width() {
      return api.width;
    },
    get height() {
      return api.height;
    },
    onDidActiveChange: (cb) => asDisposable(api.onDidActiveChange((e) => cb(e.isActive))),
    onDidVisibilityChange: (cb) => asDisposable(api.onDidVisibilityChange((e) => cb(e.isVisible))),
    onDidDimensionsChange: (cb) =>
      asDisposable(api.onDidDimensionsChange((e) => cb({ width: e.width, height: e.height }))),
    setTitle: (title) => api.setTitle(title),
    close: () => api.close(),
    // dockview has no explicit focus for panels; activating a panel focuses it.
    focus: () => api.setActive(),
    onWillClose: (cb) => setCloseGuard(api.id, cb),
  };
}

export type { GenericPanelParams };

export function PanelHost(props: IDockviewPanelProps<GenericPanelParams>) {
  const { t } = useI18n();
  const panelId = props.params.panelId;
  const entry = useRegistryStore((state) => state.panels[panelId]);
  const api = useMemo(() => createPanelApiAdapter(props.api), [props.api]);

  if (!entry) {
    return (
      <div className="ns-placeholder">
        <strong>{t('panel.unavailable')}</strong>
        <span className="ns-mono">{panelId}</span>
        <span>{t('panel.unavailableHint')}</span>
      </div>
    );
  }

  if (entry.kind === 'core') {
    const Component = entry.def.component;
    return <Component panelId={panelId} api={api} />;
  }

  const Component = entry.def.component;
  return (
    <PluginErrorBoundary label={entry.pluginId}>
      <Component
        panelId={panelId}
        instance={props.params.instance}
        params={props.params.params}
        ctx={entry.ctx}
        api={api}
      />
    </PluginErrorBoundary>
  );
}
