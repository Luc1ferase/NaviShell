/**
 * The last word on right clicks: whatever reaches the document unhandled gets either one
 * of the app's own menus (editable field, selected text, link) or no menu at all. The
 * WebView's built-in menu (back, forward, reload, inspect) never shows; nothing in it
 * applies to this app.
 *
 * Components that want their own menu handle `contextmenu` themselves, call
 * `preventDefault()` and open it through the ui store; this listener runs after them and
 * leaves handled events alone.
 */

import type { MenuItem } from '@navishell/plugin-api';

import { useUiStore, type ContextMenuPosition } from '../stores/ui';
import {
  copyTextItem,
  editMenuItems,
  editableTarget,
  linkMenuItems,
  selectedText,
} from './editing';

const SEPARATOR: MenuItem = { label: '', separator: true };

/**
 * Where a menu opened by `event` goes: at the pointer for a mouse click, under `anchor`
 * (or the event target) for a keyboard-triggered one (Shift+F10, the Menu key), which
 * also asks the menu to focus its first item.
 */
export function menuPositionFor(event: MouseEvent, anchor?: Element | null): ContextMenuPosition {
  if (event.button === 2) return { x: event.clientX, y: event.clientY };
  const element = anchor ?? (event.target instanceof Element ? event.target : null);
  const rect = element?.getBoundingClientRect();
  if (!rect) return { x: event.clientX, y: event.clientY, focusFirst: true };
  return { x: rect.left + Math.min(16, rect.width / 2), y: rect.bottom, focusFirst: true };
}

/** Installs the document-level handler; returns the function that removes it. */
export function installContextMenuGuard(): () => void {
  const onContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const show = useUiStore.getState().showContextMenu;

    const field = editableTarget(target);
    if (field) {
      show(editMenuItems(field), menuPositionFor(event, field));
      return;
    }

    const items: MenuItem[] = [];
    const text = selectedText(target);
    if (text) items.push(copyTextItem(text));
    const href = target.closest('a[href]')?.getAttribute('href') ?? '';
    if (/^https?:/i.test(href)) {
      if (items.length > 0) items.push(SEPARATOR);
      items.push(...linkMenuItems(href));
    }
    if (items.length > 0) show(items, menuPositionFor(event, target));
  };
  document.addEventListener('contextmenu', onContextMenu);
  return () => document.removeEventListener('contextmenu', onContextMenu);
}
