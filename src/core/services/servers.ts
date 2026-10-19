import type { ServerInput, ServerRecord } from '@navishell/plugin-api';

import { call } from '../ipc/client';
import type { CredentialKind } from '../ipc/contract';
import { useServersStore } from '../stores/servers';

export async function loadServers(): Promise<ServerRecord[]> {
  const servers = await call('servers_list', {});
  useServersStore.getState().setServers(servers);
  return servers;
}

export async function saveServer(server: ServerInput): Promise<ServerRecord> {
  const saved = await call('servers_save', { server });
  useServersStore.getState().upsert(saved);
  return saved;
}

export async function deleteServer(serverId: string): Promise<void> {
  await call('servers_delete', { serverId });
  useServersStore.getState().remove(serverId);
}

/** `kind` selects the keychain entry: the account password or the key passphrase. */
export function credentialExists(
  serverId: string,
  kind: CredentialKind = 'password',
): Promise<boolean> {
  return call('credential_exists', { serverId, kind });
}

export function setCredential(
  serverId: string,
  password: string,
  kind: CredentialKind = 'password',
): Promise<void> {
  return call('credential_set', { serverId, password, kind });
}

export function deleteCredential(
  serverId: string,
  kind: CredentialKind = 'password',
): Promise<void> {
  return call('credential_delete', { serverId, kind });
}

/** Build the `servers_save` payload for a duplicate of an existing record. */
export function duplicateInput(server: ServerRecord, name: string): ServerInput {
  return {
    name,
    host: server.host,
    port: server.port,
    username: server.username,
    group: server.group,
    tags: server.tags,
    color: server.color,
    auth: server.auth,
    jumpServerId: server.jumpServerId ?? null,
  };
}
