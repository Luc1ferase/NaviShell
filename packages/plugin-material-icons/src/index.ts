/**
 * luciferase.material-icons - a file icon theme for the file manager.
 *
 * Not bundled with NaviShell: it is installed from the plugin marketplace. It registers one
 * theme through `ctx.fileIcons`, built from the Material Icon Theme's SVGs, and switches the
 * file manager to it the first time it runs; afterwards the choice belongs to the user
 * (Settings → Appearance → File icons).
 */

import { definePlugin } from '@navishell/plugin-api';
import type { PluginContext } from '@navishell/plugin-api';
import { resolveIcon } from './theme';

const THEME_ID = 'material';

const en: Record<string, string> = {
  'toast.applied':
    'Material file icons are on; change them under Settings → Appearance → File icons',
};

const zhCN: Record<string, string> = {
  'toast.applied': '已启用 Material 文件图标，可在 设置 → 外观 → 文件图标 里更换',
};

/**
 * Make the theme active once, on the first run after installation. The flag lives in the
 * plugin's storage, so a user who later picks another theme (or the default) is left alone.
 */
async function applyOnFirstRun(ctx: PluginContext): Promise<void> {
  try {
    const applied = await ctx.storage.get<boolean>('applied', false);
    if (applied) return;
    ctx.fileIcons.activate(THEME_ID);
    await ctx.storage.set('applied', true);
    ctx.ui.toast(ctx.i18n.t('toast.applied'), 'info');
  } catch (error) {
    ctx.log.warn('[material-icons] could not apply the theme on first run', error);
  }
}

export default definePlugin({
  activate(ctx: PluginContext): void {
    ctx.i18n.addResources('en', en);
    ctx.i18n.addResources('zh-CN', zhCN);

    ctx.subscriptions.push(
      ctx.fileIcons.registerTheme({
        id: THEME_ID,
        label: 'Material',
        icon: resolveIcon,
      }),
    );

    void applyOnFirstRun(ctx);
  },

  deactivate(): void {},
});
