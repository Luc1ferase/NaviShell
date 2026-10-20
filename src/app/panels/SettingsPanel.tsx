import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Blocks,
  Download,
  FolderOpen,
  PackagePlus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { resolveLocalized, type Locale } from '@navishell/plugin-api';

import type { ITheme } from '@xterm/xterm';

import { fallbackChain } from '@/core/i18n';
import { useAvailableLocales, useI18n } from '@/core/i18n/useI18n';
import { call, errorMessage } from '@/core/ipc/client';
import { DEFAULT_PLUGIN_REGISTRY_URL, type FontFamily } from '@/core/ipc/contract';
import { installPlugin, type InstallAttempt } from '@/core/plugins/install';
import { deactivatePlugin, reloadPlugins, setPluginEnabled } from '@/core/plugins/loader';
import { openExtensionsPanel } from '@/core/services/layout';
import {
  checkPluginUpdates,
  usePluginUpdates,
  usePluginUpdatesStore,
} from '@/core/services/pluginUpdates';
import { checkForUpdates, downloadAndInstall, restartApp } from '@/core/services/updater';
import { clearPluginRegistry } from '@/core/stores/marketplace';
import { useSettingsStore } from '@/core/stores/settings';
import { DEFAULT_FONT_STACK, fontFamilyFor, parseFontFamily } from '@/core/terminal/fonts';
import { ansiColors, resolveScheme, schemesOfKind, type SchemeKind } from '@/core/terminal/schemes';
import { usePluginsStore, type PluginEntry } from '@/core/stores/plugins';
import { useUiStore } from '@/core/stores/ui';
import { useUpdaterStore } from '@/core/stores/updater';
import { formatBytes } from '@/core/util/fn';
import { Icon } from '@/app/components/Icon';

/** Project repository shown in the About section. */
const REPO_URL = 'https://github.com/Luc1ferase/NaviShell';

/** A swatch of one terminal palette: prompt-like text on its background plus the 16 ANSI colors. */
function SchemePreview({ theme }: { theme: ITheme }) {
  return (
    <div
      className="ns-scheme-preview"
      style={{ background: theme.background, color: theme.foreground }}
      aria-hidden="true"
    >
      <span>
        <span style={{ color: theme.green }}>user@host</span>:
        <span style={{ color: theme.blue }}>~/src</span>$ git status
      </span>
      <span className="ns-scheme-preview__dots">
        {ansiColors(theme).map((color, index) => (
          <span key={index} className="ns-scheme-preview__dot" style={{ background: color }} />
        ))}
      </span>
    </div>
  );
}

