/** Translations registered into the plugin's i18n namespace on activation. */

export const en: Record<string, string> = {
  'popup.label': 'Command suggestions',
  'badge.history': 'history',
  'badge.dict': 'docs',
  'hint.navigate': '↑↓ select',
  'hint.accept': 'Tab accept',
  'hint.dismiss': 'Esc dismiss',

  'panel.history': 'History',
  'history.filter': 'Filter history…',
  'history.count': '{{count}} commands',
  'history.empty': 'No history for this server yet',
  'history.insert': 'Put this command on the prompt',

  'command.toggle': 'Toggle command completion',
  'command.history': 'Show command history',
  'toast.enabled': 'Command completion enabled',
  'toast.disabled': 'Command completion disabled',
};

export const zhCN: Record<string, string> = {
  'popup.label': '命令补全建议',
  'badge.history': '历史',
  'badge.dict': '词典',
  'hint.navigate': '↑↓ 选择',
  'hint.accept': 'Tab 采用',
  'hint.dismiss': 'Esc 关闭',

  'panel.history': '历史命令',
  'history.filter': '筛选历史命令…',
  'history.count': '{{count}} 条命令',
  'history.empty': '该服务器还没有历史命令',
  'history.insert': '把该命令填入提示符',

  'command.toggle': '开启/关闭命令补全',
  'command.history': '显示历史命令',
  'toast.enabled': '命令补全已开启',
  'toast.disabled': '命令补全已关闭',
};
