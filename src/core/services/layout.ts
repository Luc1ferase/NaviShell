/**
 * Everything that touches the dockview layout: the shared `DockviewApi` handle, the
 * default layout, panel open/close helpers and layout persistence.
 */

import type {
  DockviewApi,
  DockviewGroupPanel,
  IDockviewPanel,
  SerializedDockview,
} from 'dockview-react';
import type { Disposable, JsonValue, PanelPosition, TerminalKind } from '@navishell/plugin-api';

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

/** Tab component id for closable core and plugin panels: close goes through the guards. */
export const PANEL_TAB_COMPONENT = 'panelTab';

/** `params` of every `panel` dockview component, core and plugin panels alike. */
export interface GenericPanelParams {
  /** The registry id (`<pluginId>:<id>` or `core:*`); every instance shares it. */
  panelId: string;
  /** Set for a separate instance of a plugin panel (see `OpenPanelOptions.instance`). */
  instance?: string;
  /** Opaque data for the plugin component. */
  params?: JsonValue;
  /** An instance's own title; the registry title is used when absent. */
  title?: string;
  /** Tooltip shown on the tab. */
  tooltip?: string;
  /** Closed instead of restored when the layout is loaded at startup. */
  transient?: boolean;
}

/** The dockview id of a panel: the registry id, or `<id>#<instance>` for an instance. */
export function instancePanelId(fullId: string, instance?: string): string {
  return instance === undefined ? fullId : `${fullId}#${instance}`;
}

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
    case 'main':
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
  /** Open a separate instance keyed by this string (see the plugin API's `OpenPanelOptions`). */
  instance?: string;
  params?: JsonValue;
  title?: string;
  tooltip?: string;
  transient?: boolean;
}

export function isPanelOpen(fullId: string, instance?: string): boolean {
  return Boolean(dockApi?.getPanel(instancePanelId(fullId, instance)));
}

/** Close without asking the panel's close guard: for the owner's own close and deactivation. */
export function closePanel(fullId: string, instance?: string): void {
  dockApi?.getPanel(instancePanelId(fullId, instance))?.api.close();
}

/** Close the shared panel and every instance of it (a plugin panel being unregistered). */
export function closePanelInstances(fullId: string): void {
  const api = dockApi;
  if (!api) return;
  for (const panel of api.panels) {
    if ((panel.params as GenericPanelParams | undefined)?.panelId === fullId) panel.api.close();
  }
}

export function openPanel(fullId: string, options: OpenPanelOptions = {}): void {
  const api = dockApi;
  if (!api) return;

  const dockId = instancePanelId(fullId, options.instance);
  const existing = api.getPanel(dockId);
  if (existing) {
    if (options.activate !== false) existing.api.setActive();
    return;
  }

  const entry = getPanelEntry(fullId);
  const position = options.position ?? entry?.def.defaultPosition ?? 'right';
  const size = options.size ?? (entry?.kind === 'plugin' ? entry.def.defaultSize : undefined);
  const closable = entry?.kind === 'plugin' ? entry.def.closable !== false : true;
  const direction = directionFor(position);
  const group =
    direction === 'within' && position !== 'main' ? focusedGroup(api) : centerGroup(api);
  const title = options.title ?? (entry ? panelTitle(entry) : fullId);

  const sizing =
    direction === 'left' || direction === 'right'
      ? { initialWidth: size ?? 300 }
      : direction === 'below'
        ? { initialHeight: size ?? 240 }
        : {};

  const params: GenericPanelParams = { panelId: fullId };
  if (options.instance !== undefined) params.instance = options.instance;
  if (options.params !== undefined) params.params = options.params;
  if (options.title !== undefined) params.title = options.title;
  if (options.tooltip !== undefined) params.tooltip = options.tooltip;
  if (options.transient) params.transient = true;

  api.addPanel({
    id: dockId,
    component: 'panel',
    title,
    params,
    inactive: options.activate === false,
    tabComponent: closable ? PANEL_TAB_COMPONENT : FIXED_TAB_COMPONENT,
    ...(entry?.kind === 'plugin' && entry.def.keepAlive ? { renderer: 'always' as const } : {}),
    ...sizing,
    ...(group ? { position: { referenceGroup: group, direction } } : {}),
  });
}

export function togglePanel(fullId: string, options: OpenPanelOptions = {}): void {
  if (isPanelOpen(fullId, options.instance)) {
    closePanel(fullId, options.instance);
  } else {
    openPanel(fullId, options);
  }
}

// ---------------------------------------------------------------------------
// Close guards
// ---------------------------------------------------------------------------

type CloseGuard = () => boolean | Promise<boolean>;

/** By dockview panel id; a panel has at most one (the last registered wins). */
const closeGuards = new Map<string, CloseGuard>();

/** Installs a panel's close guard; disposing it (or the panel going away) removes it. */
export function setCloseGuard(dockId: string, guard: CloseGuard): Disposable {
  closeGuards.set(dockId, guard);
  return {
    dispose() {
      if (closeGuards.get(dockId) === guard) closeGuards.delete(dockId);
    },
  };
}

export function dropCloseGuard(dockId: string): void {
  closeGuards.delete(dockId);
}

/**
 * A close started by the user: asks the panel's guard first, when it has one. Resolves
 * `true` when the panel is gone afterwards. Guard failures count as consent, so a broken
 * plugin can never pin a tab open.
 */
export async function requestClosePanel(dockId: string): Promise<boolean> {
  const panel = dockApi?.getPanel(dockId);
  if (!panel) return true;
  const guard = closeGuards.get(dockId);
  if (guard) {
    let allowed = true;
    try {
      allowed = await guard();
    } catch (error) {
      console.warn('[navishell] panel close guard failed', error);
    }
    if (!allowed) return false;
  }
  dockApi?.getPanel(dockId)?.api.close();
  return true;
}

/** Closes the panels one after another, so each guard gets its own answer. */
export async function requestClosePanels(panels: IDockviewPanel[]): Promise<void> {
  for (const panel of panels) await requestClosePanel(panel.id);
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
    // Transient instances (an editor tab on a connection that no longer exists) cannot
    // come back with the layout, so they go instead of showing a placeholder.
    for (const panel of api.panels) {
      if ((panel.params as GenericPanelParams | undefined)?.transient) panel.api.close();
    }
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
