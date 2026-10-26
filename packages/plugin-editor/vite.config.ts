import { createPluginConfig } from '../../scripts/plugin-vite.mjs';

// CodeMirror and its grammars are the bulk of this bundle, so it is the one built-in
// plugin that ships minified.
export default createPluginConfig('navishell.editor', import.meta.url, { minify: true });
