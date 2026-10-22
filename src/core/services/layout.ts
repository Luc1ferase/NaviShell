/**
 * Everything that touches the dockview layout: the shared `DockviewApi` handle, the
 * default layout, panel open/close helpers and layout persistence.
 */

import type { DockviewApi, DockviewGroupPanel, SerializedDockview } from 'dockview-react';
import type { JsonValue, PanelPosition, TerminalKind } from '@navishell/plugin-api';

import { call } from '../ipc/client';
import { t, translatePlugin } from '../i18n';
import { debounce } from '../util/fn';
import { getPanelEntry, listPanelEntries, type PanelEntry } from '../plugins/registry';
import { useExtensionsViewStore, type ExtensionView } from '../stores/extensionsView';
import { useSettingsStore } from '../stores/settings';

export const CORE_HOME_PANEL = 'core:home';
export const CORE_SERVERS_PANEL = 'core:servers';
export const CORE_SETTINGS_PANEL = 'core:settings';
export const CORE_EXTENSIONS_PANEL = 'core:extensions';

export const TERMINAL_PANEL_PREFIX = 'terminal:';

/** Tab component id used for panels that must not show a close button. */
export const FIXED_TAB_COMPONENT = 'fixedTab';

/** Tab component id used for terminal tabs (adds a tooltip describing the session). */
export const TERMINAL_TAB_COMPONENT = 'terminalTab';

let dockApi: DockviewApi | null = null;
let restoring = false;
/** The centre group that was focused most recently; new centre tabs open there. */
let lastCenterGroupId: string | null = null;

export function setDockApi(api: DockviewApi | null): void {
  dockApi = api;
  lastCenterGroupId = null;
}

export function getDockApi(): DockviewApi | null {
  return dockApi;
}

export function terminalPanelId(terminalId: string): string {
  return `${TERMINAL_PANEL_PREFIX}${terminalId}`;
}

export function panelTitle(entry: PanelEntry): string {
  return entry.kind === 'core'
    ? t(entry.def.titleKey)
    : translatePlugin(entry.pluginId, entry.def.title);
}

/**
 * A group counts as a centre group while it holds Home or a terminal. Extensions and
 * Settings do not count: they open wherever the focus is, so their presence says nothing
 * about a group being the main area.
 */
function isCenterGroup(group: DockviewGroupPanel): boolean {
  return group.panels.some(
    (panel) => panel.id === CORE_HOME_PANEL || panel.id.startsWith(TERMINAL_PANEL_PREFIX),
  );
}

/**
 * Remembers the focused group when it is a centre group, so that a terminal opened from
 * a side panel (double-clicking a server) still lands where the user last worked. Wired
 * to dockview's active-group event by the dock layout.
 */
export function noteActiveGroup(group: DockviewGroupPanel | undefined): void {
  if (group && isCenterGroup(group)) lastCenterGroupId = group.id;
}

/**
 * The group new terminals go to, and the reference for side panels: the focused group
 * when it is a centre group, else the centre group focused most recently, else the group
 * holding Home. A focused side panel (Servers, a file manager) never receives terminals.
 */
function centerGroup(api: DockviewApi): DockviewGroupPanel | undefined {
  const active = api.activeGroup;
  if (active && isCenterGroup(active)) return active;
  const last = api.groups.find((group) => group.id === lastCenterGroupId);
  if (last && isCenterGroup(last)) return last;
  const home = api.getPanel(CORE_HOME_PANEL);
  if (home) return home.api.group;
  return active ?? api.groups[0];
}

/**
 * The group a centre panel (Extensions, Settings, a plugin's centre panel) opens in: the
 * focused group, whichever it is, so that a panel opened from the top bar while Servers
 * has the focus joins Servers as a tab. [`centerGroup`] when no group has the focus.
 */
function focusedGroup(api: DockviewApi): DockviewGroupPanel | undefined {
  return api.activeGroup ?? centerGroup(api);
}

