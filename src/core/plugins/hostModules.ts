/**
 * The module graph a plugin bundle may `require()`.
 *
 * Plugin bundles are built with these marked external (see `scripts/plugin-vite.mjs`),
 * so the host has to import them statically and hand the very same instances back —
 * sharing one React instance is what makes plugin components work at all.
 */

import * as React from 'react';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import * as ReactJsxDevRuntime from 'react/jsx-dev-runtime';
import * as ReactDom from 'react-dom';
import * as ReactDomClient from 'react-dom/client';
import * as PluginApi from '@navishell/plugin-api';
import * as LucideReact from 'lucide-react';

export const HOST_MODULES: Record<string, unknown> = {
  react: React,
  'react/jsx-runtime': ReactJsxRuntime,
  'react/jsx-dev-runtime': ReactJsxDevRuntime,
  'react-dom': ReactDom,
  'react-dom/client': ReactDomClient,
  '@navishell/plugin-api': PluginApi,
  'lucide-react': LucideReact,
};

export const HOST_MODULE_NAMES = Object.keys(HOST_MODULES);

/** The `require` implementation injected into plugin bundles. */
export function createPluginRequire(pluginId: string): (specifier: string) => unknown {
  return (specifier: string) => {
    if (specifier in HOST_MODULES) return HOST_MODULES[specifier];
    throw new Error(
      `[${pluginId}] require("${specifier}") is not available. The host only provides: ${HOST_MODULE_NAMES.join(', ')}`,
    );
  };
}

export { LucideReact };
