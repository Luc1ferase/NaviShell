/**
 * navishell.editor - a lightweight code editor for remote files.
 *
 * Other plugins open a file with the `navishell.editor:open` command; each file becomes
 * its own centre tab (an instance of the `file` panel keyed by connection and path), and
 * the tab loads and saves the file through that connection's SFTP client.
 */

import { definePlugin } from '@navishell/plugin-api';
import type { PluginContext } from '@navishell/plugin-api';
import { EditorPanel } from './EditorPanel';
import { en, zhCN } from './locales';
import './styles.css';

const PANEL_ID = 'file';

/** Argument of the `open` command. */
export interface OpenFileArgs {
  connectionId: string;
  /** Absolute remote path. */
  path: string;
  /** Tab title; defaults to the last path segment. */
  name?: string;
}

function parseArgs(raw: unknown): OpenFileArgs {
  const usage =
    'navishell.editor:open expects { connectionId: string, path: string, name?: string }';
  if (typeof raw !== 'object' || raw === null) throw new Error(usage);
  const { connectionId, path, name } = raw as Record<string, unknown>;
  if (typeof connectionId !== 'string' || connectionId === '') throw new Error(usage);
  if (typeof path !== 'string' || path === '') throw new Error(usage);
  if (name !== undefined && typeof name !== 'string') throw new Error(usage);
  return { connectionId, path, name };
}

function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return (slash < 0 ? trimmed : trimmed.slice(slash + 1)) || path;
}

export default definePlugin({
  activate(ctx: PluginContext): void {
    ctx.i18n.addResources('en', en);
    ctx.i18n.addResources('zh-CN', zhCN);

    ctx.subscriptions.push(
      ctx.panels.register({
        id: PANEL_ID,
        title: 'panel.title',
        icon: 'FileCode',
        component: EditorPanel,
        defaultPosition: 'main',
        // Unsaved text lives in the component; a hidden tab must not lose it.
        keepAlive: true,
      }),
      ctx.commands.register({
        id: 'open',
        title: 'command.open',
        icon: 'FileCode',
        handler: (raw: unknown) => {
          const args = parseArgs(raw);
          const name = args.name ?? baseName(args.path);
          const connection = ctx.connections.get(args.connectionId);
          const tooltip = connection
            ? `${connection.username}@${connection.host}:${args.path}`
            : args.path;
          ctx.panels.open(PANEL_ID, {
            instance: `${args.connectionId}:${args.path}`,
            params: { connectionId: args.connectionId, path: args.path, name },
            title: name,
            tooltip,
            position: 'main',
            // The file lives on a connection that will not survive a restart.
            transient: true,
          });
        },
      }),
    );
  },
});
