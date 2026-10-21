import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import type { MenuItem } from '@navishell/plugin-api';

import { useUiStore, type ContextMenuState } from '@/core/stores/ui';
import { Icon } from './Icon';

/** Breathing room kept between a panel and the window edge. */
const MARGIN = 6;
/** Border plus padding of `.ns-menu`, compensated so a submenu's first row lines up. */
const PANEL_INSET = 5;
/** Gap between a submenu and the panel it hangs off. */
const SUBMENU_GAP = 2;
/** How long a submenu row stays hovered before its submenu opens, in ms. */
const SUBMENU_DELAY = 150;
/** The icon column: also the size icons and the submenu chevron are drawn at. */
const ICON_SIZE = 14;

/** A root panel sits at a point, a submenu hangs off a row of the panel above it. */
type PanelAnchor =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'submenu'; itemTop: number; panelLeft: number; panelRight: number };

type SubmenuAnchor = Extract<PanelAnchor, { kind: 'submenu' }>;

interface OpenLevel {
  /** Index of the row the submenu belongs to, inside the level above it. */
  index: number;
  /** Measured when the submenu opened, so the panel can place itself in one pass. */
  anchor: SubmenuAnchor;
}

/** Everything that changes while a menu is open; one of these per opened menu. */
interface MenuNav {
  /** The menu this state describes. A different one starts from scratch. */
  menu: ContextMenuState | null;
  /** Open submenus, outermost first. */
  levels: OpenLevel[];
  /** Highlighted index per level, `-1` when a level has no highlight. */
  active: number[];
}

const CLOSED: MenuNav = { menu: null, levels: [], active: [] };

/** Rows that can be highlighted and activated: separators and disabled ones cannot. */
function isSelectable(item: MenuItem | undefined): boolean {
  return item !== undefined && !item.separator && !item.disabled;
}

/** Next selectable index `offset` steps from `from`, wrapping; `-1` when there is none. */
function stepIndex(items: MenuItem[], from: number, direction: 1 | -1): number {
  const count = items.length;
  for (let offset = 1; offset <= count; offset += 1) {
    const index = (((from + direction * offset) % count) + count) % count;
    if (isSelectable(items[index])) return index;
  }
  return -1;
}

/** First selectable row after `from` whose label starts with `char`, for typeahead. */
function matchIndex(items: MenuItem[], from: number, char: string): number {
  const needle = char.toLowerCase();
  const count = items.length;
  for (let offset = 1; offset <= count; offset += 1) {
    const index = (((from + offset) % count) + count) % count;
    const item = items[index];
    if (isSelectable(item) && item?.label.toLowerCase().startsWith(needle)) return index;
  }
  return -1;
}

/** The state a freshly opened menu starts from, including a keyboard opener's highlight. */
function initialNav(menu: ContextMenuState | null): MenuNav {
  if (!menu) return CLOSED;
  const first = menu.position.focusFirst ? stepIndex(menu.items, -1, 1) : -1;
  return { menu, levels: [], active: first >= 0 ? [first] : [] };
}

/** The items of every open panel, root first. Recurses through `submenu` per open level. */
function openLevels(nav: MenuNav): MenuItem[][] {
  if (!nav.menu) return [];
  const levels: MenuItem[][] = [nav.menu.items];
  for (const level of nav.levels) {
    const submenu = levels[levels.length - 1]?.[level.index]?.submenu;
    if (!submenu) break;
    levels.push(submenu);
  }
  return levels;
}

/** Copies `active` with the entry for `depth` set, dropping the levels below it. */
function withActive(active: number[], depth: number, index: number): number[] {
  const next = active.slice(0, depth);
  while (next.length < depth) next.push(-1);
  next.push(index);
  return next;
}

function itemKey(depth: number, index: number): string {
  return `${depth}:${index}`;
}

function focusItem(refs: Map<string, HTMLButtonElement>, depth: number, index: number): void {
  refs.get(itemKey(depth, index))?.focus();
}

/** Keeps one panel edge inside the viewport, leaving `MARGIN` around it. */
function clampEdge(start: number, size: number, limit: number): number {
  return Math.max(MARGIN, Math.min(start, limit - size - MARGIN));
}