/** Select one of the built-in terminal color schemes for one UI theme slot. */
function SchemeSelect({
  value,
  slot,
  onChange,
}: {
  value: string;
  slot: SchemeKind;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  const scheme = resolveScheme(value, slot);
  return (
    <div className="ns-scheme-field">
      <select
        className="ns-select"
        value={scheme.id}
        onChange={(event) => onChange(event.target.value)}
      >
        {(['dark', 'light'] as const).map((kind) => (
          <optgroup key={kind} label={t(`settings.schemeGroup.${kind}`)}>
            {schemesOfKind(kind).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <SchemePreview theme={scheme.theme} />
    </div>
  );
}

/** Sentinel option values of the font picker; real families use their names. */
const FONT_AUTO = '\u0000auto';
const FONT_CUSTOM = '\u0000custom';
/** Characters that tell monospace fonts apart: look-alike glyphs and ligature candidates. */
const FONT_GLYPH_SAMPLE = '0O 1lI | -> => != <= {} [] () ~';

/**
 * Terminal font picker: the families `fonts_list` found on this machine (monospace by
 * default), an "automatic" entry for the default stack and a "custom" escape hatch that
 * exposes the raw CSS `font-family` list. The choice is previewed below at the terminal size.
 */
function FontFamilyField({
  value,
  fontSize,
  onChange,
}: {
  value: string;
  fontSize: number;
  onChange: (fontFamily: string) => void;
}) {
  const { t } = useI18n();
  /** `null` until the first scan answered (or failed). */
  const [fonts, setFonts] = useState<FontFamily[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [custom, setCustom] = useState(false);

  // Promise callbacks keep the state updates off the effect's synchronous path.
  const load = useCallback(
    (refresh: boolean) =>
      call('fonts_list', { refresh })
        .then(
          (list) => {
            setFonts(list);
            setError(null);
          },
          (err: unknown) => {
            setFonts((previous) => previous ?? []);
            setError(errorMessage(err));
          },
        )
        .finally(() => setRescanning(false)),
    [],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const choice = parseFontFamily(value);
  const mode = custom || choice.kind === 'custom' ? 'custom' : choice.kind;
  const picked = choice.kind === 'family' ? choice.name : null;
  const missing = picked !== null && fonts !== null && !fonts.some((font) => font.name === picked);
  const hasProportional = fonts?.some((font) => !font.monospaced) ?? false;
  const options = (fonts ?? []).filter((font) => showAll || font.monospaced);
  if (picked !== null && !options.some((font) => font.name === picked)) {
    // Keep the current choice selectable even when it is proportional or no longer installed.
    options.push(
      fonts?.find((font) => font.name === picked) ?? { name: picked, monospaced: false },
    );
  }
  const selected =
    mode === 'custom' ? FONT_CUSTOM : mode === 'auto' ? FONT_AUTO : (picked ?? FONT_AUTO);

  const select = (next: string) => {
    if (next === FONT_CUSTOM) {
      setCustom(true);
      return;
    }
    setCustom(false);
    onChange(next === FONT_AUTO ? DEFAULT_FONT_STACK : fontFamilyFor(next));
  };

  return (
    <div className="ns-font-field">
      <div className="ns-font-field__row">
        <select
          className="ns-select"
          value={selected}
          disabled={fonts === null}
          onChange={(event) => select(event.target.value)}
        >
          <option value={FONT_AUTO}>{t('settings.fontAuto')}</option>
          {options.length > 0 ? (
            <optgroup label={t(showAll ? 'settings.fontGroupAll' : 'settings.fontGroupMono')}>
              {options.map((font) => (
                <option key={font.name} value={font.name}>
                  {missing && font.name === picked
                    ? `${font.name} (${t('settings.fontMissing')})`
                    : font.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <option value={FONT_CUSTOM}>{t('settings.fontCustom')}</option>
        </select>
        <button
          type="button"
          className="ns-btn ns-btn--sm"
          title={t('settings.fontRefresh')}
          aria-label={t('settings.fontRefresh')}
          disabled={fonts === null || rescanning}
          onClick={() => {
            setRescanning(true);
            void load(true);
          }}
        >
          <RefreshCw size={14} className={rescanning ? 'ns-spin' : undefined} />
        </button>
      </div>
      {hasProportional ? (
        <label className="ns-check">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(event) => setShowAll(event.target.checked)}
          />
          {t('settings.fontShowAll')}
        </label>
      ) : null}
      {mode === 'custom' ? (
        <>
          <input
            className="ns-input ns-input--mono"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <small className="ns-font-field__note">{t('settings.fontCustomHint')}</small>
        </>
      ) : null}
      {fonts === null ? (
        <small className="ns-font-field__note">{t('settings.fontLoading')}</small>
      ) : null}
      {error ? (
        <small className="ns-font-field__note ns-font-field__note--error">
          {t('settings.fontLoadFailed', { message: error })}
        </small>
      ) : null}
      <div className="ns-font-preview" style={{ fontFamily: value, fontSize }} aria-hidden="true">
        <span>{t('settings.fontPreviewText')}</span>
        <span className="ns-font-preview__glyphs">{FONT_GLYPH_SAMPLE}</span>
      </div>
    </div>
  );
}

const CONTRAST_PRESETS: { value: number; key: string }[] = [
  { value: 1, key: 'settings.minContrast.off' },
  { value: 4.5, key: 'settings.minContrast.aa' },
  { value: 7, key: 'settings.minContrast.aaa' },
];

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="ns-settings__row">
      <span className="ns-settings__row-label">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <span className="ns-settings__control">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

function PluginCard({ entry }: { entry: PluginEntry }) {
  const { t, locale } = useI18n();
  const disabled = useSettingsStore((state) => state.settings.plugins.disabled);
  const confirm = useUiStore((state) => state.confirm);
  const toast = useUiStore((state) => state.toast);
  const [busy, setBusy] = useState(false);
  const enabled = !disabled.includes(entry.id);
  const name = resolveLocalized(entry.manifest.name, locale, fallbackChain(locale)) || entry.id;

  const statusClass =
    entry.status === 'error'
      ? 'ns-badge ns-badge--danger'
      : entry.status === 'active'
        ? 'ns-badge ns-badge--accent'
        : 'ns-badge';

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      await setPluginEnabled(entry.id, next);
    } finally {
      setBusy(false);
    }
  };

  const uninstall = async () => {
    const confirmed = await confirm({
      title: t('plugins.uninstall.title'),
      message: t('plugins.uninstall.message', { name }),
      okLabel: t('plugins.uninstall.ok'),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      // Tear the plugin down before its files disappear, then rediscover what is left.
      if (entry.status === 'active') await deactivatePlugin(entry.id);
      await call('plugins_uninstall', { pluginId: entry.id });
      await reloadPlugins();
      toast(t('plugins.uninstall.done', { name }), 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ns-plugin-card">
      <Icon name={entry.manifest.icon ?? 'Plug'} size={16} />
      <div className="ns-plugin-card__body">
        <div className="ns-plugin-card__name">
          {name}
          <span className={statusClass}>{t(`plugins.status.${entry.status}`)}</span>
        </div>
        <div className="ns-plugin-card__meta">
          {entry.id} · v{entry.manifest.version}
          {entry.manifest.author ? ` · ${entry.manifest.author}` : ''} ·{' '}
          {t(`plugins.source.${entry.source}`)}
        </div>
        {entry.manifest.description ? (
          <div className="ns-plugin-card__desc">
            {resolveLocalized(entry.manifest.description, locale, fallbackChain(locale))}
          </div>
        ) : null}
        {entry.source === 'external' ? (
          <div className="ns-plugin-card__path">{entry.dir}</div>
        ) : null}
        {entry.error ? <div className="ns-plugin-card__error">{entry.error}</div> : null}
      </div>
      <div className="ns-plugin-card__actions">
        <label className="ns-check">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(event) => void toggle(event.target.checked)}
          />
          {t('plugins.enabled')}
        </label>
        {entry.source === 'external' ? (
          <button
            type="button"
            className="ns-btn ns-btn--sm ns-btn--danger"
            disabled={busy}
            onClick={() => void uninstall()}
          >
            <Trash2 size={13} />
            {t('plugins.uninstall.label')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** URL / local-zip install form for external plugins (issue #7). */
function PluginInstaller() {
  const { t } = useI18n();
  const toast = useUiStore((state) => state.toast);
  const [url, setUrl] = useState('');
  const [sha256, setSha256] = useState('');
  const [busy, setBusy] = useState(false);

  /** {@link installPlugin} with the form disabled while it runs. */
  const install = async (attempt: InstallAttempt) => {
    setBusy(true);
    try {
      return await installPlugin(attempt);
    } finally {
      setBusy(false);
    }
  };

  const installFromUrl = async () => {
    const target = url.trim();
    if (!target) return;
    const checksum = sha256.trim();
    const info = await install((replace) =>
      call('plugins_install_from_url', {
        url: target,
        ...(checksum ? { sha256: checksum } : {}),
        ...(replace ? { replace: true } : {}),
      }),
    );
    if (info) {
      setUrl('');
      setSha256('');
    }
  };

  const installFromFile = async () => {
    let path: string | null;
    try {
      // The return type of `open` is conditional on literal option values, which a
      // runtime-built options object cannot express.
      const selection = (await openFileDialog({
        title: t('plugins.install.pickFile'),
        multiple: false,
        directory: false,
        filters: [{ name: t('plugins.install.zipFilter'), extensions: ['zip'] }],
      })) as string | string[] | null;
      path = Array.isArray(selection) ? (selection[0] ?? null) : selection;
    } catch (error) {
      toast(errorMessage(error), 'error');
      return;
    }
    if (!path) return;
    const chosen = path;
    await install((replace) =>
      call('plugins_install_from_file', { path: chosen, ...(replace ? { replace: true } : {}) }),
    );
  };

  return (
    <div className="ns-plugin-install">
      <Row label={t('plugins.install.url')} hint={t('plugins.install.urlHint')}>
        <input
          className="ns-input ns-input--mono"
          spellCheck={false}
          placeholder={t('plugins.install.urlPlaceholder')}
          value={url}
          disabled={busy}
          onChange={(event) => setUrl(event.target.value)}
        />
      </Row>
      <Row label={t('plugins.install.sha256')} hint={t('plugins.install.sha256Hint')}>
        <input
          className="ns-input ns-input--mono"
          spellCheck={false}
          placeholder={t('plugins.install.sha256Placeholder')}
          value={sha256}
          disabled={busy}
          onChange={(event) => setSha256(event.target.value)}
        />
      </Row>
      <div className="ns-plugin-install__actions">
        <button
          type="button"
          className="ns-btn ns-btn--primary"
          disabled={busy || url.trim().length === 0}
          onClick={() => void installFromUrl()}
        >
          <Download size={14} />
          {busy ? t('plugins.install.busy') : t('plugins.install.fromUrl')}
        </button>
        <button
          type="button"
          className="ns-btn"
          disabled={busy}
          onClick={() => void installFromFile()}
        >
          <PackagePlus size={14} />
          {t('plugins.install.fromFile')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marketplace (the list itself is the Extensions panel)
// ---------------------------------------------------------------------------

/** Registry index URL; empty falls back to {@link DEFAULT_PLUGIN_REGISTRY_URL}. */
function RegistryUrlRow() {
  const { t } = useI18n();
  const registryUrl = useSettingsStore((state) => state.settings.plugins.registryUrl);
  const updatePlugins = useSettingsStore((state) => state.updatePlugins);
  const [text, setText] = useState(() => registryUrl ?? '');

  const apply = (value: string) => {
    setText(value);
    const next = value.trim().length > 0 ? value.trim() : null;
    if (next === registryUrl) return;
    updatePlugins({ registryUrl: next });
    // The cached list came from the previous URL.
    clearPluginRegistry();
  };

  return (
    <Row label={t('plugins.market.registryUrl')} hint={t('plugins.market.registryUrlHint')}>
      <span className="ns-marketplace__url">
        <input
          className="ns-input ns-input--mono"
          spellCheck={false}
          placeholder={DEFAULT_PLUGIN_REGISTRY_URL}
          value={text}
          onChange={(event) => apply(event.target.value)}
        />
        <button
          type="button"
          className="ns-btn ns-btn--sm"
          disabled={registryUrl === null && text.length === 0}
          onClick={() => apply('')}
        >
          <RotateCcw size={13} />
          {t('plugins.market.reset')}
        </button>
      </span>
    </Row>
  );
}

/** Background plugin update checks: the two switches, a manual check and its outcome. */
function PluginUpdatesSection() {
  const { t, locale } = useI18n();
  const plugins = useSettingsStore((state) => state.settings.plugins);
  const updatePlugins = useSettingsStore((state) => state.updatePlugins);
  const checking = usePluginUpdatesStore((state) => state.checking);
  const checkedAt = usePluginUpdatesStore((state) => state.checkedAt);
  const error = usePluginUpdatesStore((state) => state.error);
  const updates = usePluginUpdates().length;

  let status: string;
  if (checking) status = t('plugins.updates.checking');
  else if (error) status = error;
  else if (checkedAt === null) status = t('plugins.updates.notChecked');
  else if (updates > 0) status = t('plugins.updates.available', { count: updates });
  else status = t('plugins.updates.upToDate');
  const checked =
    checkedAt === null
      ? undefined
      : t('plugins.updates.lastChecked', {
          time: new Date(checkedAt).toLocaleTimeString(locale, {
            hour: '2-digit',
            minute: '2-digit',
          }),
        });

  return (
    <>
      <Row label={t('plugins.updates.checkUpdates')}>
        <label className="ns-check">
          <input
            type="checkbox"
            checked={plugins.checkUpdates}
            onChange={(event) => updatePlugins({ checkUpdates: event.target.checked })}
          />
          {t('plugins.updates.checkUpdatesHint')}
        </label>
      </Row>
      <Row label={t('plugins.updates.autoUpdate')}>
        <label className="ns-check">
          <input
            type="checkbox"
            checked={plugins.autoUpdate}
            disabled={!plugins.checkUpdates}
            onChange={(event) => updatePlugins({ autoUpdate: event.target.checked })}
          />
          {t('plugins.updates.autoUpdateHint')}
        </label>
      </Row>
      <Row label={t('plugins.updates.title')} hint={checked}>
        <span className="ns-plugin-install__actions">
          <button
            type="button"
            className="ns-btn"
            disabled={checking}
            onClick={() => void checkPluginUpdates({ force: true })}
          >
            <RefreshCw size={14} className={checking ? 'ns-spin' : undefined} />
            {t('plugins.updates.checkNow')}
          </button>
          <span className="ns-marketplace__status">{status}</span>
          {updates > 0 ? (
            <button
              type="button"
              className="ns-link"
              onClick={() => openExtensionsPanel('updates')}
            >
              {t('plugins.updates.view')}
            </button>
          ) : null}
        </span>
      </Row>
    </>
  );
}

/** The marketplace lives in the Extensions panel; only the index URL is configured here. */
function MarketplaceSection() {
  const { t } = useI18n();
  return (
    <div className="ns-marketplace">
      <p className="ns-marketplace__status">{t('plugins.market.moved')}</p>
      <div className="ns-plugin-install__actions">
        <button
          type="button"
          className="ns-btn ns-btn--primary"
          onClick={() => openExtensionsPanel()}
        >
          <Blocks size={14} />
          {t('plugins.market.browse')}
        </button>
      </div>
      <RegistryUrlRow />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

/** Publish dates are RFC 3339; anything else is shown as the server sent it. */
function formatUpdateDate(raw: string | null, locale: Locale): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "Check for updates" plus the announced release, its notes and the download progress. */
function UpdateSection() {
  const { t, locale } = useI18n();
  const status = useUpdaterStore((state) => state.status);
  const version = useUpdaterStore((state) => state.version);
  const date = useUpdaterStore((state) => state.date);
  const body = useUpdaterStore((state) => state.body);
  const downloaded = useUpdaterStore((state) => state.downloaded);
  const contentLength = useUpdaterStore((state) => state.contentLength);
  const error = useUpdaterStore((state) => state.error);
  const update = useUpdaterStore((state) => state.update);

  const busy = status === 'checking' || status === 'downloading';
  const percent =
    contentLength && contentLength > 0
      ? Math.min(100, Math.round((downloaded / contentLength) * 100))
      : null;

  let statusLine: string;
  switch (status) {
    case 'checking':
      statusLine = t('updates.checking');
      break;
    case 'upToDate':
      statusLine = t('updates.upToDate');
      break;
    case 'available':
      statusLine = t('updates.availableVersion', { version: version ?? '' });
      break;
    case 'downloading':
      statusLine =
        percent === null ? t('updates.downloading') : t('updates.downloadingPercent', { percent });
      break;
    case 'ready':
      statusLine = t('updates.ready');
      break;
    case 'error':
      statusLine = error ?? t('updates.checkFailedShort');
      break;
    default:
      statusLine = t('updates.notChecked');
  }

  const released = formatUpdateDate(date, locale);
  const showRelease = status === 'available' || status === 'downloading' || status === 'ready';

  return (
    <>
      <div className="ns-about-row">
        <span>{t('updates.title')}</span>
        <span className="ns-update">
          <button
            type="button"
            className="ns-btn ns-btn--sm"
            disabled={busy}
            onClick={() => void checkForUpdates({ silent: false })}
          >
            <RefreshCw size={13} className={status === 'checking' ? 'ns-spin' : undefined} />
            {t('updates.check')}
          </button>
          <span
            className={
              status === 'error'
                ? 'ns-update__status ns-update__status--error'
                : 'ns-update__status'
            }
          >
            {statusLine}
          </span>
        </span>
      </div>
      {showRelease ? (
        <div className="ns-update-card">
          <div className="ns-update-card__head">
            <strong>{t('updates.newVersion', { version: version ?? '' })}</strong>
            {released ? (
              <span className="ns-update-card__date">
                {t('updates.released', { date: released })}
              </span>
            ) : null}
          </div>
          {body ? <div className="ns-update-notes">{body}</div> : null}
          {status === 'downloading' ? (
            <div className="ns-update-card__progress">
              <div className="ns-progress">
                <div
                  className={
                    percent === null
                      ? 'ns-progress__bar ns-progress__bar--idle'
                      : 'ns-progress__bar'
                  }
                  style={{ width: percent === null ? '100%' : `${percent}%` }}
                />
              </div>
              <span className="ns-update-card__bytes">
                {contentLength
                  ? `${formatBytes(downloaded)} / ${formatBytes(contentLength)}`
                  : formatBytes(downloaded)}
              </span>
            </div>
          ) : null}
          <div className="ns-update-card__actions">
            {status === 'available' && update ? (
              <button
                type="button"
                className="ns-btn ns-btn--primary"
                onClick={() => void downloadAndInstall(update)}
              >
                <Download size={14} />
                {t('updates.download')}
              </button>
            ) : null}
            {status === 'ready' ? (
              <>
                <button
                  type="button"
                  className="ns-btn ns-btn--primary"
                  onClick={() => void restartApp()}
                >
                  <RotateCcw size={14} />
                  {t('updates.restart')}
                </button>
                <span className="ns-update-card__hint">{t('updates.restartHint')}</span>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** One argument per line, so an argument may contain spaces. */
function parseShellArgs(text: string): string[] {
  return text
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * The raw text is kept locally so a trailing newline (or a space between two words)
 * survives while the parsed argv is already persisted.
 */
function LocalShellArgsField() {
  const { t } = useI18n();
  const args = useSettingsStore((state) => state.settings.localShell.args);
  const updateLocalShell = useSettingsStore((state) => state.updateLocalShell);
  const [text, setText] = useState(() => args.join('\n'));

  return (
    <textarea
      className="ns-textarea ns-input--mono"
      rows={3}
      spellCheck={false}
      placeholder={t('settings.localShell.argsPlaceholder')}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        updateLocalShell({ args: parseShellArgs(event.target.value) });
      }}
    />
  );
}

export function SettingsPanel() {
  const { t } = useI18n();
  const locales = useAvailableLocales();
  const settings = useSettingsStore((state) => state.settings);
  const appInfo = useSettingsStore((state) => state.appInfo);
  const update = useSettingsStore((state) => state.update);
  const updateTerminal = useSettingsStore((state) => state.updateTerminal);
  const updateLocalShell = useSettingsStore((state) => state.updateLocalShell);
  const updateUpdates = useSettingsStore((state) => state.updateUpdates);
  const plugins = usePluginsStore((state) => state.entries);
  const toast = useUiStore((state) => state.toast);
  const requestedSection = useUiStore((state) => state.settingsSection);
  const clearSection = useUiStore((state) => state.clearSettingsSection);
  const aboutRef = useRef<HTMLElement>(null);
  const [reloading, setReloading] = useState(false);

  // The update toast asks for the About section, which is usually scrolled out of view.
  useEffect(() => {
    if (requestedSection !== 'about') return;
    aboutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    clearSection();
  }, [requestedSection, clearSection]);

  const openPluginsFolder = async () => {
    if (!appInfo) return;
    try {
      await revealItemInDir(appInfo.paths.pluginsDir);
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const doReload = async () => {
    setReloading(true);
    try {
      await reloadPlugins();
      toast(t('plugins.reloaded'), 'success');
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="ns-panel">
      <div className="ns-panel__body">
        <div className="ns-settings">
          <h2 className="ns-settings__title">{t('settings.title')}</h2>

          <section className="ns-settings__section">
            <h3>{t('settings.general')}</h3>
            <Row label={t('settings.localeLabel')}>
              <select
                className="ns-select ns-settings__control--narrow"
                value={settings.locale}
                onChange={(event) =>
                  update((prev) => ({
                    ...prev,
                    locale: event.target.value as typeof prev.locale,
                  }))
                }
              >
                <option value="system">{t('settings.locale.system')}</option>
                {locales.map((info) => (
                  <option key={info.id} value={info.id}>
                    {info.name}
                  </option>
                ))}
                {settings.locale !== 'system' &&
                !locales.some((info) => info.id === settings.locale) ? (
                  // The chosen language pack is disabled or gone; keep the value visible.
                  <option value={settings.locale}>{settings.locale}</option>
                ) : null}
              </select>
            </Row>
            <Row label={t('settings.themeLabel')}>
              <select
                className="ns-select ns-settings__control--narrow"
                value={settings.theme}
                onChange={(event) =>
                  update((prev) => ({ ...prev, theme: event.target.value as typeof prev.theme }))
                }
              >
                <option value="dark">{t('settings.theme.dark')}</option>
                <option value="light">{t('settings.theme.light')}</option>
                <option value="system">{t('settings.theme.system')}</option>
              </select>
            </Row>
            <Row label={t('settings.closeWithLastTerminal')}>
              <label className="ns-check">
                <input
                  type="checkbox"
                  checked={settings.closeConnectionWithLastTerminal}
                  onChange={(event) =>
                    update((prev) => ({
                      ...prev,
                      closeConnectionWithLastTerminal: event.target.checked,
                    }))
                  }
                />
                {t('settings.closeWithLastTerminalHint')}
              </label>
            </Row>
            <Row label={t('updates.checkOnStartup')}>
              <label className="ns-check">
                <input
                  type="checkbox"
                  checked={settings.updates.checkOnStartup}
                  onChange={(event) => updateUpdates({ checkOnStartup: event.target.checked })}
                />
                {t('updates.checkOnStartupHint')}
              </label>
            </Row>
          </section>

          <section className="ns-settings__section">
            <h3>{t('settings.terminal')}</h3>
            <Row label={t('settings.colorSchemeDark')} hint={t('settings.colorSchemeHint')}>
              <SchemeSelect
                value={settings.terminal.colorScheme.dark}
                slot="dark"
                onChange={(id) =>
                  updateTerminal({ colorScheme: { ...settings.terminal.colorScheme, dark: id } })
                }
              />
            </Row>
            <Row label={t('settings.colorSchemeLight')}>
              <SchemeSelect
                value={settings.terminal.colorScheme.light}
                slot="light"
                onChange={(id) =>
                  updateTerminal({ colorScheme: { ...settings.terminal.colorScheme, light: id } })
                }
              />
            </Row>
            <Row label={t('settings.minContrast')} hint={t('settings.minContrastHint')}>
              <select
                className="ns-select ns-settings__control--narrow"
                value={String(settings.terminal.minimumContrastRatio)}
                onChange={(event) =>
                  updateTerminal({ minimumContrastRatio: Number(event.target.value) || 1 })
                }
              >
                {CONTRAST_PRESETS.map((preset) => (
                  <option key={preset.value} value={String(preset.value)}>
                    {t(preset.key)}
                  </option>
                ))}
                {CONTRAST_PRESETS.every(
                  (preset) => preset.value !== settings.terminal.minimumContrastRatio,
                ) ? (
                  <option value={String(settings.terminal.minimumContrastRatio)}>
                    {settings.terminal.minimumContrastRatio} : 1
                  </option>
                ) : null}
              </select>
            </Row>
            <Row label={t('settings.fontFamily')}>
              <FontFamilyField
                value={settings.terminal.fontFamily}
                fontSize={settings.terminal.fontSize}
                onChange={(fontFamily) => updateTerminal({ fontFamily })}
              />
            </Row>
            <Row label={t('settings.fontSize')}>
              <input
                className="ns-input ns-settings__control--narrow"
                type="number"
                min={8}
                max={32}
                value={settings.terminal.fontSize}
                onChange={(event) => updateTerminal({ fontSize: Number(event.target.value) || 14 })}
              />
            </Row>
            <Row label={t('settings.lineHeight')}>
              <input
                className="ns-input ns-settings__control--narrow"
                type="number"
                min={1}
                max={2.5}
                step={0.05}
                value={settings.terminal.lineHeight}
                onChange={(event) =>
                  updateTerminal({ lineHeight: Number(event.target.value) || 1.2 })
                }
              />
            </Row>
            <Row label={t('settings.cursorStyle')}>
              <select
                className="ns-select ns-settings__control--narrow"
                value={settings.terminal.cursorStyle}
                onChange={(event) =>
                  updateTerminal({
                    cursorStyle: event.target.value as 'block' | 'underline' | 'bar',
                  })
                }
              >
                <option value="block">{t('settings.cursor.block')}</option>
                <option value="underline">{t('settings.cursor.underline')}</option>
                <option value="bar">{t('settings.cursor.bar')}</option>
              </select>
            </Row>
            <Row label={t('settings.cursorBlink')}>
              <label className="ns-check">
                <input
                  type="checkbox"
                  checked={settings.terminal.cursorBlink}
                  onChange={(event) => updateTerminal({ cursorBlink: event.target.checked })}
                />
                {t('settings.cursorBlinkHint')}
              </label>
            </Row>
            <Row label={t('settings.scrollback')}>
              <input
                className="ns-input ns-settings__control--narrow"
                type="number"
                min={100}
                max={200000}
                step={100}
                value={settings.terminal.scrollback}
                onChange={(event) =>
                  updateTerminal({ scrollback: Number(event.target.value) || 5000 })
                }
              />
            </Row>
            <Row label={t('settings.webgl')} hint={t('settings.webglHint')}>
              <label className="ns-check">
                <input
                  type="checkbox"
                  checked={settings.terminal.webgl}
                  onChange={(event) => updateTerminal({ webgl: event.target.checked })}
                />
                {t('settings.webglToggle')}
              </label>
            </Row>
            <Row label={t('settings.termType')} hint="TERM">
              <input
                className="ns-input ns-input--mono ns-settings__control--narrow"
                value={settings.terminal.termType}
                onChange={(event) => updateTerminal({ termType: event.target.value })}
              />
            </Row>
          </section>

          <section className="ns-settings__section">
            <h3>{t('settings.localShell.title')}</h3>
            <Row
              label={t('settings.localShell.program')}
              hint={t('settings.localShell.programHint')}
            >
              <input
                className="ns-input ns-input--mono"
                placeholder={t('settings.localShell.programPlaceholder')}
                value={settings.localShell.program ?? ''}
                onChange={(event) =>
                  updateLocalShell({ program: event.target.value.trim() || null })
                }
              />
            </Row>
            <Row label={t('settings.localShell.args')} hint={t('settings.localShell.argsHint')}>
              <LocalShellArgsField />
            </Row>
          </section>

          <section className="ns-settings__section">
            <h3>{t('settings.plugins')}</h3>
            <div className="ns-panel__toolbar" style={{ padding: '0 0 8px', border: 0 }}>
              <button
                type="button"
                className="ns-btn"
                disabled={!appInfo}
                onClick={() => void openPluginsFolder()}
              >
                <FolderOpen size={14} />
                {t('plugins.openFolder')}
              </button>
              <button
                type="button"
                className="ns-btn"
                disabled={reloading}
                onClick={() => void doReload()}
              >
                <RefreshCw size={14} />
                {t('plugins.reload')}
              </button>
            </div>
            {appInfo ? <div className="ns-mono">{appInfo.paths.pluginsDir}</div> : null}

            <h4 className="ns-settings__subtitle">{t('plugins.market.title')}</h4>
            <MarketplaceSection />
            <PluginUpdatesSection />

            <h4 className="ns-settings__subtitle">{t('plugins.install.title')}</h4>
            <PluginInstaller />

            <h4 className="ns-settings__subtitle">{t('plugins.installed')}</h4>
            {plugins.length === 0 ? (
              <div className="ns-empty">{t('plugins.none')}</div>
            ) : (
              plugins.map((entry) => <PluginCard key={entry.id} entry={entry} />)
            )}
          </section>

          <section className="ns-settings__section" ref={aboutRef}>
            <h3>{t('settings.about')}</h3>
            <div className="ns-about-row">
              <span>{t('about.version')}</span>
              <span>{appInfo?.version ?? '—'}</span>
            </div>
            <UpdateSection />
            <div className="ns-about-row">
              <span>{t('about.platform')}</span>
              <span>{appInfo ? `${appInfo.platform} · ${appInfo.arch}` : '—'}</span>
            </div>
            <div className="ns-about-row">
              <span>{t('about.appData')}</span>
              <span className="ns-mono">{appInfo?.paths.appData ?? '—'}</span>
            </div>
            <div className="ns-about-row">
              <span>{t('about.logs')}</span>
              <span className="ns-mono">{appInfo?.paths.logsDir ?? '—'}</span>
            </div>
            <div className="ns-about-row">
              <span>{t('about.repository')}</span>
              <button
                type="button"
                className="ns-link"
                onClick={() => {
                  void openUrl(REPO_URL).catch((error) => toast(errorMessage(error), 'error'));
                }}
              >
                {REPO_URL}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
