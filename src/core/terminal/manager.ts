/**
 * Terminal lifecycle: opening PTYs, closing them, reacting to `terminal:exit` /
 * `connection:closed`, and keeping the terminals store in sync.
 */

import type { TerminalHandle } from '@navishell/plugin-api';

import { call, toHostError } from '../ipc/client';
import { t } from '../i18n';
import { getKeyHandlers } from '../plugins/registry';
import { connectToServer, disconnectConnection } from '../services/connect';
import {
  addTerminalPanel,
  closeTerminalPanel,
  terminalPanelId,
  getDockApi,
} from '../services/layout';
import { currentTheme } from '../services/theme';
import { useConnectionsStore } from '../stores/connections';
import { getServer } from '../stores/servers';
import { getSettings } from '../stores/settings';
import {
  getTerminalRecord,
  listTerminalRecords,
  terminalsForConnection,
  useTerminalsStore,
} from '../stores/terminals';
import { createEmitter } from '../util/events';
import { TerminalSession } from './session';

const openedEmitter = createEmitter<TerminalHandle>();
const closedEmitter = createEmitter<TerminalHandle>();
const activeEmitter = createEmitter<TerminalHandle | undefined>();

export const onDidOpenTerminal = openedEmitter.event;
export const onDidCloseTerminal = closedEmitter.event;
export const onDidChangeActiveTerminal = activeEmitter.event;

/** Plugin key handlers run before xterm; the first `false` swallows the event. */
function runKeyHandlers(session: TerminalSession, event: KeyboardEvent): boolean {
  for (const entry of getKeyHandlers()) {
    try {
      if (entry.handler(session, event) === false) return false;
    } catch (error) {
      console.error(`[navishell] key handler of ${entry.pluginId} failed`, error);
    }
  }
  return true;
}

export function listTerminals(): TerminalSession[] {
  return listTerminalRecords().map((record) => record.session);
}

export function getTerminal(id: string): TerminalSession | undefined {
  return getTerminalRecord(id)?.session;
}

export function getActiveTerminal(): TerminalSession | undefined {
  const { activeId } = useTerminalsStore.getState();
  return activeId ? getTerminal(activeId) : undefined;
}

export function setActiveTerminal(id: string | null): void {
  const store = useTerminalsStore.getState();
  if (store.activeId === id) return;
  store.setActive(id);
  activeEmitter.fire(id ? getTerminal(id) : undefined);
}

/** Connect (if needed) and open a new shell for a server. */
export async function openTerminalForServer(serverId: string): Promise<TerminalSession> {
  const connection = await connectToServer(serverId);
  const server = getServer(serverId);
  const serverName = server?.name ?? connection.host;
  const settings = getSettings();

  const session = new TerminalSession({
    serverId,
    serverName,
    connectionId: connection.id,
    settings: settings.terminal,
    theme: currentTheme(),
    onKeyEvent: runKeyHandlers,
  });

  const { cols, rows } = session.size;
  let terminalId: string;
  try {
    const result = await call(
      'term_open',
      { connectionId: connection.id, cols, rows, term: settings.terminal.termType },
      { onData: session.channel },
    );
    terminalId = result.terminalId;
  } catch (error) {
    session.dispose();
    throw toHostError(error);
  }

  session.assignId(terminalId);
  useTerminalsStore.getState().add({
    id: terminalId,
    serverId,
    serverName,
    connectionId: connection.id,
    session,
    exited: null,
  });

  addTerminalPanel({ terminalId, serverId, serverName });
  setActiveTerminal(terminalId);
  openedEmitter.fire(session);
  return session;
}

/**
 * Reveal the server's live terminal if it already has one, otherwise open a new shell.
 * This is what the "Connect" affordances do; "New terminal" always opens another one.
 */
export async function revealOrOpenTerminal(serverId: string): Promise<TerminalSession> {
  const existing = listTerminalRecords().find(
    (record) => record.serverId === serverId && !record.exited,
  );
  if (existing) {
    getDockApi()?.getPanel(terminalPanelId(existing.id))?.api.setActive();
    setActiveTerminal(existing.id);
    existing.session.focus();
    return existing.session;
  }
  return openTerminalForServer(serverId);
}

/**
 * Tear a terminal down. Called when its dock panel is removed, so the panel is
 * already gone by the time this runs.
 */
export async function closeTerminal(terminalId: string): Promise<void> {
  const record = getTerminalRecord(terminalId);
  if (!record) return;

  useTerminalsStore.getState().remove(terminalId);
  if (!record.exited) {
    try {
      await call('term_close', { terminalId });
    } catch (error) {
      console.warn('[navishell] term_close failed', error);
    }
  }

  closedEmitter.fire(record.session);
  record.session.dispose();

  const remaining = terminalsForConnection(record.connectionId);
  if (getSettings().closeConnectionWithLastTerminal && remaining.length === 0) {
    try {
      await disconnectConnection(record.connectionId);
    } catch (error) {
      console.warn('[navishell] ssh_disconnect failed', error);
    }
  }

  const { activeId } = useTerminalsStore.getState();
  activeEmitter.fire(activeId ? getTerminal(activeId) : undefined);
}

/** Close the dock panel of a terminal (which then closes the terminal). */
export function requestCloseTerminalPanel(terminalId: string): void {
  if (getDockApi()?.getPanel(terminalPanelId(terminalId))) {
    closeTerminalPanel(terminalId);
  } else {
    void closeTerminal(terminalId);
  }
}

/** Open a fresh shell for the same server and drop the dead panel. */
export async function reconnectTerminal(serverId: string, deadTerminalId?: string): Promise<void> {
  if (deadTerminalId) requestCloseTerminalPanel(deadTerminalId);
  await openTerminalForServer(serverId);
}

// ---------------------------------------------------------------------------
// Host events
// ---------------------------------------------------------------------------

export function handleTerminalExit(terminalId: string, exitCode: number | null): void {
  const record = getTerminalRecord(terminalId);
  if (!record || record.exited) return;
  useTerminalsStore.getState().markExited(terminalId, { exitCode });
  record.session.writeNotice(t('terminal.exitNotice', { code: exitCode ?? '?' }));
}

export function handleConnectionClosed(connectionId: string): void {
  for (const record of terminalsForConnection(connectionId)) {
    if (record.exited) continue;
    useTerminalsStore.getState().markExited(record.id, { exitCode: null, connectionLost: true });
    record.session.writeNotice(t('terminal.connectionLostNotice'));
  }
  useConnectionsStore.getState().remove(connectionId);
}

/** Push the current terminal settings/theme into every live session. */
export function applyTerminalSettings(): void {
  const settings = getSettings();
  const theme = currentTheme();
  for (const session of listTerminals()) session.applySettings(settings.terminal, theme);
}

/** Dispose every session (window unload). */
export function disposeAllTerminals(): void {
  for (const record of listTerminalRecords()) {
    record.session.dispose();
  }
}
