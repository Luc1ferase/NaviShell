/**
 * navishell.lang-zh-tw - a language pack, the same way VS Code ships UI languages as extensions.
 *
 * It contributes nothing but strings: the host namespace (`host.json`, mirroring
 * `src/core/i18n/locales/en.json`) and one bundle per built-in plugin, keyed by plugin id.
 * The host picks the pack up through `ctx.i18n.registerLocale`; disabling the plugin
 * removes the language again and the UI falls back to a built-in locale.
 */

import { definePlugin } from '@navishell/plugin-api';
import type { PluginContext } from '@navishell/plugin-api';
import host from './host.json';
import completion from './plugins/navishell.completion.json';
import completionDict from './plugins/navishell.completion.dict.json';
import editor from './plugins/navishell.editor.json';
import sftp from './plugins/navishell.sftp.json';

export default definePlugin({
  activate(ctx: PluginContext): void {
    ctx.subscriptions.push(
      ctx.i18n.registerLocale({
        id: 'zh-TW',
        name: '繁體中文',
        matches: ['zh-tw', 'zh-hk', 'zh-mo', 'zh-hant'],
        fallback: 'zh-CN',
        host,
        plugins: {
          'navishell.editor': editor,
          'navishell.sftp': sftp,
          'navishell.completion': { ...completion, ...completionDict },
        },
      }),
    );
  },
});
