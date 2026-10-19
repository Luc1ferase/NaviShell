/**
 * The host connect flow: keychain lookup, password prompt, host-key confirmation.
 *
 * `servers.connect` in the plugin API resolves to {@link connectToServer}.
 */

import type { ConnectionInfo, HostError, HostErrorCode } from '@navishell/plugin-api';

import { call, toHostError } from '../ipc/client';
import type { CommandArgs } from '../ipc/contract';
import { t } from '../i18n';
import { findConnectionForServer, useConnectionsStore } from '../stores/connections';
import { getServer } from '../stores/servers';
import { useUiStore } from '../stores/ui';

const MAX_AUTH_ATTEMPTS = 3;

function hostError(code: HostErrorCode, message: string): HostError {
  return { code, message };
}

const inflight = new Map<string, Promise<ConnectionInfo>>();

/** Connect to a server, reusing an existing connection when there is one. */
export function connectToServer(serverId: string): Promise<ConnectionInfo> {
  const existing = findConnectionForServer(serverId);
  if (existing) return Promise.resolve(existing);

  const pending = inflight.get(serverId);
  if (pending) return pending;

  const promise = runConnect(serverId);
  inflight.set(serverId, promise);
  return promise.finally(() => inflight.delete(serverId));
}

async function runConnect(serverId: string): Promise<ConnectionInfo> {
  const server = getServer(serverId);
  if (!server) throw hostError('NotFound', `Unknown server: ${serverId}`);

  const ui = useUiStore.getState();
  let args: CommandArgs<'ssh_connect'> = { serverId };
  let authAttempts = 0;

  for (;;) {
    try {
      const info = await call('ssh_connect', args);
      useConnectionsStore.getState().upsert(info);
      if (info.hostKeyStatus === 'new') {
        ui.toast(
          t('connect.hostKeyNew', {
            host: `${server.host}:${server.port}`,
            fingerprint: info.hostKeyFingerprint,
          }),
          'info',
        );
      }
      return info;
    } catch (error) {
      const failure = toHostError(error);

      if (failure.code === 'PasswordRequired' || failure.code === 'AuthFailed') {
        if (failure.code === 'AuthFailed') {
          authAttempts += 1;
          ui.toast(t('connect.authFailed', { name: server.name }), 'error');
          if (authAttempts >= MAX_AUTH_ATTEMPTS) throw failure;
        }
        const answer = await ui.askPassword({
          title: t('dialog.password.title', { name: server.name }),
          message: `${server.username}@${server.host}:${server.port}`,
          offerSave: true,
        });
        if (!answer) throw hostError('Cancelled', t('connect.cancelled'));
        args = { ...args, password: answer.password, savePassword: answer.savePassword };
        continue;
      }

      if (failure.code === 'HostKeyMismatch') {
        const fingerprint = String(failure.data?.fingerprint ?? '');
        const expectedFingerprint = String(failure.data?.expectedFingerprint ?? '');
        const accepted = await ui.askHostKey({
          title: t('dialog.hostKey.title'),
          message: t('dialog.hostKey.mismatch'),
          host: `${server.host}:${server.port}`,
          fingerprint,
          expectedFingerprint,
          okLabel: t('dialog.hostKey.trust'),
          cancelLabel: t('common.cancel'),
        });
        if (!accepted) throw hostError('Cancelled', t('connect.cancelled'));
        args = { ...args, trustHostKey: true };
        continue;
      }

      ui.toast(failure.message, 'error');
      throw failure;
    }
  }
}

/** Close an SSH connection and forget it. */
export async function disconnectConnection(connectionId: string): Promise<void> {
  try {
    await call('ssh_disconnect', { connectionId });
  } finally {
    useConnectionsStore.getState().remove(connectionId);
  }
}

/** Refresh the connection list from the Rust side (used on startup). */
export async function syncConnections(): Promise<void> {
  const connections = await call('ssh_list_connections', {});
  useConnectionsStore.getState().setConnections(connections);
}
