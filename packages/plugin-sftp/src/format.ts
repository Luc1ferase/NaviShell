/** Pure formatting / path helpers for the SFTP panel (no host APIs, easy to test). */

import type { SftpEntry, SftpEntryKind } from '@navishell/plugin-api';

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/** `1536` -> `"1.5 KB"`. `null` -> `"-"`. */
export function formatSize(size: number | null): string {
  if (size === null || !Number.isFinite(size) || size < 0) return '-';
  if (size < 1024) return `${size} B`;
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${SIZE_UNITS[unit] ?? 'B'}`;
}

/** Unix epoch *seconds* -> locale date/time. Older than the current year keeps the year. */
export function formatMtime(mtime: number | null, locale: string): string {
  if (mtime === null || !Number.isFinite(mtime) || mtime <= 0) return '-';
  const date = new Date(mtime * 1000);
  if (Number.isNaN(date.getTime())) return '-';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const options: Intl.DateTimeFormatOptions = sameYear
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: '2-digit', day: '2-digit' };
  try {
    return date.toLocaleString(locale, options);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

function triplet(bits: number): string {
  return `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${bits & 1 ? 'x' : '-'}`;
}

/** POSIX mode bits -> `"drwxr-xr-x"` (setuid/setgid/sticky included). */
export function formatPermissions(mode: number | null, kind: SftpEntryKind): string {
  const type = kind === 'dir' ? 'd' : kind === 'symlink' ? 'l' : kind === 'other' ? '?' : '-';
  if (mode === null || !Number.isFinite(mode)) return `${type}---------`;
  const bits = mode & 0o7777;
  const chars = (
    type +
    triplet((bits >> 6) & 7) +
    triplet((bits >> 3) & 7) +
    triplet(bits & 7)
  ).split('');
  if (bits & 0o4000) chars[3] = chars[3] === 'x' ? 's' : 'S';
  if (bits & 0o2000) chars[6] = chars[6] === 'x' ? 's' : 'S';
  if (bits & 0o1000) chars[9] = chars[9] === 'x' ? 't' : 'T';
  return chars.join('');
}

/** `0o755` -> `"755"`. */
export function formatOctal(mode: number | null): string {
  if (mode === null || !Number.isFinite(mode)) return '';
  return (mode & 0o7777).toString(8).padStart(3, '0');
}

/** Collapse `.`/`..`/duplicate slashes into an absolute POSIX path. */
export function normalizePath(input: string): string {
  const parts = input.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return `/${out.join('/')}`;
}

export function joinPath(base: string, name: string): string {
  if (name.startsWith('/')) return normalizePath(name);
  return normalizePath(`${base}/${name}`);
}

export function parentPath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '/';
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
}

/** Last segment of a local path (handles Windows and POSIX separators). */
export function localBasename(path: string): string {
  const segments = path
    .split('\\')
    .join('/')
    .split('/')
    .filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

/** Directories first, then case-insensitive name order. */
export function compareEntries(a: SftpEntry, b: SftpEntry): number {
  const aDir = a.kind === 'dir' ? 0 : 1;
  const bDir = b.kind === 'dir' ? 0 : 1;
  if (aDir !== bDir) return aDir - bDir;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

/** Drops `.`/`..` and sorts. */
export function sortEntries(entries: readonly SftpEntry[]): SftpEntry[] {
  return entries.filter((entry) => entry.name !== '.' && entry.name !== '..').sort(compareEntries);
}

export function isHidden(entry: SftpEntry): boolean {
  return entry.name.startsWith('.');
}

export function percent(transferred: number, total: number | null): number {
  if (total === null || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((transferred / total) * 100)));
}
