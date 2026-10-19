import { create } from 'zustand';
import type { ConnectionInfo } from '@navishell/plugin-api';

import { createEmitter } from '../util/events';

const connectionsChanged = createEmitter<ConnectionInfo[]>();
export const onDidChangeConnections = connectionsChanged.event;

export interface ConnectionsStore {
  connections: ConnectionInfo[];
  setConnections(connections: ConnectionInfo[]): void;
  upsert(connection: ConnectionInfo): void;
  remove(connectionId: string): void;
}

export const useConnectionsStore = create<ConnectionsStore>((set, get) => ({
  connections: [],
  setConnections(connections) {
    set({ connections });
    connectionsChanged.fire(connections);
  },
  upsert(connection) {
    const rest = get().connections.filter((c) => c.id !== connection.id);
    get().setConnections([...rest, connection]);
  },
  remove(connectionId) {
    get().setConnections(get().connections.filter((c) => c.id !== connectionId));
  },
}));

export function listConnections(): ConnectionInfo[] {
  return useConnectionsStore.getState().connections;
}

export function getConnection(id: string): ConnectionInfo | undefined {
  return useConnectionsStore.getState().connections.find((c) => c.id === id);
}

export function findConnectionForServer(serverId: string): ConnectionInfo | undefined {
  return useConnectionsStore.getState().connections.find((c) => c.serverId === serverId);
}
