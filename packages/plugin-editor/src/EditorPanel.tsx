/**
 * One editor tab: a CodeMirror 6 view over a remote text file, loaded and saved through
 * the connection's SFTP client. The host opens one instance per file (see index.ts) and
 * hands the file in `params`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { RotateCw, Save, WrapText } from 'lucide-react';
import type {
  ConnectionInfo,
  JsonValue,
  PanelApi,
  PanelProps,
  PluginContext,
} from '@navishell/plugin-api';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Text } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import { languageExtension, languageFor } from './languages';
import {
  byteLength,
  detectLineEnding,
  errorMessage,
  formatSize,
  guessIndent,
  withLineEnding,
  type IndentGuess,
  type LineEnding,
} from './text';

/** Largest file the editor loads; the Rust side refuses anything bigger. */
const MAX_BYTES = 8 * 1024 * 1024;

interface FileRef {
  connectionId: string;
  path: string;
  name: string;
}

/** What the saved copy on the server looked like when it was last read or written. */
interface Baseline {
  doc: Text;
  /** Unix epoch seconds, or null when the server did not say. */
  mtime: number | null;
  size: number;
}

interface FileInfo {
  language: string;
  eol: LineEnding;
  indent: IndentGuess;
  size: number;
}

interface Position {
  line: number;
  col: number;
  selected: number;
}

type Status = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

function stringField(params: JsonValue | undefined, key: string): string | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return null;
  const value = (params as Record<string, JsonValue | undefined>)[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function positionOf(state: EditorState): Position {
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  let selected = 0;
  for (const range of state.selection.ranges) selected += range.to - range.from;
  return { line: line.number, col: main.head - line.from + 1, selected };
}

/**
 * Colours and chrome come from the host's CSS variables, so the editor follows the app
 * theme without being rebuilt; token colours live in styles.css.
 */
const theme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--ns-bg)',
    color: 'var(--ns-fg)',
    fontSize: '13px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--ns-font-mono)', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--ns-fg)', padding: '6px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ns-fg)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
    { backgroundColor: 'var(--ns-bg-selected)' },
  '.cm-activeLine': { backgroundColor: 'var(--ns-bg-hover)' },
  '.cm-gutters': {
    backgroundColor: 'var(--ns-bg)',
    color: 'var(--ns-fg-subtle)',
    border: 'none',
    borderRight: '1px solid var(--ns-border)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--ns-bg-hover)', color: 'var(--ns-fg-muted)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '3.5em' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--ns-bg-elevated)',
    border: '1px solid var(--ns-border)',
    color: 'var(--ns-fg-muted)',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--ns-accent-soft)',
    outline: '1px solid var(--ns-accent)',
  },
  '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: 'var(--ns-danger-soft)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--ns-accent-soft)' },
  '.cm-searchMatch': {
    backgroundColor: 'var(--ns-warning-soft)',
    outline: '1px solid var(--ns-warning)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--ns-warning)',
    color: 'var(--ns-fg-inverted)',
  },
  '.cm-panels': { backgroundColor: 'var(--ns-bg-elevated)', color: 'var(--ns-fg)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--ns-border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--ns-border)' },
  '.cm-panel.cm-search': {
    fontFamily: 'var(--ns-font-ui)',
    fontSize: 'var(--ns-font-size-sm)',
    padding: '4px 8px',
  },
  '.cm-panel.cm-search label': { color: 'var(--ns-fg-muted)' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--ns-fg-muted)' },
  '.cm-textfield': {
    backgroundColor: 'var(--ns-bg-inset)',
    color: 'var(--ns-fg)',
    border: '1px solid var(--ns-border)',
    borderRadius: 'var(--ns-radius-sm)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--ns-bg)',
    color: 'var(--ns-fg)',
    border: '1px solid var(--ns-border-strong)',
    borderRadius: 'var(--ns-radius-sm)',
  },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--ns-bg-active)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--ns-bg-elevated)',
    border: '1px solid var(--ns-border)',
    color: 'var(--ns-fg)',
  },
});

