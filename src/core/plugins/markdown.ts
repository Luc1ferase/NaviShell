/**
 * Markdown to safe HTML for the Extensions panel (a plugin's README and changelog).
 *
 * The source is third-party text fetched from the internet and rendered inside the app's
 * own document, so the output is sanitized hard: no scripts, styles, forms, frames, SVG or
 * event handlers, and every link or image must be http(s) (or mailto for links). Relative
 * links and images are resolved against the document's base URL, so a README that refers
 * to `docs/panel.png` next to it keeps working. In-page anchors are dropped with the `id`
 * attributes they would need.
 *
 * Clicks on links are not handled here: the panel intercepts them and opens http(s) links
 * in the system browser.
 */

import DOMPurify from 'dompurify';
import { marked } from 'marked';

const FORBID_TAGS = [
  'style',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'iframe',
  'frame',
  'object',
  'embed',
  'svg',
  'math',
  'video',
  'audio',
  'source',
  'track',
];

const FORBID_ATTR = ['style', 'id', 'name', 'srcset', 'sizes', 'ping', 'target', 'tabindex'];

const ALLOWED_URI = /^(?:https?:|mailto:)/i;

/** Attributes whose value is a URL that may be relative in the source. */
const URL_ATTRIBUTES = new Set(['href', 'src']);

let configured = false;

/**
 * One DOMPurify instance is shared; the base URL of the document being rendered is passed
 * through this variable because hooks have no per-call arguments.
 */
let currentBase: string | undefined;

function configure(): void {
  if (configured) return;
  configured = true;
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (!URL_ATTRIBUTES.has(data.attrName)) return;
    const value = data.attrValue.trim();
    // DOMPurify lets `data:` images through regardless of ALLOWED_URI_REGEXP; the panel
    // promises http(s) only, so they go the same way as other schemes.
    if (/^data:/i.test(value)) {
      data.keepAttr = false;
      return;
    }
    if (!currentBase || value === '' || value.startsWith('#')) return;
    try {
      // Relative references become absolute; absolute ones (including other schemes)
      // are left for ALLOWED_URI_REGEXP to judge.
      data.attrValue = new URL(value, currentBase).toString();
    } catch {
      // Not a URL at all; the regexp below rejects it.
    }
  });
}

/**
 * Renders GitHub-flavoured Markdown to sanitized HTML. `baseUrl` is the directory the
 * document lives in (see `documentBaseUrl`), used to resolve relative links and images.
 */
export function renderMarkdown(source: string, baseUrl?: string): string {
  configure();
  const html = marked.parse(source, { gfm: true, breaks: false, async: false });
  currentBase = baseUrl;
  try {
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS,
      FORBID_ATTR,
      ALLOWED_URI_REGEXP: ALLOWED_URI,
      // `<a>` without an href is harmless; `<img>` without a src is dropped by the regexp.
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    });
  } finally {
    currentBase = undefined;
  }
}
