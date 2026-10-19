import { create } from 'zustand';
import type { ServerRecord } from '@navishell/plugin-api';

import { createEmitter } from '../util/events';

const serversChanged = createEmitter<ServerRecord[]>();
export const onDidChangeServers = serversChanged.event;

function sortServers(servers: ServerRecord[]): ServerRecord[] {
  return [...servers].sort((a, b) => {
    const groupA = a.group ?? '';
    const groupB = b.group ?? '';
    if (groupA !== groupB) return groupA.localeCompare(groupB);
    return a.name.localeCompare(b.name);
  });
}

export interface ServersStore {
  servers: ServerRecord[];
  setServers(servers: ServerRecord[]): void;
  upsert(server: ServerRecord): void;
  remove(serverId: string): void;
}

export const useServersStore = create<ServersStore>((set, get) => ({
  servers: [],
  setServers(servers) {
    const next = sortServers(servers);
    set({ servers: next });
    serversChanged.fire(next);
  },
  upsert(server) {
    const rest = get().servers.filter((s) => s.id !== server.id);
    get().setServers([...rest, server]);
  },
  remove(serverId) {
    get().setServers(get().servers.filter((s) => s.id !== serverId));
  },
}));

export function listServers(): ServerRecord[] {
  return useServersStore.getState().servers;
}

export function getServer(id: string): ServerRecord | undefined {
  return useServersStore.getState().servers.find((s) => s.id === id);
}
