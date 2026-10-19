/**
 * Panel state container.
 *
 * A tiny external store (`subscribe` + immutable snapshot) consumed from React via
 * `useSyncExternalStore`, so every async SFTP operation lives outside the component tree
 * and survives panel re-mounts.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type {
  ConnectionInfo,
  PluginContext,
  SftpClient,
  SftpEntry,
  TransferHandle,
  TransferProgress,
} from '@navishell/plugin-api';
import { isHostError } from '@navishell/plugin-api';
import {
  formatSize,
  joinPath,
  localBasename,
  normalizePath,
  parentPath,
  sortEntries,
} from './format';

export type TransferDirection = 'upload' | 'download';
export type TransferStatus = 'running' | 'done' | 'error' | 'cancelled';

export interface TransferItem {
  id: string;
  name: string;
  direction: TransferDirection;
  transferred: number;
  total: number | null;
  status: TransferStatus;
  /** Error message when `status === 'error'`. */
  message?: string;
}

export interface ViewerState {
  path: string;
  name: string;
  content: string;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
}

export interface SftpState {
  /** All open connections, for the fallback dropdown. */
  connections: ConnectionInfo[];
  connectionId: string | null;
  serverId: string | null;
  /** `true` when the connection comes from the active terminal rather than the dropdown. */
  boundToTerminal: boolean;
  path: string;
  entries: SftpEntry[];
  loading: boolean;
  error: string | null;
  /** Remote path of the selected entry. */
  selected: string | null;
  showHidden: boolean;
  canGoBack: boolean;
  transfers: TransferItem[];
  viewer: ViewerState | null;
}

const INITIAL_STATE: SftpState = {
  connections: [],
  connectionId: null,
  serverId: null,
  boundToTerminal: false,
  path: '',
  entries: [],
  loading: false,
  error: null,
  selected: null,
  showHidden: false,
  canGoBack: false,
  transfers: [],
  viewer: null,
};

/** Largest file the built-in quick editor will load. */
const MAX_EDIT_BYTES = 512 * 1024;
/** How long a finished transfer stays in the list. */
const TRANSFER_LINGER_MS = 4000;

