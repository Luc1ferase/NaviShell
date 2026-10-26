/** Translations registered into the plugin's i18n namespace on activation. */

export const en: Record<string, string> = {
  'panel.title': 'Editor',
  'command.open': 'Open a file in the editor',

  'toolbar.save': 'Save (Ctrl+S)',
  'toolbar.reload': 'Reload from the server',
  'toolbar.wrap': 'Wrap long lines',

  'state.loading': 'Loading {{name}}…',
  'state.error': 'Could not open {{name}}',
  'state.invalid': 'Nothing to edit here.',
  'state.close': 'Close',
  'state.disconnected':
    'The connection is closed; reopen the file from the file manager to save it.',

  'status.position': 'Ln {{line}}, Col {{col}}',
  'status.selected': '{{count}} selected',
  'status.spaces': 'Spaces: {{size}}',
  'status.tabs': 'Tabs: {{size}}',

  'confirm.discard.title': 'Discard changes to {{name}}?',
  'confirm.discard.message': 'The file has unsaved changes.',
  'confirm.discard.ok': 'Discard',
  'confirm.reload.title': 'Reload {{name}}?',
  'confirm.reload.message': 'Your unsaved changes will be lost.',
  'confirm.reload.ok': 'Reload',
  'confirm.overwrite.title': 'Overwrite {{name}}?',
  'confirm.overwrite.message': 'The file changed on the server after you opened it.',
  'confirm.overwrite.ok': 'Overwrite',

  'toast.saved': 'Saved {{name}}',
  'toast.saveFailed': 'Could not save {{name}}: {{message}}',
};

export const zhCN: Record<string, string> = {
  'panel.title': '编辑器',
  'command.open': '在编辑器中打开文件',

  'toolbar.save': '保存 (Ctrl+S)',
  'toolbar.reload': '从服务器重新加载',
  'toolbar.wrap': '自动换行',

  'state.loading': '正在加载 {{name}}…',
  'state.error': '无法打开 {{name}}',
  'state.invalid': '这里没有可编辑的内容。',
  'state.close': '关闭',
  'state.disconnected': '连接已关闭；请从文件管理器重新打开文件后再保存。',

  'status.position': '行 {{line}}，列 {{col}}',
  'status.selected': '已选 {{count}} 个字符',
  'status.spaces': '空格: {{size}}',
  'status.tabs': '制表符: {{size}}',

  'confirm.discard.title': '放弃对 {{name}} 的修改？',
  'confirm.discard.message': '文件有未保存的修改。',
  'confirm.discard.ok': '放弃',
  'confirm.reload.title': '重新加载 {{name}}？',
  'confirm.reload.message': '未保存的修改将会丢失。',
  'confirm.reload.ok': '重新加载',
  'confirm.overwrite.title': '覆盖 {{name}}？',
  'confirm.overwrite.message': '打开之后文件在服务器上被修改过。',
  'confirm.overwrite.ok': '覆盖',

  'toast.saved': '已保存 {{name}}',
  'toast.saveFailed': '无法保存 {{name}}：{{message}}',
};
