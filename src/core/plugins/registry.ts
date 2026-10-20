/**
 * Registries for everything a plugin (or the host itself) can contribute: dock panels,
 * commands, terminal overlays and terminal key handlers.
 */

import type { ComponentType } from 'react';
import { create } from 'zustand';
import type {
  PanelApi,
  PanelDefinition,
  PanelPosition,
  PluginContext,
  TerminalHandle,
  TerminalOverlayProps,
} from '@navishell/plugin-api';

import { createEmitter } from '../util/events';
import { uuid } from '../util/fn';

export interface CorePanelProps {
  panelId: string;
  api: PanelApi;
}

export interface CorePanelDefinition {
  /** Full panel id, e.g. `core:servers`. */
  id: string;
  /** Host i18n key for the tab title. */
  titleKey: string;
  icon?: string;
  component: ComponentType<CorePanelProps>;
  closable?: boolean;
  /** Where `openPanel` puts it when the caller does not say; default `right`. */
  defaultPosition?: PanelPosition;
}

export type PanelEntry =
  | { kind: 'core'; fullId: string; def: CorePanelDefinition }
  | {
      kind: 'plugin';
      fullId: string;
      pluginId: string;
      ctx: PluginContext;
      def: PanelDefinition;
    };

export interface CommandEntry {
  fullId: string;
  /** `null` for host commands (`host:*`). */
  pluginId: string | null;
  title: string;
  icon?: string;
  handler: (...args: unknown[]) => unknown | Promise<unknown>;
}

export interface OverlayEntry {
  key: string;
  pluginId: string;
  ctx: PluginContext;
  component: ComponentType<TerminalOverlayProps>;
}

export interface KeyHandlerEntry {
  key: string;
  pluginId: string;
  handler: (terminal: TerminalHandle, event: KeyboardEvent) => boolean;
}

const panelRegistered = createEmitter<PanelEntry>();
/** Fires when a panel definition becomes available (used for `defaultOpen` handling). */
export const onDidRegisterPanel = panelRegistered.event;

export interface RegistryStore {
  panels: Record<string, PanelEntry>;
  panelOrder: string[];
  commands: Record<string, CommandEntry>;
  overlays: OverlayEntry[];
  keyHandlers: KeyHandlerEntry[];

  registerCorePanel(def: CorePanelDefinition): void;
  registerPluginPanel(pluginId: string, ctx: PluginContext, def: PanelDefinition): string;
  unregisterPanel(fullId: string): void;

  registerCommand(entry: CommandEntry): void;
  unregisterCommand(fullId: string): void;

  registerOverlay(
    pluginId: string,
    ctx: PluginContext,
    component: ComponentType<TerminalOverlayProps>,
  ): string;
  unregisterOverlay(key: string): void;

  registerKeyHandler(
    pluginId: string,
    handler: (terminal: TerminalHandle, event: KeyboardEvent) => boolean,
  ): string;
  unregisterKeyHandler(key: string): void;

  /** Drop every contribution made by a plugin. */
  unregisterPlugin(pluginId: string): void;
}

export const useRegistryStore = create<RegistryStore>((set, get) => ({
  panels: {},
  panelOrder: [],
  commands: {},
  overlays: [],
  keyHandlers: [],

  registerCorePanel(def) {
    const entry: PanelEntry = { kind: 'core', fullId: def.id, def };
    set({
      panels: { ...get().panels, [def.id]: entry },
      panelOrder: [...get().panelOrder.filter((id) => id !== def.id), def.id],
    });
    panelRegistered.fire(entry);
  },

  registerPluginPanel(pluginId, ctx, def) {
    const fullId = `${pluginId}:${def.id}`;
    const entry: PanelEntry = { kind: 'plugin', fullId, pluginId, ctx, def };
    set({
      panels: { ...get().panels, [fullId]: entry },
      panelOrder: [...get().panelOrder.filter((id) => id !== fullId), fullId],
    });
    panelRegistered.fire(entry);
    return fullId;
  },

  unregisterPanel(fullId) {
    const panels = { ...get().panels };
    delete panels[fullId];
    set({ panels, panelOrder: get().panelOrder.filter((id) => id !== fullId) });
  },

  registerCommand(entry) {
    set({ commands: { ...get().commands, [entry.fullId]: entry } });
  },

  unregisterCommand(fullId) {
    const commands = { ...get().commands };
    delete commands[fullId];
    set({ commands });
  },

  registerOverlay(pluginId, ctx, component) {
    const key = uuid();
    set({ overlays: [...get().overlays, { key, pluginId, ctx, component }] });
    return key;
  },

  unregisterOverlay(key) {
    set({ overlays: get().overlays.filter((overlay) => overlay.key !== key) });
  },

  registerKeyHandler(pluginId, handler) {
    const key = uuid();
    set({ keyHandlers: [...get().keyHandlers, { key, pluginId, handler }] });
    return key;
  },

  unregisterKeyHandler(key) {
    set({ keyHandlers: get().keyHandlers.filter((entry) => entry.key !== key) });
  },

  unregisterPlugin(pluginId) {
    const panels = { ...get().panels };
    for (const [id, entry] of Object.entries(panels)) {
      if (entry.kind === 'plugin' && entry.pluginId === pluginId) delete panels[id];
    }
    const commands = { ...get().commands };
    for (const [id, entry] of Object.entries(commands)) {
      if (entry.pluginId === pluginId) delete commands[id];
    }
    set({
      panels,
      panelOrder: get().panelOrder.filter((id) => id in panels),
      commands,
      overlays: get().overlays.filter((overlay) => overlay.pluginId !== pluginId),
      keyHandlers: get().keyHandlers.filter((entry) => entry.pluginId !== pluginId),
    });
  },
}));

export function getPanelEntry(fullId: string): PanelEntry | undefined {
  return useRegistryStore.getState().panels[fullId];
}

export function listPanelEntries(): PanelEntry[] {
  const { panels, panelOrder } = useRegistryStore.getState();
  return panelOrder.flatMap((id) => {
    const entry = panels[id];
    return entry ? [entry] : [];
  });
}

export function getKeyHandlers(): KeyHandlerEntry[] {
  return useRegistryStore.getState().keyHandlers;
}

/** Execute a registered command by its full id. */
export async function executeCommand<T = unknown>(fullId: string, ...args: unknown[]): Promise<T> {
  const entry = useRegistryStore.getState().commands[fullId];
  if (!entry) throw new Error(`Unknown command: ${fullId}`);
  return (await entry.handler(...args)) as T;
}
