import type { JSX, KeyboardEvent, MouseEvent } from 'react';
import { Archive, Box, File, FileCode, FileSymlink, FileText, Folder, Image } from 'lucide-react';
import type { SftpEntry } from '@navishell/plugin-api';
import { formatMtime, formatOctal, formatPermissions, formatSize } from '../format';
import type { Translate } from '../types';

const CODE_EXTENSIONS = new Set([
  'c',
  'cjs',
  'cpp',
  'cs',
  'css',
  'go',
  'h',
  'hpp',
  'html',
  'java',
  'js',
  'json',
  'jsx',
  'kt',
  'lua',
  'mjs',
  'php',
  'py',
  'rb',
  'rs',
  'sh',
  'sql',
  'swift',
  'toml',
  'ts',
  'tsx',
  'vue',
  'xml',
  'yaml',
  'yml',
  'zsh',
]);
const TEXT_EXTENSIONS = new Set(['conf', 'cfg', 'env', 'ini', 'log', 'md', 'rst', 'txt']);
const IMAGE_EXTENSIONS = new Set(['bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const ARCHIVE_EXTENSIONS = new Set(['7z', 'bz2', 'gz', 'rar', 'tar', 'tgz', 'xz', 'zip', 'zst']);

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toLowerCase() : '';
}

function EntryIcon({ entry }: { entry: SftpEntry }): JSX.Element {
  if (entry.kind === 'dir') return <Folder size={15} className="ns-sftp-icon-dir" />;
  if (entry.kind === 'symlink') return <FileSymlink size={15} className="ns-sftp-icon-link" />;
  if (entry.kind === 'other') return <Box size={15} className="ns-sftp-icon-other" />;
  const extension = extensionOf(entry.name);
  if (CODE_EXTENSIONS.has(extension)) return <FileCode size={15} className="ns-sftp-icon-code" />;
  if (TEXT_EXTENSIONS.has(extension)) return <FileText size={15} className="ns-sftp-icon-file" />;
  if (IMAGE_EXTENSIONS.has(extension)) return <Image size={15} className="ns-sftp-icon-image" />;
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return <Archive size={15} className="ns-sftp-icon-archive" />;
  }
  return <File size={15} className="ns-sftp-icon-file" />;
}

interface EntryListProps {
  entries: SftpEntry[];
  selected: string | null;
  locale: string;
  t: Translate;
  onSelect: (entry: SftpEntry) => void;
  onOpen: (entry: SftpEntry) => void;
  onContextMenu: (entry: SftpEntry, position: { x: number; y: number }) => void;
  onUp: () => void;
  onRename: (entry: SftpEntry) => void;
  onDelete: (entry: SftpEntry) => void;
}

export function EntryList({
  entries,
  selected,
  locale,
  t,
  onSelect,
  onOpen,
  onContextMenu,
  onUp,
  onRename,
  onDelete,
}: EntryListProps): JSX.Element {
  const selectedEntry = entries.find((entry) => entry.path === selected);

  const move = (delta: number): void => {
    if (entries.length === 0) return;
    const current = selectedEntry ? entries.indexOf(selectedEntry) : -1;
    const next = Math.max(0, Math.min(entries.length - 1, current + delta));
    const entry = entries[current === -1 ? 0 : next];
    if (entry) onSelect(entry);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Enter':
        if (selectedEntry) {
          event.preventDefault();
          onOpen(selectedEntry);
        }
        break;
      case 'Backspace':
        event.preventDefault();
        onUp();
        break;
      case 'F2':
        if (selectedEntry) {
          event.preventDefault();
          onRename(selectedEntry);
        }
        break;
      case 'Delete':
        if (selectedEntry) {
          event.preventDefault();
          onDelete(selectedEntry);
        }
        break;
      default:
        break;
    }
  };

  const onRowContextMenu = (entry: SftpEntry, event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    onSelect(entry);
    onContextMenu(entry, { x: event.clientX, y: event.clientY });
  };

  return (
    <div
      className="ns-sftp-list"
      role="listbox"
      tabIndex={0}
      aria-label={t('columns.name')}
      onKeyDown={onKeyDown}
    >
      {entries.map((entry) => (
        <div
          key={entry.path}
          role="option"
          aria-selected={entry.path === selected}
          className={`ns-sftp-row${entry.path === selected ? ' ns-sftp-row-selected' : ''}`}
          onClick={() => onSelect(entry)}
          onDoubleClick={() => onOpen(entry)}
          onContextMenu={(event) => onRowContextMenu(entry, event)}
        >
          <span className="ns-sftp-cell-icon">
            <EntryIcon entry={entry} />
          </span>
          <span className="ns-sftp-cell-name" title={entry.path}>
            {entry.name}
          </span>
          <span className="ns-sftp-cell-size" title={t('columns.size')}>
            {entry.kind === 'dir' ? '' : formatSize(entry.size)}
          </span>
          <span className="ns-sftp-cell-time" title={t('columns.modified')}>
            {formatMtime(entry.mtime, locale)}
          </span>
          <span
            className="ns-sftp-cell-perms"
            title={`${t('columns.permissions')} ${formatOctal(entry.permissions)}`}
          >
            {formatPermissions(entry.permissions, entry.kind)}
          </span>
        </div>
      ))}
    </div>
  );
}
