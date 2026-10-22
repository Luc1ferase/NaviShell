/**
 * The title bar's menu bar: four entries whose dropdowns are the app's own menus, so a
 * menu bar item and a right-click menu look and behave the same.
 *
 * The open menu lives in the UI store rather than in here, which is what makes a native
 * menu bar's habits possible: the store's menu closes itself on an outside click, Escape
 * or a picked item, and this component only has to notice that it went away. Which entry
 * is open is therefore derived -- the items array handed to `showContextMenu` is the
 * entry's receipt, and the entry counts as open only while the store still holds that
 * exact array -- instead of being tracked separately, where it could disagree with what
 * is on screen. The receipt is kept twice over: as state, which the render needs, and in
 * a ref, which event handlers need because they may run before the state has caught up.
 */

import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { MenuItem } from '@navishell/plugin-api';

import { useI18n } from '@/core/i18n/useI18n';
import { useUiStore } from '@/core/stores/ui';
import { MENU_BAR_ENTRIES } from '@/app/menus/menubar';

/** The menu this component last opened, used to recognise it in the store. */
interface OpenedMenu {
  /** Id of the entry it belongs to. */
  key: string;
  /** The exact array passed to `showContextMenu`; identity is the receipt. */
  items: MenuItem[];
}

export function MenuBar() {
  const { t } = useI18n();
  const contextMenu = useUiStore((state) => state.contextMenu);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const receipt = useRef<OpenedMenu | null>(null);
  const [opened, setOpened] = useState<OpenedMenu | null>(null);

  // Our menu is the store's menu only while the store still holds the array we passed, so
  // any other way it closes (Escape, an outside click, a picked item) clears the entry.
  const openKey = opened && contextMenu?.items === opened.items ? opened.key : null;

  /** The same question for event handlers, which must not read a render-old `openKey`. */
  const isOpen = (key: string | undefined): boolean => {
    const current = receipt.current;
    if (!current || current.key !== key) return false;
    return useUiStore.getState().contextMenu?.items === current.items;
  };

  /** Builds the entry's items afresh and shows them under its button. */
  const openMenu = (index: number, focusFirst: boolean): void => {
    const entry = MENU_BAR_ENTRIES[index];
    const button = buttons.current[index];
    if (!entry || !button) return;
    const rect = button.getBoundingClientRect();
    const items = entry.items();
    receipt.current = { key: entry.id, items };
    setOpened(receipt.current);
    useUiStore.getState().showContextMenu(
      items,
      { x: rect.left, y: rect.bottom, focusFirst },
      {
        // ArrowLeft/ArrowRight run off the ends of the dropdown into the next entry, the
        // way a native menu bar walks its menus.
        onNavigate: (direction) => {
          const count = MENU_BAR_ENTRIES.length;
          const next = (index + direction + count) % count;
          // Focused first so the new menu takes this button as its opener, which is where
          // Escape and the close-time focus restore have to land.
          buttons.current[next]?.focus();
          openMenu(next, true);
        },
      },
    );
  };

  const onMouseDown = (index: number, event: MouseEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return;
    // Pressing the open entry closes it: `ContextMenuHost` leaves menu anchors alone on
    // an outside press precisely so this stays a toggle instead of a close-then-reopen.
    if (isOpen(MENU_BAR_ENTRIES[index]?.id)) {
      useUiStore.getState().hideContextMenu();
      return;
    }
    openMenu(index, false);
  };

  const onMouseEnter = (index: number): void => {
    // Hovering only switches menus while one is already open; it never opens the first.
    if (openKey === null || isOpen(MENU_BAR_ENTRIES[index]?.id)) return;
    openMenu(index, false);
  };

  const onClick = (index: number, event: MouseEvent<HTMLButtonElement>): void => {
    // A mouse press was already served on mousedown. `detail === 0` is the click a button
    // synthesizes for Enter and Space; `keydown` normally swallows those two first, so
    // this is the path for anything that activates the button without a keydown.
    if (event.detail !== 0) return;
    if (isOpen(MENU_BAR_ENTRIES[index]?.id)) return;
    openMenu(index, true);
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return;
    // Claimed so Enter and Space do not also arrive as a synthesized click, and so Space
    // cannot scroll anything behind the bar.
    event.preventDefault();
    openMenu(index, true);
  };

  return (
    <nav className="ns-menubar" role="menubar" aria-label={t('menubar.label')}>
      {MENU_BAR_ENTRIES.map((entry, index) => {
        const open = openKey === entry.id;
        return (
          <button
            key={entry.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            className={open ? 'ns-menubar__item ns-menubar__item--open' : 'ns-menubar__item'}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open}
            data-menu-anchor
            onMouseDown={(event) => onMouseDown(index, event)}
            onMouseEnter={() => onMouseEnter(index)}
            onClick={(event) => onClick(index, event)}
            onKeyDown={(event) => onKeyDown(index, event)}
          >
            {t(entry.labelKey)}
          </button>
        );
      })}
    </nav>
  );
}
