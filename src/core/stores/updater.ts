import { create } from 'zustand';
import type { Update } from '@tauri-apps/plugin-updater';

/**
 * - `idle`      nothing happened yet in this session
 * - `checking`  a check is in flight
 * - `upToDate`  the endpoint answered and this build is current
 * - `available` an update was announced but not downloaded
 * - `downloading` / `ready` download in progress / installed, waiting for a restart
 * - `error`     the check or the download failed (see {@link UpdaterStore.error})
 */
export type UpdaterStatus =
  'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'upToDate' | 'error';

export interface UpdaterSnapshot {
  status: UpdaterStatus;
  /** Version announced by the update server. */
  version: string | null;
  /** RFC 3339 publish date, when the server provided one. */
  date: string | null;
  /** Release notes, when the server provided them. */
  body: string | null;
  downloaded: number;
  /** Total download size, when the server sent a content length. */
  contentLength: number | null;
  error: string | null;
  /**
   * Handle of the announced update. It owns a Rust-side resource, so it is released
   * ({@link Update.close}) before a new check and never kept past `ready`.
   */
  update: Update | null;
}

export interface UpdaterStore extends UpdaterSnapshot {
  patch(partial: Partial<UpdaterSnapshot>): void;
  reset(): void;
}

const INITIAL: UpdaterSnapshot = {
  status: 'idle',
  version: null,
  date: null,
  body: null,
  downloaded: 0,
  contentLength: null,
  error: null,
  update: null,
};

export const useUpdaterStore = create<UpdaterStore>((set) => ({
  ...INITIAL,
  patch(partial) {
    set(partial);
  },
  reset() {
    set({ ...INITIAL });
  },
}));

export function updaterState(): UpdaterSnapshot {
  return useUpdaterStore.getState();
}
