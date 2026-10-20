import { createPluginConfig } from '../../scripts/plugin-vite.mjs';

// Not a built-in: the bundle goes to this package's dist/ and is zipped from there.
export default createPluginConfig('luciferase.hwmon', import.meta.url, { outDir: 'dist' });
