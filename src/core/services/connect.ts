/**
 * The host connect flow: keychain lookup, credential prompts, host-key confirmation,
 * jump hosts and keyboard-interactive rounds.
 *
 * `servers.connect` in the plugin API resolves to {@link connectToServer}.
 */

import type { ConnectionInfo, HostError, HostErrorCode, ServerRecord } from '@navishell/plugin-api';

import { call, toHostError } from '../ipc/client';
import type { CommandArgs, HostEvents } from '../ipc/contract';
import { t } from '../i18n';
import { findConnectionForServer, useConnectionsStore } from '../stores/connections';
import { getServer } from '../stores/servers';
import { getAppInfo } from '../stores/settings';
import { useUiStore, type PasswordResult } from '../stores/ui';

const MAX_AUTH_ATTEMPTS = 3;

function hostError(code: HostErrorCode, message: string): HostError {
  return { code, message };
}

const inflight = new Map<string, Promise<ConnectionInfo>>();

/** Connect to a server, reusing an existing connection when there is one. */
export function connectToServer(serverId: string): Promise<ConnectionInfo> {
  return connectInChain(serverId, []);
}

/**
 * `chain` holds the servers further down the ProxyJump chain that are waiting for this
 * connection, so a jump host pointing back at one of them can be rejected instead of
 * recursing forever.
 */
function connectInChain(serverId: string, chain: string[]): Promise<ConnectionInfo> {
  const existing = findConnectionForServer(serverId);
  if (existing) return Promise.resolve(existing);

  const pending = inflight.get(serverId);
  if (pending) return pending;

  const promise = runConnect(serverId, chain);
  inflight.set(serverId, promise);
  return promise.finally(() => inflight.delete(serverId));
}

function askPassword(server: ServerRecord): Promise<PasswordResult | null> {
  return useUiStore.getState().askPassword({
    title: t('dialog.password.title', { name: server.name }),
    message: `${server.username}@${server.host}:${server.port}`,
    offerSave: true,
  });
}

function askPassphrase(server: ServerRecord): Promise<PasswordResult | null> {
  return useUiStore.getState().askPassword({
    title: t('dialog.passphrase.title', { name: server.name }),
    message: server.auth.type === 'key' ? server.auth.keyPath : undefined,
    kind: 'passphrase',
    offerSave: true,
  });
}

/** Platform-specific guidance shown when no ssh-agent could be reached. */
function agentUnavailableMessage(): string {
  return getAppInfo()?.platform === 'windows'
    ? t('connect.agentUnavailableWindows')
    : t('connect.agentUnavailableUnix');
}

async function runConnect(serverId: string, chain: string[]): Promise<ConnectionInfo> {
  const server = getServer(serverId);
  if (!server) throw hostError('NotFound', `Unknown server: ${serverId}`);

  const ui = useUiStore.getState();
  let args: CommandArgs<'ssh_connect'> = { serverId };
  let authAttempts = 0;

  // -- ProxyJump: the jump host has to be up before the inner session starts ---
  const jumpServerId = server.jumpServerId ?? undefined;
  if (jumpServerId) {
    if (jumpServerId === serverId || chain.includes(jumpServerId)) {
      const failure = hostError('InvalidArgument', t('connect.jumpCycle', { name: server.name }));
      ui.toast(failure.message, 'error');
      throw failure;
    }
    // Shows its own dialogs and toasts; a failure here aborts this connection.
    const jump = await connectInChain(jumpServerId, [...chain, serverId]);
    args = { ...args, viaConnectionId: jump.id };
  }

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

      if (failure.code === 'AuthFailed') {
        authAttempts += 1;
        ui.toast(t('connect.authFailed', { name: server.name }), 'error');
        if (authAttempts >= MAX_AUTH_ATTEMPTS) throw failure;

        // A mistyped passphrase is worth another try; a rejected key or agent identity
        // is not something a prompt can fix.
        if (server.auth.type === 'key') {
          if (args.passphrase === undefined) throw failure;
          const answer = await askPassphrase(server);
          if (!answer) throw hostError('Cancelled', t('connect.cancelled'));
          args = { ...args, passphrase: answer.password, savePassphrase: answer.savePassword };
          continue;
        }
        if (server.auth.type !== 'password') throw failure;

        const answer = await askPassword(server);
        if (!answer) throw hostError('Cancelled', t('connect.cancelled'));
        args = { ...args, password: answer.password, savePassword: answer.savePassword };
        continue;
      }

      if (failure.code === 'PasswordRequired') {
        const answer = await askPassword(server);
        if (!answer) throw hostError('Cancelled', t('connect.cancelled'));
        args = { ...args, password: answer.password, savePassword: answer.savePassword };
        continue;
      }

      if (failure.code === 'PassphraseRequired') {
        const answer = await askPassphrase(server);
        if (!answer) throw hostError('Cancelled', t('connect.cancelled'));
        args = { ...args, passphrase: answer.password, savePassphrase: answer.savePassword };
        continue;
      }

      if (failure.code === 'AgentUnavailable') {
        // Nothing to retry: the user has to start an agent and load an identity first.
        ui.toast(agentUnavailableMessage(), 'error');
        throw failure;
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

// ---------------------------------------------------------------------------
// Keyboard-interactive (`auth:prompt`)
// ---------------------------------------------------------------------------

/**
 * Answer one keyboard-interactive round. Registered once at startup: the Rust side
 * blocks inside `ssh_connect` until `ssh_auth_respond` arrives, so this runs while the
 * connect promise is still pending and must never wait on it.
 */
export async function handleAuthPrompt(payload: HostEvents['auth:prompt']): Promise<void> {
  const ui = useUiStore.getState();
  const server = getServer(payload.serverId);
  // `null` cancels the round, which is also what a failed dialog falls back to.
  let responses: string[] | null;

  try {
    if (payload.prompts.length === 0) {
      // A banner-only round: show the text and acknowledge it right away.
      const notice = payload.instructions.trim() || payload.name.trim();
      if (notice) ui.toast(notice, 'info');
      responses = [];
    } else {
      responses = await ui.askAuthPrompt({
        title: server
          ? t('dialog.authPrompt.title', { name: server.name })
          : t('dialog.authPrompt.titleUnknown'),
        name: payload.name,
        instructions: payload.instructions,
        prompts: payload.prompts,
      });
    }
  } catch (error) {
    console.error('[navishell] auth prompt failed', error);
    responses = null;
  }

  try {
    await call('ssh_auth_respond', { requestId: payload.requestId, responses });
  } catch (error) {
    const failure = toHostError(error);
    if (failure.code === 'NotFound') {
      console.warn('[navishell] auth prompt already expired', payload.requestId);
    } else {
      ui.toast(failure.message, 'error');
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