/** True while the event happened inside any menu panel, which must not close it. */
function insideMenu(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.ns-menu') !== null;
}

/**
 * The app's context menu: a root panel plus one panel per open submenu, fed by
 * `useUiStore().contextMenu`. It stands in for the WebView's native menu everywhere, so
 * it has to serve the keyboard as well as the mouse, and the two share one highlight.
 */
export function ContextMenuHost() {
  const menu = useUiStore((state) => state.contextMenu);
  const hide = useUiStore((state) => state.hideContextMenu);
  const [stored, setNav] = useState<MenuNav>(CLOSED);
  const panelRefs = useRef(new Map<number, HTMLDivElement>());
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const hoverTimer = useRef<number | null>(null);
  const pendingFocus = useRef<{ depth: number; index: number } | null>(null);

  // State left behind by the previous menu is ignored rather than cleared in an effect,
  // so the very first render of a new menu already carries the right highlight.
  const nav = stored.menu === menu ? stored : initialNav(menu);
  const levels = openLevels(nav);
  /** Depth of the innermost open panel: the one the keyboard drives. */
  const innermost = levels.length - 1;

  /** Applies a change to the live state, rebasing anything aimed at an older menu. */
  const update = (change: (current: MenuNav) => MenuNav) => {
    setNav((current) => change(current.menu === menu ? current : initialNav(menu)));
  };

  const clearHoverTimer = () => {
    if (hoverTimer.current === null) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };

  /** Closes the submenu opened by level `depth` and everything below it. */
  const closeBelow = (depth: number) => {
    update((current) => ({
      ...current,
      levels: current.levels.slice(0, depth),
      active: current.active.slice(0, depth + 1),
    }));
  };

  /** Moves the highlight inside one level, closing whatever that level had open. */
  const moveTo = (depth: number, index: number) => {
    if (index < 0) return;
    update((current) => ({
      ...current,
      levels: current.levels.slice(0, depth),
      active: withActive(current.active, depth, index),
    }));
    focusItem(itemRefs.current, depth, index);
  };

  /** Opens the submenu of row `index`, measuring where it should hang from the live DOM. */
  const openSubmenu = (depth: number, index: number, submenu: MenuItem[], focusFirst: boolean) => {
    clearHoverTimer();
    const row = itemRefs.current.get(itemKey(depth, index));
    const panel = panelRefs.current.get(depth);
    if (!row || !panel || submenu.length === 0) return;
    const rowBox = row.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    const anchor: SubmenuAnchor = {
      kind: 'submenu',
      itemTop: rowBox.top,
      panelLeft: panelBox.left,
      panelRight: panelBox.right,
    };
    const first = focusFirst ? stepIndex(submenu, -1, 1) : -1;
    update((current) => {
      const active = withActive(current.active, depth, index);
      if (first >= 0) active.push(first);
      return { ...current, levels: [...current.levels.slice(0, depth), { index, anchor }], active };
    });
    // The submenu panel does not exist yet, so its row is focused after the next commit.
    if (first >= 0) pendingFocus.current = { depth: depth + 1, index: first };
  };

  /** Closes the innermost submenu and hands the highlight back to its parent row. */
  const closeSubmenu = (depth: number) => {
    if (depth <= 0) return;
    const parent = nav.levels[depth - 1]?.index ?? -1;
    update((current) => ({
      ...current,
      levels: current.levels.slice(0, depth - 1),
      active: current.active.slice(0, depth),
    }));
    if (parent >= 0) focusItem(itemRefs.current, depth - 1, parent);
  };

  /** Runs a row's action with the menu already gone, so the action may open its own UI. */
  const run = (item: MenuItem) => {
    hide();
    try {
      item.onClick?.();
    } catch (error) {
      console.error('[navishell] context menu action failed', error);
    }
  };

  const onItemEnter = (depth: number, index: number, item: MenuItem) => {
    clearHoverTimer();
    const open = nav.levels[depth];
    const alreadyOpen = open?.index === index;
    if (open && !alreadyOpen) closeBelow(depth);
    if (item.disabled) return;
    moveTo(depth, index);
    const submenu = item.submenu;
    if (!submenu || submenu.length === 0 || alreadyOpen) return;
    hoverTimer.current = window.setTimeout(
      () => openSubmenu(depth, index, submenu, false),
      SUBMENU_DELAY,
    );
  };

  const onItemClick = (depth: number, index: number, item: MenuItem) => {
    clearHoverTimer();
    // A row carrying a submenu toggles it and never runs anything, even when it is empty.
    if (item.submenu) {
      if (nav.levels[depth]?.index === index) closeBelow(depth);
      else openSubmenu(depth, index, item.submenu, false);
      return;
    }
    run(item);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const items = levels[innermost] ?? [];
    const index = nav.active[innermost] ?? -1;
    const item = index >= 0 ? items[index] : undefined;
    const claim = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    switch (event.key) {
      case 'ArrowDown':
        claim();
        moveTo(innermost, stepIndex(items, index, 1));
        return;
      case 'ArrowUp':
        claim();
        moveTo(innermost, stepIndex(items, index, -1));
        return;
      case 'Home':
        claim();
        moveTo(innermost, stepIndex(items, -1, 1));
        return;
      case 'End':
        claim();
        moveTo(innermost, stepIndex(items, items.length, -1));
        return;
      case 'ArrowRight':
        if (!item?.submenu?.length) return;
        claim();
        openSubmenu(innermost, index, item.submenu, true);
        return;
      case 'ArrowLeft':
        if (innermost <= 0) return;
        claim();
        closeSubmenu(innermost);
        return;
      case 'Escape':
        claim();
        if (innermost > 0) closeSubmenu(innermost);
        else hide();
        return;
      case 'Enter':
      case ' ':
        if (!item) return;
        claim();
        if (item.submenu) openSubmenu(innermost, index, item.submenu, true);
        else run(item);
        return;
      case 'Tab':
        // Tab is not trapped: the menu steps aside and lets focus move on.
        hide();
        return;
      default: {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
        const match = matchIndex(items, index, event.key);
        if (match < 0) return;
        claim();
        moveTo(innermost, match);
      }
    }
  };

  // Keys are taken on the window in the capture phase so the terminal never sees them. The
  // handler reads this render's state, so the listener is re-bound after every render.
  useEffect(() => {
    if (!menu) return;
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!insideMenu(event.target)) hide();
    };
    const onWheel = (event: WheelEvent) => {
      if (!insideMenu(event.target)) hide();
    };
    const onLeave = () => hide();
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('blur', onLeave);
    window.addEventListener('resize', onLeave);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('resize', onLeave);
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    };
  }, [menu, hide]);

  // Focus enters the menu so it is announced, and goes back to the opener on close unless
  // the row's action moved it somewhere else, which has to win.
  useEffect(() => {
    if (!menu) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRefs.current.get(0)?.focus();
    if (menu.position.focusFirst) {
      const first = stepIndex(menu.items, -1, 1);
      if (first >= 0) focusItem(itemRefs.current, 0, first);
    }
    return () => {
      const focused = document.activeElement;
      const moved =
        focused instanceof HTMLElement &&
        focused.isConnected &&
        focused !== document.body &&
        focused.closest('.ns-menu') === null;
      if (!moved && opener?.isConnected) opener.focus();
    };
  }, [menu]);

  // A submenu row opened from the keyboard can only be focused once its panel is placed.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    focusItem(itemRefs.current, target.depth, target.index);
  });

  if (!menu) return null;

  return (
    <>
      {levels.map((items, depth) => {
        const level = depth === 0 ? undefined : nav.levels[depth - 1];
        const anchor: PanelAnchor = level?.anchor ?? {
          kind: 'point',
          x: menu.position.x,
          y: menu.position.y,
        };
        return (
          <MenuPanel
            key={depth}
            items={items}
            depth={depth}
            anchor={anchor}
            activeIndex={nav.active[depth] ?? -1}
            openIndex={nav.levels[depth]?.index ?? -1}
            onPanelRef={(element) => {
              if (element) panelRefs.current.set(depth, element);
              else panelRefs.current.delete(depth);
            }}
            onItemRef={(index, element) => {
              if (element) itemRefs.current.set(itemKey(depth, index), element);
              else itemRefs.current.delete(itemKey(depth, index));
            }}
            onItemEnter={onItemEnter}
            onItemClick={onItemClick}
            onPanelLeave={clearHoverTimer}
          />
        );
      })}
    </>
  );
}

