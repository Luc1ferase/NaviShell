/**
 * Host commands, addressable from plugins through `ctx.commands.execute('host:…')`.
 */

import { t } from '@/core/i18n';
import { useRegistryStore } from '@/core/plugins/registry';
import { reloadPlugins } from '@/core/plugins/loader';
import { connectToServer, disconnectConnection } from '@/core/services/connect';
import { closePanel, openPanel, openSettingsPanel, togglePanel } from '@/core/services/layout';
import { useUiStore } from '@/core/stores/ui';
import { openTerminalForServer } from '@/core/terminal/manager';

function firstString(args: unknown[]): string | undefined {
  const value = args[0];
  return typeof value === 'string' ? value : undefined;
}

/** Call once, after i18n is initialised. */
export function registerHostCommands(): void {
  const registry = useRegistryStore.getState();

  const register = (
    id: string,
    titleKey: string,
    icon: string | undefined,
    handler: (...args: unknown[]) => unknown,
  ) => registry.registerCommand({ fullId: id, pluginId: null, title: t(titleKey), icon, handler });

  register('host:openSettings', 'command.openSettings', 'Settings', () => openSettingsPanel());
  register('host:newServer', 'command.newServer', 'Plus', () =>
    useUiStore.getState().openServerForm(),
  );
  register('host:reloadPlugins', 'command.reloadPlugins', 'RefreshCw', () => reloadPlugins());

  register('host:connect', 'command.connect', 'Cable', (...args) => {
    const serverId = firstString(args);
    if (!serverId) throw new Error('host:connect requires a serverId');
    return connectToServer(serverId);
  });
  register('host:openTerminal', 'command.openTerminal', 'SquareTerminal', (...args) => {
    const serverId = firstString(args);
    if (!serverId) throw new Error('host:openTerminal requires a serverId');
    return openTerminalForServer(serverId);
  });
  register('host:disconnect', 'command.disconnect', 'Power', (...args) => {
    const connectionId = firstString(args);
    if (!connectionId) throw new Error('host:disconnect requires a connectionId');
    return disconnectConnection(connectionId);
  });

  register('host:openPanel', 'command.openPanel', undefined, (...args) => {
    const panelId = firstString(args);
    if (panelId) openPanel(panelId);
  });
  register('host:closePanel', 'command.closePanel', undefined, (...args) => {
    const panelId = firstString(args);
    if (panelId) closePanel(panelId);
  });
  register('host:togglePanel', 'command.togglePanel', undefined, (...args) => {
    const panelId = firstString(args);
    if (panelId) togglePanel(panelId);
  });
}
