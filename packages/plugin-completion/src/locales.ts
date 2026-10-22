/** Translations registered into the plugin's i18n namespace on activation. */

export const en: Record<string, string> = {
  'popup.label': 'Command suggestions',
  'badge.history': 'history',
  'badge.remote': 'remote',
  'badge.path': 'path',
  'badge.dict': 'docs',
  'hint.navigate': '↑↓ select',
  'hint.accept': '→ accept',
  'hint.tabShell': 'Tab shell completion',
  'hint.enterRun': 'Enter run as typed',
  'hint.enterAccept': 'Tab / Enter / → accept',
  'hint.dismiss': 'Esc dismiss',
  'hint.integration': 'shell integration',
  'hint.integrationHint': 'This shell reports its working directory and the exact commands it runs',

  'panel.history': 'History',
  'history.filter': 'Filter history…',
  'history.count': '{{count}} commands',
  'history.empty': 'No commands recorded yet',
  'history.insert': 'Put this command on the prompt',

  'command.toggle': 'Toggle command completion',
  'command.history': 'Show command history',
  'command.shellIntegration': 'Toggle shell integration (directory and exact history)',
  'toast.enabled': 'Command completion enabled',
  'toast.disabled': 'Command completion disabled',
  'toast.integrationEnabled':
    'Shell integration on: new SSH terminals will report their directory and the commands they run',
  'toast.integrationDisabled': 'Shell integration off',
};

export const zhCN: Record<string, string> = {
  'popup.label': '命令补全建议',
  'badge.history': '历史',
  'badge.remote': '远端',
  'badge.path': '路径',
  'badge.dict': '词典',
  'hint.navigate': '↑↓ 选择',
  'hint.accept': '→ 采用',
  'hint.tabShell': 'Tab 交给 shell 补全',
  'hint.enterRun': 'Enter 按原样执行',
  'hint.enterAccept': 'Tab / Enter / → 采用',
  'hint.dismiss': 'Esc 关闭',
  'hint.integration': 'shell 集成',
  'hint.integrationHint': '该 shell 会上报当前工作目录和实际执行的命令',

  'panel.history': '历史命令',
  'history.filter': '筛选历史命令…',
  'history.count': '{{count}} 条命令',
  'history.empty': '还没有记录到命令',
  'history.insert': '把该命令填入提示符',

  'command.toggle': '开启/关闭命令补全',
  'command.history': '显示历史命令',
  'command.shellIntegration': '开启/关闭 shell 集成（上报当前目录与命令）',
  'toast.enabled': '命令补全已开启',
  'toast.disabled': '命令补全已关闭',
  'toast.integrationEnabled': 'shell 集成已开启：之后新建的 SSH 终端会上报当前目录与执行的命令',
  'toast.integrationDisabled': 'shell 集成已关闭',
};