interface MenuPanelProps {
  items: MenuItem[];
  depth: number;
  anchor: PanelAnchor;
  /** Highlighted row, shared by mouse and keyboard; `-1` for none. */
  activeIndex: number;
  /** Row whose submenu is open; `-1` for none. */
  openIndex: number;
  onPanelRef(element: HTMLDivElement | null): void;
  onItemRef(index: number, element: HTMLButtonElement | null): void;
  onItemEnter(depth: number, index: number, item: MenuItem): void;
  onItemClick(depth: number, index: number, item: MenuItem): void;
  onPanelLeave(): void;
}

/** Class list for one row; the highlight is a class so hover and keys cannot both show. */
function itemClassName(item: MenuItem, active: boolean): string {
  let className = 'ns-menu__item';
  if (active) className += ' ns-menu__item--active';
  if (item.danger) className += ' ns-menu__item--danger';
  return className;
}

/** One panel of the menu: the root list, or the submenu of a row in the panel above. */
function MenuPanel({
  items,
  depth,
  anchor,
  activeIndex,
  openIndex,
  onPanelRef,
  onItemRef,
  onItemEnter,
  onItemClick,
  onPanelLeave,
}: MenuPanelProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // The panel is rendered hidden at its anchor, then moved into the viewport once its size
  // is known. Writing the final position straight to the DOM keeps this a one-pass layout
  // instead of a render cascade.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    let left: number;
    let top: number;
    if (anchor.kind === 'point') {
      left = clampEdge(anchor.x, width, window.innerWidth);
      top = clampEdge(anchor.y, height, window.innerHeight);
    } else {
      const right = anchor.panelRight + SUBMENU_GAP;
      // Submenus open to the right of their parent panel and flip over when that overflows.
      left =
        right + width + MARGIN > window.innerWidth
          ? Math.max(MARGIN, anchor.panelLeft - SUBMENU_GAP - width)
          : right;
      top = clampEdge(anchor.itemTop - PANEL_INSET, height, window.innerHeight);
    }
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.visibility = 'visible';
  }, [anchor]);

  return (
    <div
      ref={(element) => {
        ref.current = element;
        onPanelRef(element);
      }}
      className={depth === 0 ? 'ns-menu' : 'ns-menu ns-menu--submenu'}
      role="menu"
      aria-orientation="vertical"
      tabIndex={-1}
      style={{
        left: anchor.kind === 'point' ? anchor.x : 0,
        top: anchor.kind === 'point' ? anchor.y : 0,
        visibility: 'hidden',
      }}
      onMouseLeave={onPanelLeave}
    >
      {items.map((item, index) =>
        item.separator ? (
          <div key={`separator-${index}`} className="ns-menu__separator" role="separator" />
        ) : (
          <button
            key={item.id ?? `${item.label}-${index}`}
            ref={(element) => {
              onItemRef(index, element);
            }}
            type="button"
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            className={itemClassName(item, activeIndex === index)}
            aria-checked={item.checked}
            aria-haspopup={item.submenu ? 'menu' : undefined}
            aria-expanded={item.submenu ? openIndex === index : undefined}
            aria-disabled={item.disabled ? true : undefined}
            disabled={item.disabled}
            tabIndex={-1}
            onClick={() => onItemClick(depth, index, item)}
            onMouseEnter={() => onItemEnter(depth, index, item)}
          >
            <span className="ns-menu__icon" aria-hidden="true">
              <Icon name={item.icon} size={ICON_SIZE} />
            </span>
            <span className="ns-menu__label">{item.label}</span>
            {item.shortcut ? <span className="ns-menu__shortcut">{item.shortcut}</span> : null}
            {item.submenu ? (
              <ChevronRight size={ICON_SIZE} className="ns-menu__arrow" aria-hidden="true" />
            ) : item.checked ? (
              <Check size={12} className="ns-menu__check" aria-hidden="true" />
            ) : null}
          </button>
        ),
      )}
    </div>
  );
}