function directionFor(position: PanelPosition): 'left' | 'right' | 'below' | 'within' {
  switch (position) {
    case 'left':
      return 'left';
    case 'bottom':
      return 'below';
    case 'center':
      return 'within';
    default:
      return 'right';
  }
}

// ---------------------------------------------------------------------------
// Opening / closing panels
// ---------------------------------------------------------------------------

export interface OpenPanelOptions {
  position?: PanelPosition;
  size?: number;
  /** Default `true`. */
  activate?: boolean;
}

export function isPanelOpen(fullId: string): boolean {
  return Boolean(dockApi?.getPanel(fullId));
}

export function closePanel(fullId: string): void {
  dockApi?.getPanel(fullId)?.api.close();
}

export function openPanel(fullId: string, options: OpenPanelOptions = {}): void {
  const api = dockApi;
  if (!api) return;

  const existing = api.getPanel(fullId);
  if (existing) {
    if (options.activate !== false) existing.api.setActive();
    return;
  }

  const entry = getPanelEntry(fullId);
  const position = options.position ?? entry?.def.defaultPosition ?? 'right';
  const size = options.size ?? (entry?.kind === 'plugin' ? entry.def.defaultSize : undefined);
  const closable = entry?.kind === 'plugin' ? entry.def.closable !== false : true;
  const direction = directionFor(position);
  const group = direction === 'within' ? focusedGroup(api) : centerGroup(api);
  const title = entry ? panelTitle(entry) : fullId;

  const sizing =
    direction === 'left' || direction === 'right'
      ? { initialWidth: size ?? 300 }
      : direction === 'below'
        ? { initialHeight: size ?? 240 }
        : {};

  api.addPanel({
    id: fullId,
    component: 'panel',
    title,
    params: { panelId: fullId },
    inactive: options.activate === false,
    tabComponent: closable ? undefined : FIXED_TAB_COMPONENT,
    ...sizing,
    ...(group ? { position: { referenceGroup: group, direction } } : {}),
  });
}

export function togglePanel(fullId: string, options: OpenPanelOptions = {}): void {
  if (isPanelOpen(fullId)) {
    closePanel(fullId);
  } else {
    openPanel(fullId, options);
  }
}

export function openSettingsPanel(): void {
  openPanel(CORE_SETTINGS_PANEL, { position: 'center' });
}

/**
 * The marketplace / installed-plugins view, a centre tab like Settings. `view` picks the
 * list the panel shows (it switches when already open).
 */
export function openExtensionsPanel(view?: ExtensionView): void {
  if (view) useExtensionsViewStore.getState().request(view);
  openPanel(CORE_EXTENSIONS_PANEL, { position: 'center' });
}

export interface TerminalPanelParams {
  terminalId: string;
  /** `local` shells have no server; layouts saved before local terminals omit this. */
  kind: TerminalKind;
  /** `null` for local terminals. */
  serverId: string | null;
  serverName: string;
}

/** Tab title of a terminal panel (the local label is translated on every locale change). */
export function terminalPanelTitle(
  params: Pick<TerminalPanelParams, 'kind' | 'serverName'>,
): string {
  return params.kind === 'local' ? t('terminal.localTitle') : params.serverName;
}

export function addTerminalPanel(params: TerminalPanelParams): void {
  const api = dockApi;
  if (!api) return;
  const id = terminalPanelId(params.terminalId);
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  const group = centerGroup(api);
  api.addPanel({
    id,
    component: 'terminal',
    tabComponent: TERMINAL_TAB_COMPONENT,
    title: terminalPanelTitle(params),
    renderer: 'always',
    params: { ...params },
    ...(group ? { position: { referenceGroup: group, direction: 'within' } } : {}),
  });
}

export function closeTerminalPanel(terminalId: string): void {
  dockApi?.getPanel(terminalPanelId(terminalId))?.api.close();
}

// ---------------------------------------------------------------------------
// Default layout / restore / persistence
// ---------------------------------------------------------------------------

