/**
 * The view the Extensions panel should show next. A caller (the top bar badge, the status
 * bar, a toast) asks for a view and then opens the panel; the panel takes the request when
 * it mounts, or switches at once when it is already open.
 */

import { create } from 'zustand';

export type ExtensionView = 'marketplace' | 'installed' | 'updates';

interface ExtensionsViewStore {
  requested: ExtensionView | null;
  request(view: ExtensionView): void;
  clear(): void;
}

export const useExtensionsViewStore = create<ExtensionsViewStore>((set) => ({
  requested: null,
  request(view) {
    set({ requested: view });
  },
  clear() {
    set({ requested: null });
  },
}));

/** The pending request, consumed; `null` when nobody asked for a view. */
export function takeRequestedExtensionView(): ExtensionView | null {
  const store = useExtensionsViewStore.getState();
  const { requested } = store;
  if (requested !== null) store.clear();
  return requested;
}