/**
 * Validates `params` and keys the real editor on the file, so another file in the same
 * panel (never the case today, but allowed by the host) starts from a fresh state.
 */
export function EditorPanel({ params, ctx, api }: PanelProps): JSX.Element {
  const connectionId = stringField(params, 'connectionId');
  const path = stringField(params, 'path');
  const givenName = stringField(params, 'name');
  if (!connectionId || !path) {
    return (
      <div className="ns-editor">
        <div className="ns-editor-state">
          <strong>{ctx.i18n.t('state.invalid')}</strong>
          <button type="button" className="ns-editor-button" onClick={() => api.close()}>
            {ctx.i18n.t('state.close')}
          </button>
        </div>
      </div>
    );
  }
  const name = givenName ?? (path.slice(path.lastIndexOf('/') + 1) || path);
  return (
    <FileEditor
      key={`${connectionId}\u0000${path}`}
      connectionId={connectionId}
      path={path}
      name={name}
      ctx={ctx}
      api={api}
    />
  );
}

interface FileEditorProps extends FileRef {
  ctx: PluginContext;
  api: PanelApi;
}

function FileEditor({ connectionId, path, name, ctx, api }: FileEditorProps): JSX.Element {
  const t = useCallback(
    (key: string, options?: Record<string, unknown>) => ctx.i18n.t(key, options),
    [ctx],
  );
  const file = useMemo<FileRef>(() => ({ connectionId, path, name }), [connectionId, path, name]);

  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [position, setPosition] = useState<Position>({ line: 1, col: 1, selected: 0 });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(() =>
    ctx.connections.list().some((connection) => connection.id === connectionId),
  );
  const [wrap, setWrap] = useState(false);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const baselineRef = useRef<Baseline | null>(null);
  const eolRef = useRef<LineEnding>('lf');
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const connectedRef = useRef(connected);
  const wrapRef = useRef(false);
  const saveRef = useRef<() => void>(() => {});
  const wrapCompartment = useMemo(() => new Compartment(), []);

  const markDirty = useCallback((state: EditorState) => {
    const baseline = baselineRef.current;
    const next = baseline ? !state.doc.eq(baseline.doc) : false;
    if (next !== dirtyRef.current) {
      dirtyRef.current = next;
      setDirty(next);
    }
  }, []);

  // Load the file and build the editor over it.
  useEffect(() => {
    let cancelled = false;

    const mount = (raw: string, mtime: number | null, size: number) => {
      const parent = hostRef.current;
      if (!parent) return;
      const language = languageFor(file.name);
      const indent = guessIndent(raw);
      const eol = detectLineEnding(raw);
      eolRef.current = eol;
      const state = EditorState.create({
        doc: raw,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          syntaxHighlighting(classHighlighter),
          indentUnit.of(indent.kind === 'tabs' ? '\t' : ' '.repeat(indent.size)),
          EditorState.tabSize.of(indent.size),
          languageExtension(language),
          wrapCompartment.of(wrapRef.current ? EditorView.lineWrapping : []),
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                saveRef.current();
                return true;
              },
            },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) markDirty(update.state);
            if (update.docChanged || update.selectionSet) setPosition(positionOf(update.state));
          }),
          EditorView.contentAttributes.of({
            spellcheck: 'false',
            autocorrect: 'off',
            autocapitalize: 'off',
          }),
          theme,
        ],
      });
      viewRef.current?.destroy();
      viewRef.current = new EditorView({ state, parent });
      baselineRef.current = { doc: state.doc, mtime, size };
      setInfo({ language: language.label, eol, indent, size });
      setPosition(positionOf(state));
      setStatus({ kind: 'ready' });
    };

    void (async () => {
      try {
        const sftp = ctx.connections.sftp(file.connectionId);
        const stat = await sftp.stat(file.path).catch(() => null);
        const raw = await sftp.readText(file.path, { maxBytes: MAX_BYTES });
        if (cancelled) return;
        mount(raw, stat?.mtime ?? null, stat?.size ?? byteLength(raw));
      } catch (error) {
        if (!cancelled) setStatus({ kind: 'error', message: errorMessage(error) });
      }
    })();

    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
      baselineRef.current = null;
    };
  }, [ctx, file, markDirty, wrapCompartment]);

  // The editor gets the focus once it is on screen, and whenever its tab is activated.
  useEffect(() => {
    if (status.kind === 'ready') viewRef.current?.focus();
  }, [status]);
  useEffect(() => {
    const subscription = api.onDidActiveChange((active) => {
      if (active) viewRef.current?.focus();
    });
    return () => subscription.dispose();
  }, [api]);

  // Tab title with a dirty marker.
  useEffect(() => {
    api.setTitle(dirty ? `${file.name} ●` : file.name);
  }, [api, file, dirty]);

  // Saving needs the connection the file came from; once it is gone, only editing is left.
  useEffect(() => {
    const subscription = ctx.connections.onDidChange((connections: ConnectionInfo[]) => {
      const alive = connections.some((connection) => connection.id === file.connectionId);
      connectedRef.current = alive;
      setConnected(alive);
    });
    return () => subscription.dispose();
  }, [ctx, file]);

  // Line wrapping is a per-user preference, remembered across files.
  const applyWrap = useCallback(
    (next: boolean) => {
      wrapRef.current = next;
      setWrap(next);
      viewRef.current?.dispatch({
        effects: wrapCompartment.reconfigure(next ? EditorView.lineWrapping : []),
      });
    },
    [wrapCompartment],
  );
  useEffect(() => {
    void ctx.storage.get('wrap').then((value) => {
      if (value === true) applyWrap(true);
    });
  }, [ctx, applyWrap]);
  const toggleWrap = useCallback(() => {
    const next = !wrapRef.current;
    applyWrap(next);
    void ctx.storage.set('wrap', next);
  }, [ctx, applyWrap]);

  const save = useCallback(async (): Promise<void> => {
    const view = viewRef.current;
    const baseline = baselineRef.current;
    if (!view || !baseline || savingRef.current || !connectedRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const sftp = ctx.connections.sftp(file.connectionId);
      const before = await sftp.stat(file.path).catch(() => null);
      const changedOnServer =
        before !== null &&
        baseline.mtime !== null &&
        before.mtime !== null &&
        before.mtime !== baseline.mtime;
      if (changedOnServer) {
        const ok = await ctx.ui.confirm({
          title: t('confirm.overwrite.title', { name: file.name }),
          message: t('confirm.overwrite.message'),
          okLabel: t('confirm.overwrite.ok'),
          danger: true,
        });
        if (!ok) return;
      }
      const doc = view.state.doc;
      const text = withLineEnding(doc.toString(), eolRef.current);
      await sftp.writeText(file.path, text);
      const after = await sftp.stat(file.path).catch(() => null);
      const size = after?.size ?? byteLength(text);
      baselineRef.current = { doc, mtime: after?.mtime ?? before?.mtime ?? null, size };
      setInfo((current) => (current ? { ...current, size } : current));
      // Typing during the write keeps the file dirty.
      markDirty(view.state);
      ctx.ui.toast(t('toast.saved', { name: file.name }), 'success');
      if (ctx.commands.has('navishell.sftp:refresh')) {
        ctx.commands
          .execute('navishell.sftp:refresh')
          .catch((error: unknown) => ctx.log.debug('file manager refresh failed', error));
      }
    } catch (error) {
      ctx.ui.toast(
        t('toast.saveFailed', { name: file.name, message: errorMessage(error) }),
        'error',
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [ctx, file, markDirty, t]);
  useEffect(() => {
    saveRef.current = () => void save();
  }, [save]);

  const reload = useCallback(async (): Promise<void> => {
    const view = viewRef.current;
    if (!view || savingRef.current) return;
    if (dirtyRef.current) {
      const ok = await ctx.ui.confirm({
        title: t('confirm.reload.title', { name: file.name }),
        message: t('confirm.reload.message'),
        okLabel: t('confirm.reload.ok'),
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const sftp = ctx.connections.sftp(file.connectionId);
      const stat = await sftp.stat(file.path).catch(() => null);
      const raw = await sftp.readText(file.path, { maxBytes: MAX_BYTES });
      const current = viewRef.current;
      if (!current) return;
      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: raw } });
      const eol = detectLineEnding(raw);
      eolRef.current = eol;
      const size = stat?.size ?? byteLength(raw);
      baselineRef.current = { doc: current.state.doc, mtime: stat?.mtime ?? null, size };
      setInfo((previous) => (previous ? { ...previous, eol, size } : previous));
      markDirty(current.state);
    } catch (error) {
      ctx.ui.toast(errorMessage(error), 'error');
    }
  }, [ctx, file, markDirty, t]);

  // Closing the tab with unsaved changes asks first.
  useEffect(() => {
    const subscription = api.onWillClose(() => {
      if (!dirtyRef.current) return true;
      return ctx.ui.confirm({
        title: t('confirm.discard.title', { name: file.name }),
        message: t('confirm.discard.message'),
        okLabel: t('confirm.discard.ok'),
        danger: true,
      });
    });
    return () => subscription.dispose();
  }, [api, ctx, file, t]);

  const ready = status.kind === 'ready';
  return (
    <div className="ns-editor">
      {ready && !connected ? (
        <div className="ns-editor-banner" role="status">
          {t('state.disconnected')}
        </div>
      ) : null}
      <div ref={hostRef} className={`ns-editor-view${ready ? '' : ' ns-editor-view--hidden'}`} />
      {status.kind === 'loading' ? (
        <div className="ns-editor-state">{t('state.loading', { name: file.name })}</div>
      ) : null}
      {status.kind === 'error' ? (
        <div className="ns-editor-state">
          <strong>{t('state.error', { name: file.name })}</strong>
          <span className="ns-editor-path">{file.path}</span>
          <span>{status.message}</span>
          <button type="button" className="ns-editor-button" onClick={() => api.close()}>
            {t('state.close')}
          </button>
        </div>
      ) : null}
      {ready && info ? (
        <div className="ns-editor-bar">
          <button
            type="button"
            className="ns-editor-tool"
            title={t('toolbar.save')}
            aria-label={t('toolbar.save')}
            disabled={!dirty || saving || !connected}
            onClick={() => void save()}
          >
            <Save size={14} />
          </button>
          <button
            type="button"
            className="ns-editor-tool"
            title={t('toolbar.reload')}
            aria-label={t('toolbar.reload')}
            disabled={saving || !connected}
            onClick={() => void reload()}
          >
            <RotateCw size={14} />
          </button>
          <button
            type="button"
            className={`ns-editor-tool${wrap ? ' ns-editor-tool--on' : ''}`}
            title={t('toolbar.wrap')}
            aria-label={t('toolbar.wrap')}
            aria-pressed={wrap}
            onClick={toggleWrap}
          >
            <WrapText size={14} />
          </button>
          <span className="ns-editor-spacer" />
          <span>{info.language}</span>
          <span>{t('status.position', { line: position.line, col: position.col })}</span>
          {position.selected > 0 ? (
            <span>{t('status.selected', { count: position.selected })}</span>
          ) : null}
          <span>{info.eol === 'crlf' ? 'CRLF' : 'LF'}</span>
          <span>
            {info.indent.kind === 'tabs'
              ? t('status.tabs', { size: info.indent.size })
              : t('status.spaces', { size: info.indent.size })}
          </span>
          <span>{formatSize(info.size)}</span>
        </div>
      ) : null}
    </div>
  );
}
