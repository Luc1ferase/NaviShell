import type { Disposable } from '@navishell/plugin-api';

export interface Emitter<T> {
  /** Subscribe; the returned disposable removes the listener. */
  event(listener: (value: T) => void): Disposable;
  fire(value: T): void;
  clear(): void;
  readonly size: number;
}

/** Minimal typed event emitter used throughout the host. */
export function createEmitter<T>(): Emitter<T> {
  const listeners = new Set<(value: T) => void>();
  return {
    event(listener) {
      listeners.add(listener);
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          listeners.delete(listener);
        },
      };
    },
    fire(value) {
      for (const listener of [...listeners]) {
        try {
          listener(value);
        } catch (error) {
          console.error('[navishell] event listener failed', error);
        }
      }
    },
    clear() {
      listeners.clear();
    },
    get size() {
      return listeners.size;
    },
  };
}
