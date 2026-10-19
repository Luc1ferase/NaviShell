import { create } from 'zustand';
import type { PluginManifest } from '@navishell/plugin-api';

export type PluginStatus = 'active' | 'disabled' | 'error';

export interface PluginEntry {
  id: string;
  manifest: PluginManifest;
  source: 'builtin' | 'external';
  /** `builtin://<id>` for built-ins, otherwise the absolute plugin directory. */
  dir: string;
  status: PluginStatus;
  error?: string;
}

export interface PluginsStore {
  entries: PluginEntry[];
  loading: boolean;
  setLoading(loading: boolean): void;
  setEntries(entries: PluginEntry[]): void;
  upsert(entry: PluginEntry): void;
  setStatus(id: string, status: PluginStatus, error?: string): void;
}

export const usePluginsStore = create<PluginsStore>((set, get) => ({
  entries: [],
  loading: false,
  setLoading(loading) {
    set({ loading });
  },
  setEntries(entries) {
    set({ entries: [...entries].sort((a, b) => a.id.localeCompare(b.id)) });
  },
  upsert(entry) {
    const rest = get().entries.filter((e) => e.id !== entry.id);
    get().setEntries([...rest, entry]);
  },
  setStatus(id, status, error) {
    set({
      entries: get().entries.map((entry) =>
        entry.id === id ? { ...entry, status, error } : entry,
      ),
    });
  },
}));

export function listPluginEntries(): PluginEntry[] {
  return usePluginsStore.getState().entries;
}

export function countActivePlugins(): number {
  return usePluginsStore.getState().entries.filter((entry) => entry.status === 'active').length;
}

export function manifestName(manifest: PluginManifest): string {
  return typeof manifest.name === 'string' ? manifest.name : (manifest.name.en ?? manifest.id);
}
