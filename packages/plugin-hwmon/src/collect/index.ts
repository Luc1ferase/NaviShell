/**
 * Picks the collector for a platform. Linux serves both local Linux machines and SSH
 * targets; macOS likewise; Windows only ever runs locally (the host does not support
 * Windows SSH targets, `uname` fails there).
 */

import type { Collector, Platform } from '../types';
import { linuxCollector } from './linux';
import { macosCollector } from './macos';
import { windowsCollector } from './windows';

export function collectorFor(platform: Platform): Collector | undefined {
  switch (platform) {
    case 'linux':
      return linuxCollector;
    case 'macos':
      return macosCollector;
    case 'windows':
      return windowsCollector;
    default:
      return undefined;
  }
}
