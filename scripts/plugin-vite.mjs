// Shared Vite configuration for built-in plugins.
//
// Each plugin is bundled as a single CommonJS file (`main.js`) plus an optional
// `style.css`, written to `<repo>/public/plugins/<id>/` together with `plugin.json`
// (copied from the plugin's `plugin/` directory via Vite's `publicDir`).
//
// Modules provided by the host at runtime are marked external and resolved by the
// host's `require` shim; see packages/plugin-api/src/index.ts.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';

export const HOST_PROVIDED_MODULES = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  '@navishell/plugin-api',
  'lucide-react',
];

/**
 * @param {string} pluginId e.g. "navishell.sftp"
 * @param {string} pkgDirUrl pass `import.meta.url` from the plugin's vite.config.ts
 * @param {{ outDir?: string, minify?: boolean }} [options] `outDir` (relative to the
 *   package) replaces the default `<repo>/public/plugins/<id>/`; plugins that are not
 *   bundled with the app build into their own `dist/` and are zipped from there (see
 *   scripts/pack-plugin.mjs). `minify` (default false, so bundles stay readable) is for
 *   plugins that carry a large library.
 */
export function createPluginConfig(pluginId, pkgDirUrl, options = {}) {
  const pkgDir = path.dirname(fileURLToPath(pkgDirUrl));
  const repoRoot = path.resolve(pkgDir, '..', '..');
  const outDir = options.outDir
    ? path.resolve(pkgDir, options.outDir)
    : path.join(repoRoot, 'public', 'plugins', pluginId);

  return defineConfig({
    plugins: [react()],
    publicDir: path.join(pkgDir, 'plugin'),
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
      minify: options.minify ?? false,
      cssCodeSplit: false,
      target: ['es2022', 'chrome105', 'safari14'],
      lib: {
        entry: path.join(pkgDir, 'src', 'index.ts'),
        formats: ['cjs'],
        fileName: () => 'main.js',
        cssFileName: 'style',
      },
      rollupOptions: {
        external: HOST_PROVIDED_MODULES,
        output: {
          exports: 'named',
        },
      },
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', pkgDirUrl)),
      },
    },
  });
}
