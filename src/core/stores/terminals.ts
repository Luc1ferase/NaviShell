import { create } from 'zustand';
import type { TerminalKind } from '@navishell/plugin-api';

import type { TerminalSession } from '../terminal/session';

export interface TerminalExitInfo {
  exitCode: number | null;
  /** Set when the whole SSH connection went away rather than just the shell. */
  connectionLost?: boolean;
}

export interface TerminalRecord {
  id: string;
  /** `ssh` terminals belong to a connection; `local` ones run a shell on this machine. */
  kind: TerminalKind;
  /** `null` for local terminals. */
  serverId: string | null;
  /** Server name for SSH terminals, the local shell label otherwise. */
  serverName: string;
  /** `null` for local terminals. */
  connectionId: string | null;
  session: TerminalSession;
  /** `null` while the shell is alive. */
  exited: TerminalExitInfo | null;
}

export interface TerminalsStore {
  records: Record<string, TerminalRecord>;
  order: string[];
  activeId: string | null;
  add(record: TerminalRecord): void;
  remove(id: string): void;
  setActive(id: string | null): void;
  markExited(id: string, info: TerminalExitInfo): void;
}

export const useTerminalsStore = create<TerminalsStore>((set, get) => ({
  records: {},
  order: [],
  activeId: null,
  add(record) {
    set({
      records: { ...get().records, [record.id]: record },
      order: [...get().order.filter((id) => id !== record.id), record.id],
    });
  },
  remove(id) {
    const records = { ...get().records };
    delete records[id];
    const order = get().order.filter((entry) => entry !== id);
    set({
      records,
      order,
      activeId: get().activeId === id ? (order[order.length - 1] ?? null) : get().activeId,
    });
  },
  setActive(id) {
    if (get().activeId === id) return;
    set({ activeId: id });
  },
  markExited(id, info) {
    const record = get().records[id];
    if (!record || record.exited) return;
    set({ records: { ...get().records, [id]: { ...record, exited: info } } });
  },
}));

export function listTerminalRecords(): TerminalRecord[] {
  const { records, order } = useTerminalsStore.getState();
  return order.flatMap((id) => {
    const record = records[id];
    return record ? [record] : [];
  });
}

export function getTerminalRecord(id: string): TerminalRecord | undefined {
  return useTerminalsStore.getState().records[id];
}

/** Local terminals have no connection, so they never match here. */
export function terminalsForConnection(connectionId: string): TerminalRecord[] {
  return listTerminalRecords().filter((record) => record.connectionId === connectionId);
}
