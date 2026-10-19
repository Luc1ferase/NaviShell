/**
 * i18next setup.
 *
 * Host strings live in the `host` namespace (`locales/*.json`). Every plugin gets its
 * own namespace named after its plugin id, filled through `ctx.i18n.addResources`.
 */

import i18next from 'i18next';
import type { Locale } from '@navishell/plugin-api';

import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import { createEmitter } from '../util/events';

export const HOST_NS = 'host';
export const SUPPORTED_LOCALES: Locale[] = ['en', 'zh-CN'];

const localeChanged = createEmitter<Locale>();

/** Fires after the active locale changed. */
export const onDidChangeLocale = localeChanged.event;

/** Map an {@link AppSettings.locale} value onto a concrete locale. */
export function resolveLocale(setting: 'system' | Locale): Locale {
  if (setting !== 'system') return setting;
  return detectSystemLocale();
}

export function detectSystemLocale(): Locale {
  const tag = typeof navigator === 'undefined' ? 'en' : navigator.language;
  return tag.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export async function initI18n(locale: Locale): Promise<void> {
  if (i18next.isInitialized) {
    await setLocale(locale);
    return;
  }
  await i18next.init({
    lng: locale,
    fallbackLng: 'en',
    defaultNS: HOST_NS,
    ns: [HOST_NS],
    supportedLngs: SUPPORTED_LOCALES,
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

export function currentLocale(): Locale {
  const lng = i18next.resolvedLanguage ?? i18next.language ?? 'en';
  return lng === 'zh-CN' ? 'zh-CN' : 'en';
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
  for (const locale of SUPPORTED_LOCALES) {
    if (i18next.hasResourceBundle(locale, namespace)) {
      i18next.removeResourceBundle(locale, namespace);
    }
  }
}