export function applyDefaultLayout(api: DockviewApi): void {
  restoring = true;
  try {
    api.clear();
    api.addPanel({
      id: CORE_HOME_PANEL,
      component: 'panel',
      title: t('panel.home.title'),
      params: { panelId: CORE_HOME_PANEL },
    });
    api.addPanel({
      id: CORE_SERVERS_PANEL,
      component: 'panel',
      title: t('panel.servers.title'),
      params: { panelId: CORE_SERVERS_PANEL },
      initialWidth: 280,
      position: { referencePanel: CORE_HOME_PANEL, direction: 'left' },
    });
    api.getPanel(CORE_HOME_PANEL)?.api.setActive();
  } finally {
    restoring = false;
  }
}

/**
 * Layouts saved before 0.9.0 carry Welcome as the dedicated `home` component with the
 * fixed (closeless) tab. It is an ordinary core panel now, so the saved entry is rewritten
 * to the generic `panel` component before dockview sees it; a closed Welcome stays closed.
 */
function migrateLayout(layout: SerializedDockview): SerializedDockview {
  const home = layout.panels?.[CORE_HOME_PANEL];
  if (!home || (home.contentComponent === 'panel' && home.tabComponent !== FIXED_TAB_COMPONENT)) {
    return layout;
  }
  const { tabComponent: _fixed, ...rest } = home;
  return {
    ...layout,
    panels: {
      ...layout.panels,
      [CORE_HOME_PANEL]: {
        ...rest,
        contentComponent: 'panel',
        params: { ...rest.params, panelId: CORE_HOME_PANEL },
      },
    },
  };
}

/** Returns `true` when the serialised layout was applied. */
export function restoreLayout(api: DockviewApi, layout: JsonValue | null): boolean {
  if (!layout || typeof layout !== 'object') return false;
  restoring = true;
  try {
    api.fromJSON(migrateLayout(layout as unknown as SerializedDockview));
    return true;
  } catch (error) {
    console.error('[navishell] failed to restore the saved layout', error);
    return false;
  } finally {
    restoring = false;
  }
}

const persist = debounce(() => {
  const api = dockApi;
  if (!api || restoring) return;
  let layout: JsonValue;
  try {
    layout = api.toJSON() as unknown as JsonValue;
  } catch (error) {
    console.warn('[navishell] could not serialise the layout', error);
    return;
  }
  void call('layout_set', { layout }).catch((error) => {
    console.warn('[navishell] layout_set failed', error);
  });
}, 500);

export function scheduleLayoutPersist(): void {
  persist();
}

export function flushLayoutPersist(): void {
  persist.flush();
}

// ---------------------------------------------------------------------------
// `defaultOpen` handling
// ---------------------------------------------------------------------------

export function maybeAutoOpenPanel(entry: PanelEntry): void {
  if (entry.kind !== 'plugin' || !dockApi) return;
  if (!entry.def.defaultOpen) return;
  if (dockApi.getPanel(entry.fullId)) return;
  const settings = useSettingsStore.getState().settings;
  if (settings.plugins.seenPanels.includes(entry.fullId)) return;
  openPanel(entry.fullId, { activate: false });
  useSettingsStore.getState().markPanelSeen(entry.fullId);
}

/** Run `defaultOpen` handling for every panel registered before the layout existed. */
export function runPendingAutoOpen(): void {
  for (const entry of listPanelEntries()) maybeAutoOpenPanel(entry);
}

/** Re-apply translated titles after a locale change. */
export function refreshPanelTitles(): void {
  const api = dockApi;
  if (!api) return;
  for (const entry of listPanelEntries()) {
    const panel = api.getPanel(entry.fullId);
    if (panel) panel.api.setTitle(panelTitle(entry));
  }
  api.getPanel(CORE_HOME_PANEL)?.api.setTitle(t('panel.home.title'));
  for (const panel of api.panels) {
    if (!panel.id.startsWith(TERMINAL_PANEL_PREFIX)) continue;
    const params = panel.params as Partial<TerminalPanelParams> | undefined;
    if (params?.kind === 'local') panel.api.setTitle(t('terminal.localTitle'));
  }
}
