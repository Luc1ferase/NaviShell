import { createElement, type ComponentType } from 'react';

import { LucideReact } from '@/core/plugins/hostModules';

export interface IconProps {
  /** lucide-react export name, e.g. `Server` or `folder-open`. */
  name?: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

type IconComponent = ComponentType<{
  size?: number | string;
  className?: string;
  strokeWidth?: number;
}>;

// lucide-react is imported as a whole anyway (plugins `require` it), so looking icons
// up by name costs nothing extra.
const ICONS = LucideReact as unknown as Record<string, IconComponent | undefined>;

function pascalCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function resolveIcon(name: string | undefined): IconComponent | undefined {
  if (!name) return undefined;
  const direct = ICONS[name];
  if (typeof direct === 'function' || typeof direct === 'object') return direct;
  return ICONS[pascalCase(name)];
}

/**
 * Renders a lucide icon by name; unknown names render nothing.
 *
 * The component is looked up in lucide's export map rather than defined here, so
 * `createElement` is used directly: these are stable module-level components, not
 * components created during render.
 */
export function Icon({ name, size = 14, className, strokeWidth = 1.75 }: IconProps) {
  const component = resolveIcon(name);
  if (!component) return null;
  return createElement(component, { size, className, strokeWidth });
}
