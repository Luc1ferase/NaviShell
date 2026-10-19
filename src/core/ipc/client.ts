/**
 * Typed wrappers around the Tauri IPC surface declared in {@link ./contract.ts}.
 *
 * Nothing outside this file should call `invoke`/`listen` directly.
 */

import { Channel, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isHostError, type HostError } from '@navishell/plugin-api';

import type {
  CommandArgs,
  CommandName,
  CommandResult,
  HostEventName,
  HostEvents,
} from './contract';

export { Channel };
export type { UnlistenFn };

/**
 * Invoke a host command.
 *
 * `extra` carries values that are not part of the serialisable argument object,
 * i.e. `Channel` instances (`onData` for `term_open`, `onProgress` for transfers).
 */
export function call<K extends CommandName>(
  name: K,
  args: CommandArgs<K>,
  extra?: Record<string, unknown>,
): Promise<CommandResult<K>> {
  const payload = { ...args, ...extra } as unknown as Record<string, unknown>;
  return invoke<CommandResult<K>>(name, payload);
}

/** Listen to one of the host events declared in {@link HostEvents}. */
export function listenHost<K extends HostEventName>(
  name: K,
  handler: (payload: HostEvents[K]) => void,
): Promise<UnlistenFn> {
  return listen<HostEvents[K]>(name, (event) => handler(event.payload));
}

/** Normalise an unknown rejection value into a {@link HostError}. */
export function toHostError(error: unknown): HostError {
  if (isHostError(error)) return error;
  if (error instanceof Error) return { code: 'Internal', message: error.message };
  if (typeof error === 'string') return { code: 'Internal', message: error };
  return { code: 'Internal', message: 'Unknown error' };
}

/** Human readable message for any rejection value. */
export function errorMessage(error: unknown): string {
  return toHostError(error).message;
}
