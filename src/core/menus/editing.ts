/**
 * Context menus for text that is not a terminal: an editable field (undo, cut, copy,
 * paste, select all), selected text anywhere (copy) and links (open, copy address).
 *
 * Editing goes through `document.execCommand`, which is the one API that keeps the
 * field's undo history and fires the `input` event React listens to; the clipboard read
 * for Paste uses the async clipboard API because `execCommand('paste')` is not allowed
 * from script.
 */

import { openUrl } from '@tauri-apps/plugin-opener';
import type { MenuItem } from '@navishell/plugin-api';

import { t } from '../i18n';
import { errorMessage } from '../ipc/client';
import { useUiStore } from '../stores/ui';
import { isMac, shortcutLabel } from './shortcuts';

export type EditableElement = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

/** Input types that hold editable text (and expose a selection range, mostly). */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'password', 'email', 'number']);

const SEPARATOR: MenuItem = { label: '', separator: true };

function report(error: unknown): void {
  const message = errorMessage(error);
  if (message) useUiStore.getState().toast(message, 'error');
}

/** The editable field `target` is or sits in, or `null`. Terminals handle their own. */
export function editableTarget(target: EventTarget | null): EditableElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>('input, textarea, [contenteditable]');
  if (!element || element.closest('.xterm')) return null;
  if (element instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(element.type) ? element : null;
  }
  if (element instanceof HTMLTextAreaElement) return element;
  return element.isContentEditable ? element : null;
}

function isTextField(field: EditableElement): field is HTMLInputElement | HTMLTextAreaElement {
  return field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement;
}

function hasSelection(field: EditableElement): boolean {
  if (isTextField(field)) {
    // Some input types expose no selection range; there may well be one.
    if (field.selectionStart === null || field.selectionEnd === null) return true;
    return field.selectionStart !== field.selectionEnd;
  }
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && field.contains(selection.anchorNode);
}

function isLocked(field: EditableElement): boolean {
  return isTextField(field) ? field.readOnly || field.disabled : false;
}

function exec(field: EditableElement, command: string): void {
  field.focus();
  try {
    document.execCommand(command);
  } catch (error) {
    console.warn(`[navishell] ${command} failed`, error);
  }
}

async function paste(field: EditableElement): Promise<void> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch (error) {
    console.warn('[navishell] clipboard read failed', error);
    return;
  }
  if (!text) return;
  field.focus();
  if (document.execCommand('insertText', false, text)) return;
  // No editing command support: splice the text in and tell React about it.
  if (isTextField(field)) {
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    field.setRangeText(text, start, end, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function selectAll(field: EditableElement): void {
  field.focus();
  if (isTextField(field)) field.select();
  else exec(field, 'selectAll');
}

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    console.warn('[navishell] clipboard write failed', error);
  }
}

/** The menu of an editable field. */
export function editMenuItems(field: EditableElement): MenuItem[] {
  const selected = hasSelection(field);
  const locked = isLocked(field);
  // Browsers refuse to copy out of password fields; the items would just do nothing.
  const secret = field instanceof HTMLInputElement && field.type === 'password';
  return [
    {
      id: 'undo',
      label: t('menu.edit.undo'),
      icon: 'Undo2',
      shortcut: shortcutLabel('Mod+Z'),
      disabled: locked,
      onClick: () => exec(field, 'undo'),
    },
    {
      id: 'redo',
      label: t('menu.edit.redo'),
      icon: 'Redo2',
      shortcut: shortcutLabel(isMac ? 'Mod+Shift+Z' : 'Ctrl+Y'),
      disabled: locked,
      onClick: () => exec(field, 'redo'),
    },
    SEPARATOR,
    {
      id: 'cut',
      label: t('menu.edit.cut'),
      icon: 'Scissors',
      shortcut: shortcutLabel('Mod+X'),
      disabled: !selected || locked || secret,
      onClick: () => exec(field, 'cut'),
    },
    {
      id: 'copy',
      label: t('menu.edit.copy'),
      icon: 'Copy',
      shortcut: shortcutLabel('Mod+C'),
      disabled: !selected || secret,
      onClick: () => exec(field, 'copy'),
    },
    {
      id: 'paste',
      label: t('menu.edit.paste'),
      icon: 'ClipboardPaste',
      shortcut: shortcutLabel('Mod+V'),
      disabled: locked,
      onClick: () => void paste(field),
    },
    SEPARATOR,
    {
      id: 'select-all',
      label: t('menu.edit.selectAll'),
      icon: 'TextSelect',
      shortcut: shortcutLabel('Mod+A'),
      onClick: () => selectAll(field),
    },
  ];
}

/** The selected text when the selection touches `within`; `''` otherwise. */
export function selectedText(within: Element): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return '';
  const text = selection.toString();
  if (!text.trim()) return '';
  return selection.containsNode(within, true) || within.contains(selection.anchorNode) ? text : '';
}

/** A "Copy" item that puts `text` on the clipboard. */
export function copyTextItem(text: string): MenuItem {
  return {
    id: 'copy',
    label: t('menu.edit.copy'),
    icon: 'Copy',
    shortcut: shortcutLabel('Mod+C'),
    onClick: () => void writeClipboard(text),
  };
}

/** Open in the system browser, copy the address. */
export function linkMenuItems(href: string): MenuItem[] {
  return [
    {
      id: 'open-link',
      label: t('menu.edit.openLink'),
      icon: 'ExternalLink',
      onClick: () => void openUrl(href).catch(report),
    },
    {
      id: 'copy-link',
      label: t('menu.edit.copyLink'),
      icon: 'Link',
      onClick: () => void writeClipboard(href),
    },
  ];
}
