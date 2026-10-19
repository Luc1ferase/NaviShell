/**
 * Host-side implementation of {@link PluginContext}.
 *
 * One context is created per activated plugin; everything registered through it is
 * tagged with the plugin id so `deactivate` can take it all back out again.
 */

import { open as openFileDialog, save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import type {
  Disposable,
  JsonValue,
  Locale,
  PluginContext,
  PluginManifest,
  StorageApi,
  TerminalHandle,
} from '@navishell/plugin-api';

import { call } from '../ipc/client';
import {
  addPluginResources,
  currentLocale,
  onDidChangeLocale,
  registerLocalePack,
  translatePlugin,
} from '../i18n';
import { connectToServer, disconnectConnection } from '../services/connect';
import { closePanel, isPanelOpen, openPanel, togglePanel } from '../services/layout';
import { createSftpClient } from '../services/sftp';
import { getConnection, listConnections, onDidChangeConnections } from '../stores/connections';
import { getServer, listServers, onDidChangeServers } from '../stores/servers';
import { useUiStore } from '../stores/ui';
import {
  getActiveTerminal,
  listTerminals,
  onDidChangeActiveTerminal,
  onDidCloseTerminal,
  onDidOpenTerminal,
  openLocalTerminal,
  openTerminalForServer,
} from '../terminal/manager';
import { executeCommand, useRegistryStore } from './registry';

export interface CreatePluginContextOptions {
  manifest: PluginManifest;
  hostVersion: string;
  pluginDir: string;
}

function toDisposableFn(fn: () => void): Disposable {
  let done = false;
  return {
    dispose() {
      if (done) return;
      done = true;
      fn();
    },
  };
}

export function createPluginContext(options: CreatePluginContextOptions): PluginContext {
  const pluginId = options.manifest.id;
  const subscriptions: Disposable[] = [];
  const log = {
    debug: (...args: unknown[]) => console.debug(`[${pluginId}]`, ...args),
    info: (...args: unknown[]) => console.info(`[${pluginId}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${pluginId}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${pluginId}]`, ...args),
  };

  const fullPanelId = (id: string) => (id.includes(':') ? id : `${pluginId}:${id}`);

  // The implementation signature cannot express the two public overloads of
  // StorageApi.get at once, hence the single cast.
  const storage = {
    get: (async (key: string, fallback?: JsonValue) => {
      const value = await call('plugin_storage_get', { pluginId, key });
      return value === null ? fallback : value;
    }) as StorageApi['get'],
    set: (key: string, value: JsonValue) => call('plugin_storage_set', { pluginId, key, value }),
    remove: (key: string) => call('plugin_storage_remove', { pluginId, key }),
  } satisfies StorageApi;

  const ctx: PluginContext = {
    id: pluginId,
    manifest: options.manifest,
    hostVersion: options.hostVersion,
    pluginDir: options.pluginDir,
    subscriptions,
    log,
    storage,

    panels: {
      register(def) {
        const registry = useRegistryStore.getState();
        const id = registry.registerPluginPanel(pluginId, ctx, def);
        return toDisposableFn(() => {
          closePanel(id);
          useRegistryStore.getState().unregisterPanel(id);
        });
      },
      open(id) {
        openPanel(fullPanelId(id));
      },
      close(id) {
        closePanel(fullPanelId(id));
      },
      isOpen(id) {
        return isPanelOpen(fullPanelId(id));
      },
      toggle(id) {
        togglePanel(fullPanelId(id));
      },
    },

    commands: {
      register(def) {
        const fullId = `${pluginId}:${def.id}`;
        useRegistryStore.getState().registerCommand({
          fullId,
          pluginId,
          title: translatePlugin(pluginId, def.title),
          icon: def.icon,
          handler: def.handler,
        });
        return toDisposableFn(() => useRegistryStore.getState().unregisterCommand(fullId));
      },
      execute: executeCommand,
    },

    servers: {
      list: listServers,
      get: getServer,
      onDidChange: onDidChangeServers,
      connect: connectToServer,
      openTerminal: (serverId): Promise<TerminalHandle> => openTerminalForServer(serverId),
    },

    connections: {
      list: listConnections,
      get: getConnection,
      onDidChange: onDidChangeConnections,
      exec: (connectionId, command, opts) =>
        call('ssh_exec', { connectionId, command, timeoutMs: opts?.timeoutMs }),
      sftp: createSftpClient,
      disconnect: disconnectConnection,
    },

    terminals: {
      // Both lists include local terminals; plugins filter on `kind`.
      list: () => listTerminals(),
      getActive: () => getActiveTerminal(),
      openLocal: (opts): Promise<TerminalHandle> => openLocalTerminal(opts ?? {}),
      onDidOpen: onDidOpenTerminal,
      onDidClose: onDidCloseTerminal,
      onDidChangeActive: onDidChangeActiveTerminal,
      registerOverlay(component) {
        const key = useRegistryStore.getState().registerOverlay(pluginId, ctx, component);
        return toDisposableFn(() => useRegistryStore.getState().unregisterOverlay(key));
      },
      registerKeyHandler(handler) {
        const key = useRegistryStore.getState().registerKeyHandler(pluginId, handler);
        return toDisposableFn(() => useRegistryStore.getState().unregisterKeyHandler(key));
      },
    },

    i18n: {
      get locale(): Locale {
        return currentLocale();
      },
      addResources(locale, resources) {
        addPluginResources(pluginId, locale, resources);
      },
      t: (key, opts) => translatePlugin(pluginId, key, opts),
      onDidChangeLocale,
      registerLocale(pack) {
        return registerLocalePack(pack);
      },
    },

    ui: {
      toast(message, kind) {
        useUiStore.getState().toast(message, kind);
      },
      confirm(opts) {
        return useUiStore.getState().confirm(opts);
      },
      prompt(opts) {
        return useUiStore.getState().prompt(opts);
      },
      async pickFiles(opts) {
        // The return type of `open` is conditional on literal option values, which a
        // runtime-built options object cannot express.
        const selection = (await openFileDialog({
          title: opts?.title,
          multiple: opts?.multiple ?? false,
          directory: opts?.directory ?? false,
          defaultPath: opts?.defaultPath,
        })) as string | string[] | null;
        if (selection === null) return null;
        return Array.isArray(selection) ? selection : [selection];
      },
      pickSaveFile(opts) {
        return saveFileDialog({ title: opts?.title, defaultPath: opts?.defaultPath });
      },
      revealPath(path) {
        return revealItemInDir(path);
      },
      showContextMenu(items, position) {
        useUiStore.getState().showContextMenu(items, position);
      },
    },
  };

  return ctx;
}