function describeError(error: unknown): string {
  if (isHostError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function isCancellation(error: unknown): boolean {
  return isHostError(error) && error.code === 'Cancelled';
}

export class SftpController {
  private state: SftpState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly handles = new Map<string, TransferHandle>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private backStack: string[] = [];
  private listSeq = 0;
  private disposed = false;

  constructor(private readonly ctx: PluginContext) {}

  // -- store plumbing ------------------------------------------------------

  readonly getState = (): SftpState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private patch(partial: Partial<SftpState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  private later(fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  private sftp(): SftpClient | null {
    const { connectionId } = this.state;
    return connectionId ? this.ctx.connections.sftp(connectionId) : null;
  }

  private t(key: string, options?: Record<string, unknown>): string {
    return this.ctx.i18n.t(key, options);
  }

  // -- lifecycle -----------------------------------------------------------

  /** Subscribe to host events; disposables are owned by the plugin context. */
  attach(): void {
    const { ctx } = this;
    ctx.subscriptions.push(
      ctx.terminals.onDidChangeActive((terminal) => {
        if (terminal) this.bind(terminal.connectionId, terminal.serverId, true);
        else this.syncConnections(ctx.connections.list());
      }),
    );
    ctx.subscriptions.push(
      ctx.connections.onDidChange((connections) => {
        this.syncConnections(connections);
      }),
    );
    ctx.subscriptions.push(ctx.i18n.onDidChangeLocale(() => this.patch({})));
  }

  async start(): Promise<void> {
    const showHidden = await this.ctx.storage.get<boolean>('showHidden', false);
    this.patch({ showHidden });
    const active = this.ctx.terminals.getActive();
    if (active) this.bind(active.connectionId, active.serverId, true);
    else this.syncConnections(this.ctx.connections.list());
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.handles.clear();
    this.listeners.clear();
  }

  // -- connection binding --------------------------------------------------

  private syncConnections(connections: ConnectionInfo[]): void {
    const active = this.ctx.terminals.getActive();
    if (active) {
      this.patch({ connections });
      this.bind(active.connectionId, active.serverId, true);
      return;
    }
    const current = connections.find((c) => c.id === this.state.connectionId);
    const fallback = current ?? connections[0];
    this.patch({ connections, boundToTerminal: false });
    this.bind(fallback?.id ?? null, fallback?.serverId ?? null, false);
  }

  /** Point the panel at a connection; re-navigates when the connection actually changes. */
  private bind(connectionId: string | null, serverId: string | null, fromTerminal: boolean): void {
    if (connectionId === this.state.connectionId) {
      if (this.state.boundToTerminal !== fromTerminal) {
        this.patch({ boundToTerminal: fromTerminal });
      }
      return;
    }
    this.backStack = [];
    this.listSeq += 1;
    this.patch({
      connectionId,
      serverId,
      boundToTerminal: fromTerminal,
      path: '',
      entries: [],
      selected: null,
      error: null,
      canGoBack: false,
      viewer: null,
      loading: connectionId !== null,
    });
    if (connectionId) void this.openInitialPath();
  }

  /** Called by the connection dropdown. */
  selectConnection(connectionId: string): void {
    const connection = this.state.connections.find((c) => c.id === connectionId);
    if (!connection) return;
    this.bind(connection.id, connection.serverId, false);
  }

  private async openInitialPath(): Promise<void> {
    const sftp = this.sftp();
    if (!sftp) return;
    const { serverId } = this.state;
    try {
      const remembered = serverId
        ? await this.ctx.storage.get<string>(`lastPath:${serverId}`)
        : undefined;
      const start = remembered ?? (await sftp.home());
      const ok = await this.navigate(start, { push: false, silent: true });
      if (!ok && remembered) await this.navigate(await sftp.home(), { push: false });
    } catch (error) {
      this.patch({ loading: false, error: describeError(error) });
    }
  }

  // -- navigation ----------------------------------------------------------

  /** Resolve `~`, relative and absolute inputs against the current directory. */
  private async resolve(input: string, sftp: SftpClient): Promise<string> {
    const raw = input.trim();
    if (raw === '') return this.state.path || '/';
    if (raw === '~' || raw.startsWith('~/')) {
      const home = await sftp.home().catch(() => '/');
      return raw === '~' ? normalizePath(home) : joinPath(home, raw.slice(2));
    }
    if (raw.startsWith('/')) return normalizePath(raw);
    return joinPath(this.state.path || '/', raw);
  }

  /** Returns `false` when the listing failed. */
  async navigate(
    input: string,
    options: { push?: boolean; silent?: boolean } = {},
  ): Promise<boolean> {
    const sftp = this.sftp();
    if (!sftp) return false;
    const target = await this.resolve(input, sftp);
    const previous = this.state.path;
    const seq = ++this.listSeq;
    this.patch({ loading: true, error: null });
    try {
      const entries = await sftp.list(target);
      if (seq !== this.listSeq || this.disposed) return true;
      if (options.push !== false && previous && previous !== target) this.backStack.push(previous);
      this.patch({
        path: target,
        entries: sortEntries(entries),
        loading: false,
        error: null,
        selected: null,
        canGoBack: this.backStack.length > 0,
      });
      const { serverId } = this.state;
      if (serverId) void this.ctx.storage.set(`lastPath:${serverId}`, target);
      return true;
    } catch (error) {
      if (seq !== this.listSeq || this.disposed) return false;
      this.patch({ loading: false, error: options.silent ? null : describeError(error) });
      return false;
    }
  }

  async refresh(): Promise<void> {
    if (!this.state.path) return;
    await this.navigate(this.state.path, { push: false });
  }

  async goUp(): Promise<void> {
    if (!this.state.path) return;
    await this.navigate(parentPath(this.state.path));
  }

  async goHome(): Promise<void> {
    const sftp = this.sftp();
    if (!sftp) return;
    await this.navigate(await sftp.home().catch(() => '/'));
  }

  async goBack(): Promise<void> {
    const previous = this.backStack.pop();
    this.patch({ canGoBack: this.backStack.length > 0 });
    if (previous) await this.navigate(previous, { push: false });
  }

  select(path: string | null): void {
    this.patch({ selected: path });
  }

  async toggleHidden(): Promise<void> {
    const showHidden = !this.state.showHidden;
    this.patch({ showHidden });
    await this.ctx.storage.set('showHidden', showHidden);
  }

  // -- entry actions -------------------------------------------------------

  async open(entry: SftpEntry): Promise<void> {
    if (entry.kind === 'dir') {
      await this.navigate(entry.path);
      return;
    }
    if (entry.kind === 'symlink') {
      // A symlink may point at a directory: try listing it, fall back to the editor.
      const ok = await this.navigate(entry.path, { silent: true });
      if (ok) return;
    }
    await this.openInEditor(entry);
  }

  async createFolder(): Promise<void> {
    const sftp = this.sftp();
    if (!sftp || !this.state.path) return;
    const name = await this.ctx.ui.prompt({
      title: this.t('prompt.newFolder.title'),
      message: this.t('prompt.newFolder.message', { path: this.state.path }),
      placeholder: this.t('prompt.newFolder.placeholder'),
    });
    if (!name) return;
    try {
      await sftp.mkdir(joinPath(this.state.path, name));
      this.ctx.ui.toast(this.t('toast.created', { name }), 'success');
      await this.refresh();
    } catch (error) {
      this.fail(error);
    }
  }

  async rename(entry: SftpEntry): Promise<void> {
    const sftp = this.sftp();
    if (!sftp) return;
    const name = await this.ctx.ui.prompt({
      title: this.t('prompt.rename.title'),
      message: this.t('prompt.rename.message', { name: entry.name }),
      defaultValue: entry.name,
    });
    if (!name || name === entry.name) return;
    try {
      await sftp.rename(entry.path, joinPath(parentPath(entry.path), name));
      this.ctx.ui.toast(this.t('toast.renamed', { name }), 'success');
      await this.refresh();
    } catch (error) {
      this.fail(error);
    }
  }

  async remove(entry: SftpEntry): Promise<void> {
    const sftp = this.sftp();
    if (!sftp) return;
    const isDir = entry.kind === 'dir';
    const confirmed = await this.ctx.ui.confirm({
      title: this.t('confirm.delete.title', { name: entry.name }),
      message: this.t(isDir ? 'confirm.delete.dir' : 'confirm.delete.file'),
      okLabel: this.t('confirm.delete.ok'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await sftp.remove(entry.path, { recursive: isDir });
      this.ctx.ui.toast(this.t('toast.deleted', { name: entry.name }), 'success');
      await this.refresh();
    } catch (error) {
      this.fail(error);
    }
  }

  async copyPath(entry: SftpEntry): Promise<void> {
    try {
      await navigator.clipboard.writeText(entry.path);
      this.ctx.ui.toast(this.t('toast.copied'), 'success');
    } catch {
      this.ctx.ui.toast(this.t('toast.copyFailed'), 'error');
    }
  }

  private fail(error: unknown): void {
    this.ctx.log.error('[sftp]', error);
    this.ctx.ui.toast(describeError(error), 'error');
  }

  // -- transfers -----------------------------------------------------------

  async upload(): Promise<void> {
    const sftp = this.sftp();
    if (!sftp || !this.state.path) return;
    const files = await this.ctx.ui.pickFiles({ multiple: true, title: this.t('toolbar.upload') });
    if (!files || files.length === 0) return;
    const remoteDir = this.state.path;
    for (const file of files) {
      const name = localBasename(file);
      this.track(name, 'upload', (onProgress) =>
        sftp.upload(file, joinPath(remoteDir, name), onProgress),
      );
    }
  }

  async download(entry: SftpEntry): Promise<void> {
    const sftp = this.sftp();
    if (!sftp || entry.kind === 'dir') return;
    const localPath = await this.ctx.ui.pickSaveFile({
      title: this.t('menu.download'),
      defaultPath: entry.name,
    });
    if (!localPath) return;
    this.track(entry.name, 'download', (onProgress) =>
      sftp.download(entry.path, localPath, onProgress),
    );
  }

  private track(
    name: string,
    direction: TransferDirection,
    start: (onProgress: (p: TransferProgress) => void) => TransferHandle,
  ): void {
    let handle: TransferHandle;
    try {
      handle = start((progress) => this.onProgress(progress));
    } catch (error) {
      this.fail(error);
      return;
    }
    const item: TransferItem = {
      id: handle.transferId,
      name,
      direction,
      transferred: 0,
      total: null,
      status: 'running',
    };
    this.handles.set(handle.transferId, handle);
    this.patch({ transfers: [...this.state.transfers, item] });
    handle.done.then(
      () => {
        this.finish(handle.transferId, 'done');
        this.ctx.ui.toast(
          this.t(direction === 'upload' ? 'toast.uploaded' : 'toast.downloaded', { name }),
          'success',
        );
        if (direction === 'upload') void this.refresh();
      },
      (error: unknown) => {
        if (isCancellation(error)) {
          this.finish(handle.transferId, 'cancelled');
          this.ctx.ui.toast(this.t('toast.cancelled'), 'info');
        } else {
          this.finish(handle.transferId, 'error', describeError(error));
          this.ctx.ui.toast(describeError(error), 'error');
        }
      },
    );
  }

  private onProgress(progress: TransferProgress): void {
    this.patch({
      transfers: this.state.transfers.map((item) =>
        item.id === progress.transferId
          ? { ...item, transferred: progress.transferred, total: progress.total }
          : item,
      ),
    });
  }

  private finish(id: string, status: TransferStatus, message?: string): void {
    this.handles.delete(id);
    this.patch({
      transfers: this.state.transfers.map((item) =>
        item.id === id ? { ...item, status, ...(message === undefined ? {} : { message }) } : item,
      ),
    });
    this.later(() => this.removeTransfer(id), TRANSFER_LINGER_MS);
  }

  removeTransfer(id: string): void {
    this.patch({ transfers: this.state.transfers.filter((item) => item.id !== id) });
  }

  clearFinished(): void {
    this.patch({ transfers: this.state.transfers.filter((item) => item.status === 'running') });
  }

  async cancelTransfer(id: string): Promise<void> {
    const handle = this.handles.get(id);
    if (!handle) return;
    try {
      await handle.cancel();
    } catch (error) {
      this.ctx.log.warn('[sftp] cancel failed', error);
    }
  }

  // -- quick editor --------------------------------------------------------

  async openInEditor(entry: SftpEntry): Promise<void> {
    const sftp = this.sftp();
    if (!sftp) return;
    if (entry.size !== null && entry.size > MAX_EDIT_BYTES) {
      this.ctx.ui.toast(this.t('viewer.tooLarge', { size: formatSize(entry.size) }), 'warning');
      return;
    }
    this.patch({
      viewer: {
        path: entry.path,
        name: entry.name,
        content: '',
        loading: true,
        saving: false,
        dirty: false,
      },
    });
    try {
      const content = await sftp.readText(entry.path, { maxBytes: MAX_EDIT_BYTES });
      const viewer = this.state.viewer;
      if (!viewer || viewer.path !== entry.path) return;
      this.patch({ viewer: { ...viewer, content, loading: false } });
    } catch (error) {
      this.patch({ viewer: null });
      this.fail(error);
    }
  }

  editorChanged(content: string): void {
    const { viewer } = this.state;
    if (!viewer) return;
    this.patch({ viewer: { ...viewer, content, dirty: true } });
  }

  async saveEditor(): Promise<void> {
    const sftp = this.sftp();
    const { viewer } = this.state;
    if (!sftp || !viewer) return;
    this.patch({ viewer: { ...viewer, saving: true } });
    try {
      await sftp.writeText(viewer.path, viewer.content);
      this.ctx.ui.toast(this.t('toast.saved', { name: viewer.name }), 'success');
      const current = this.state.viewer;
      if (current) this.patch({ viewer: { ...current, saving: false, dirty: false } });
      await this.refresh();
    } catch (error) {
      const current = this.state.viewer;
      if (current) this.patch({ viewer: { ...current, saving: false } });
      this.fail(error);
    }
  }

  closeEditor(): void {
    this.patch({ viewer: null });
  }
}

export function useSftpState(controller: SftpController): SftpState {
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  );
  const snapshot = useCallback(() => controller.getState(), [controller]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
