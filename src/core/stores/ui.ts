import { create } from 'zustand';
import type {
  ConfirmOptions,
  MenuItem,
  PromptOptions,
  ServerRecord,
  ToastKind,
} from '@navishell/plugin-api';

import type { AuthPromptItem, CredentialKind } from '../ipc/contract';
import { uuid } from '../util/fn';

export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
}

export interface PasswordRequest {
  title: string;
  message?: string;
  /** Selects the labels: an account password or a private-key passphrase. */
  kind?: CredentialKind;
  /** Pre-ticked state of the "save to keychain" checkbox. */
  offerSave: boolean;
}

export interface PasswordResult {
  password: string;
  savePassword: boolean;
}

/** One keyboard-interactive round (`auth:prompt`), waiting for `ssh_auth_respond`. */
export interface AuthPromptRequest {
  title: string;
  /** Server-supplied heading; may be empty. */
  name: string;
  /** Server-supplied explanation; may be empty. */
  instructions: string;
  prompts: AuthPromptItem[];
}

export interface HostKeyRequest {
  title: string;
  message: string;
  host: string;
  fingerprint: string;
  expectedFingerprint?: string;
  okLabel: string;
  cancelLabel: string;
}

export type DialogRequest =
  | { id: string; kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { id: string; kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }
  | {
      id: string;
      kind: 'password';
      options: PasswordRequest;
      resolve: (value: PasswordResult | null) => void;
    }
  | {
      id: string;
      kind: 'hostKey';
      options: HostKeyRequest;
      resolve: (value: boolean) => void;
    }
  | {
      id: string;
      kind: 'authPrompt';
      options: AuthPromptRequest;
      resolve: (value: string[] | null) => void;
    };

export interface ContextMenuState {
  items: MenuItem[];
  position: { x: number; y: number };
}

export interface ServerFormState {
  /** `undefined` => create a new server. */
  server?: ServerRecord;
  /** Prefill for "duplicate". */
  draft?: Partial<ServerRecord>;
}

export interface UiStore {
  toasts: Toast[];
  dialogs: DialogRequest[];
  contextMenu: ContextMenuState | null;
  serverForm: ServerFormState | null;

  toast(message: string, kind?: ToastKind): void;
  dismissToast(id: string): void;

  confirm(options: ConfirmOptions): Promise<boolean>;
  prompt(options: PromptOptions): Promise<string | null>;
  askPassword(options: PasswordRequest): Promise<PasswordResult | null>;
  askHostKey(options: HostKeyRequest): Promise<boolean>;
  /** Resolves to one answer per prompt, or `null` when the user cancelled. */
  askAuthPrompt(options: AuthPromptRequest): Promise<string[] | null>;
  /** Resolve (and remove) the front dialog. */
  settleDialog(id: string, value: unknown): void;

  showContextMenu(items: MenuItem[], position: { x: number; y: number }): void;
  hideContextMenu(): void;

  openServerForm(state?: ServerFormState): void;
  closeServerForm(): void;
}

const TOAST_TIMEOUT = 5000;

export const useUiStore = create<UiStore>((set, get) => ({
  toasts: [],
  dialogs: [],
  contextMenu: null,
  serverForm: null,

  toast(message, kind = 'info') {
    const id = uuid();
    set({ toasts: [...get().toasts, { id, message, kind }] });
    setTimeout(() => get().dismissToast(id), TOAST_TIMEOUT);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
  },

  confirm(options) {
    return new Promise<boolean>((resolve) => {
      set({ dialogs: [...get().dialogs, { id: uuid(), kind: 'confirm', options, resolve }] });
    });
  },
  prompt(options) {
    return new Promise<string | null>((resolve) => {
      set({ dialogs: [...get().dialogs, { id: uuid(), kind: 'prompt', options, resolve }] });
    });
  },
  askPassword(options) {
    return new Promise<PasswordResult | null>((resolve) => {
      set({ dialogs: [...get().dialogs, { id: uuid(), kind: 'password', options, resolve }] });
    });
  },
  askHostKey(options) {
    return new Promise<boolean>((resolve) => {
      set({ dialogs: [...get().dialogs, { id: uuid(), kind: 'hostKey', options, resolve }] });
    });
  },
  askAuthPrompt(options) {
    return new Promise<string[] | null>((resolve) => {
      set({ dialogs: [...get().dialogs, { id: uuid(), kind: 'authPrompt', options, resolve }] });
    });
  },
  settleDialog(id, value) {
    const dialog = get().dialogs.find((d) => d.id === id);
    set({ dialogs: get().dialogs.filter((d) => d.id !== id) });
    if (!dialog) return;
    switch (dialog.kind) {
      case 'confirm':
        dialog.resolve(value === true);
        break;
      case 'prompt':
        dialog.resolve(typeof value === 'string' ? value : null);
        break;
      case 'password':
        dialog.resolve(value && typeof value === 'object' ? (value as PasswordResult) : null);
        break;
      case 'hostKey':
        dialog.resolve(value === true);
        break;
      case 'authPrompt':
        dialog.resolve(
          Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null,
        );
        break;
    }
  },

  showContextMenu(items, position) {
    set({ contextMenu: { items, position } });
  },
  hideContextMenu() {
    set({ contextMenu: null });
  },

  openServerForm(state) {
    set({ serverForm: state ?? {} });
  },
  closeServerForm() {
    set({ serverForm: null });
  },
}));

export function toast(message: string, kind?: ToastKind): void {
  useUiStore.getState().toast(message, kind);
}
