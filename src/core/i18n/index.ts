/**
 * i18next setup.
 *
 * Host strings live in the `host` namespace (`locales/*.json`). Every plugin gets its
 * own namespace named after its plugin id, filled through `ctx.i18n.addResources`.
 *
 * Only `en` and `zh-CN` are built in. Further UI languages come from language-pack
 * plugins, which call `ctx.i18n.registerLocale` with a host bundle and bundles for other
 * plugins (the VS Code language-pack model); the list of available locales is therefore
 * dynamic, and a locale whose pack is disabled falls back to a built-in one.
 */

import i18next from 'i18next';
import type { Disposable, Locale, LocalePack } from '@navishell/plugin-api';

import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import { getSettings } from '../stores/settings';
import { createEmitter } from '../util/events';

export const HOST_NS = 'host';

export interface LocaleInfo {
  id: Locale;
  /** Native display name, e.g. `日本語`. */
  name: string;
  /** Built into the host (cannot be removed). */
  builtin: boolean;
}

const BUILTIN_LOCALES: readonly LocaleInfo[] = [
  { id: 'en', name: 'English', builtin: true },
  { id: 'zh-CN', name: '简体中文', builtin: true },
];

/** Registered language packs by locale id (built-in locales are never in here). */
const packs = new Map<Locale, LocalePack>();
let available: readonly LocaleInfo[] = BUILTIN_LOCALES;

const localeChanged = createEmitter<Locale>();
const availableChanged = createEmitter<readonly LocaleInfo[]>();

/** Fires after the active locale changed. */
export const onDidChangeLocale = localeChanged.event;
/** Fires after a language pack was registered or removed. */
export const onDidChangeAvailableLocales = availableChanged.event;

/** Stable snapshot of the selectable locales: built-ins first, then packs. */
export function availableLocales(): readonly LocaleInfo[] {
  return available;
}

export function isAvailableLocale(id: string): boolean {
  return available.some((info) => info.id === id);
}

/** Display name of a locale, or the id itself when it is unknown. */
export function localeName(id: Locale): string {
  return available.find((info) => info.id === id)?.name ?? id;
}

function rebuildAvailable(): void {
  available = [
    ...BUILTIN_LOCALES,
    ...[...packs.values()].map((pack) => ({ id: pack.id, name: pack.name, builtin: false })),
  ];
  availableChanged.fire(available);
}

/**
 * Locales to try, in order, when `locale` lacks a string: the pack's declared fallback
 * chain (e.g. `zh-TW` → `zh-CN`) and finally `en`.
 */
export function fallbackChain(locale: Locale): Locale[] {
  const chain: Locale[] = [];
  let next = packs.get(locale)?.fallback;
  while (next && next !== locale && !chain.includes(next)) {
    chain.push(next);
    next = packs.get(next)?.fallback;
  }
  if (!chain.includes('en')) chain.push('en');
  return chain;
}

/** Map an {@link AppSettings.locale} value onto a locale that exists right now. */
export function resolveLocale(setting: 'system' | Locale): Locale {
  if (setting !== 'system' && isAvailableLocale(setting)) return setting;
  return detectSystemLocale();
}

/**
 * The best available locale for the OS language: a pack whose `matches` prefixes (or id)
 * cover the tag wins, then built-in Chinese for any `zh-*`, otherwise English.
 */
export function detectSystemLocale(): Locale {
  const tag = (typeof navigator === 'undefined' ? 'en' : navigator.language).toLowerCase();
  const covers = (prefix: string): boolean => {
    const needle = prefix.toLowerCase();
    return tag === needle || tag.startsWith(`${needle}-`);
  };
  for (const pack of packs.values()) {
    const prefixes = pack.matches?.length ? pack.matches : [pack.id];
    if (prefixes.some(covers)) return pack.id;
  }
  return tag.startsWith('zh') ? 'zh-CN' : 'en';
}

export async function initI18n(locale: Locale): Promise<void> {
  if (i18next.isInitialized) {
    await setLocale(locale);
    return;
  }
  await i18next.init({
    lng: locale,
    // Language packs register at runtime, so there is no `supportedLngs` list and the
    // fallback is computed per language.
    fallbackLng: (code: string) => fallbackChain(code),
    defaultNS: HOST_NS,
    ns: [HOST_NS],
    resources: {
      en: { [HOST_NS]: en },
      'zh-CN': { [HOST_NS]: zhCN },
    },
    interpolation: { escapeValue: false },
  });
  localeChanged.fire(locale);
}

export async function setLocale(locale: Locale): Promise<void> {
  if (currentLocale() === locale) return;
  await i18next.changeLanguage(locale);
  localeChanged.fire(locale);
}

/** The locale whose strings are shown (falls back to a built-in one until a pack loads). */
export function currentLocale(): Locale {
  return i18next.resolvedLanguage ?? i18next.language ?? 'en';
}

/**
 * Re-resolve the settings after the set of locales changed: switch to a pack that just
 * became available (or was selected before it loaded), or away from one that is gone.
 */
async function reapplyLocale(): Promise<void> {
  if (!i18next.isInitialized) return;
  const wanted = resolveLocale(getSettings().locale);
  if (wanted === currentLocale() && i18next.language === wanted) return;
  await i18next.changeLanguage(wanted);
  localeChanged.fire(wanted);
}

/**
 * Register a language pack. A pack for a built-in locale only adds strings (its name is
 * ignored); any other id becomes a selectable UI language until the disposable fires.
 */
export function registerLocalePack(pack: LocalePack): Disposable {
  const builtin = BUILTIN_LOCALES.some((info) => info.id === pack.id);
  if (!builtin) packs.set(pack.id, pack);
  if (pack.host) i18next.addResourceBundle(pack.id, HOST_NS, pack.host, true, true);
  for (const [namespace, resources] of Object.entries(pack.plugins ?? {})) {
    i18next.addResourceBundle(pack.id, namespace, resources, true, true);
  }
  rebuildAvailable();
  void reapplyLocale();

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (packs.get(pack.id) !== pack) return;
      packs.delete(pack.id);
      if (i18next.hasResourceBundle(pack.id, HOST_NS)) {
        i18next.removeResourceBundle(pack.id, HOST_NS);
      }
      for (const namespace of Object.keys(pack.plugins ?? {})) {
        if (i18next.hasResourceBundle(pack.id, namespace)) {
          i18next.removeResourceBundle(pack.id, namespace);
        }
      }
      rebuildAvailable();
      void reapplyLocale();
    },
  };
}

/** Translate a key of the `host` namespace. */
export function t(key: string, options?: Record<string, unknown>): string {
  if (!i18next.isInitialized) return key;
  return String(i18next.t(key, { ns: HOST_NS, defaultValue: key, ...options }));
}

/** Translate a key of a plugin namespace, falling back to the key itself. */
export function translatePlugin(
  namespace: string,
  key: string,
  options?: Record<string, unknown>,
): string {
  if (!i18next.isInitialized) return key;
  return String(i18next.t(key, { ns: namespace, defaultValue: key, ...options }));
}

/** Register (or extend) a plugin namespace bundle. */
export function addPluginResources(
  namespace: string,
  locale: Locale,
  resources: Record<string, string>,
): void {
  i18next.addResourceBundle(locale, namespace, resources, true, true);
}

export function removePluginResources(namespace: string): void {
  for (const { id } of available) {
    if (i18next.hasResourceBundle(id, namespace)) {
      i18next.removeResourceBundle(id, namespace);
    }
  }
}
