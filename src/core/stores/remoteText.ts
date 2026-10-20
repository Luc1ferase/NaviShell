/**
 * Small text documents fetched through `plugins_fetch_text` (a plugin's README or
 * changelog), cached for the app session so switching between extensions and tabs does
 * not refetch. Keyed by URL.
 */

import { useEffect } from 'react';
import { create } from 'zustand';

import { call, errorMessage } from '../ipc/client';

export interface RemoteText {
  text: string | null;
  error: string | null;
  loading: boolean;
}

interface RemoteTextStore {
  documents: Record<string, RemoteText>;
  begin(url: string): void;
  succeed(url: string, text: string): void;
  fail(url: string, error: string): void;
  forget(url: string): void;
}

const useRemoteTextStore = create<RemoteTextStore>((set) => ({
  documents: {},
  begin(url) {
    set((state) => ({
      documents: { ...state.documents, [url]: { text: null, error: null, loading: true } },
    }));
  },
  succeed(url, text) {
    set((state) => ({
      documents: { ...state.documents, [url]: { text, error: null, loading: false } },
    }));
  },
  fail(url, error) {
    set((state) => ({
      documents: { ...state.documents, [url]: { text: null, error, loading: false } },
    }));
  },
  forget(url) {
    set((state) => {
      const documents = { ...state.documents };
      delete documents[url];
      return { documents };
    });
  },
}));

const IDLE: RemoteText = { text: null, error: null, loading: false };

/** Starts fetching `url` unless it is loaded or loading already. */
export function ensureRemoteText(url: string): void {
  const store = useRemoteTextStore.getState();
  const current = store.documents[url];
  if (current && (current.loading || current.text !== null)) return;
  store.begin(url);
  call('plugins_fetch_text', { url }).then(
    (text) => useRemoteTextStore.getState().succeed(url, text),
    (error: unknown) => useRemoteTextStore.getState().fail(url, errorMessage(error)),
  );
}

/** Drops a cached document so the next `ensureRemoteText` fetches it again. */
export function retryRemoteText(url: string): void {
  useRemoteTextStore.getState().forget(url);
  ensureRemoteText(url);
}

/** The document at `url`, fetched on first use; idle when `url` is undefined. */
export function useRemoteText(url: string | undefined): RemoteText {
  const document = useRemoteTextStore((state) => (url ? state.documents[url] : undefined));
  useEffect(() => {
    if (url) ensureRemoteText(url);
  }, [url]);
  return document ?? IDLE;
}
