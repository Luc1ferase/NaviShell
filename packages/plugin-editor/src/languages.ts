/**
 * Picks a CodeMirror language for a file name: Lezer grammars where they exist, legacy
 * stream modes for the rest, plain text for anything unknown. Extensions are built once
 * and shared between editors; a `LanguageSupport` is immutable, so that is safe.
 */

import { StreamLanguage, type LanguageSupport, type StreamParser } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { css } from '@codemirror/lang-css';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { fortran } from '@codemirror/legacy-modes/mode/fortran';
import { julia } from '@codemirror/legacy-modes/mode/julia';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf';
import { r } from '@codemirror/legacy-modes/mode/r';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { verilog } from '@codemirror/legacy-modes/mode/verilog';

export interface EditorLanguage {
  /** Shown in the status bar. */
  label: string;
  /** Builds the extension; see {@link languageExtension} for the cached form. */
  load: () => Extension;
}

const PLAIN: EditorLanguage = { label: 'Plain text', load: () => [] };

function modern(label: string, support: () => LanguageSupport): EditorLanguage {
  return { label, load: support };
}

function legacy(label: string, mode: StreamParser<unknown>): EditorLanguage {
  return { label, load: () => StreamLanguage.define(mode) };
}

const LANGUAGES = {
  python: modern('Python', () => python()),
  javascript: modern('JavaScript', () => javascript()),
  jsx: modern('JSX', () => javascript({ jsx: true })),
  typescript: modern('TypeScript', () => javascript({ typescript: true })),
  tsx: modern('TSX', () => javascript({ jsx: true, typescript: true })),
  json: modern('JSON', () => json()),
  yaml: modern('YAML', () => yaml()),
  markdown: modern('Markdown', () => markdown()),
  cpp: modern('C/C++', () => cpp()),
  rust: modern('Rust', () => rust()),
  go: modern('Go', () => go()),
  html: modern('HTML', () => html()),
  css: modern('CSS', () => css()),
  xml: modern('XML', () => xml()),
  sql: modern('SQL', () => sql()),
  java: modern('Java', () => java()),
  shell: legacy('Shell', shell),
  toml: legacy('TOML', toml),
  dockerfile: legacy('Dockerfile', dockerFile),
  lua: legacy('Lua', lua),
  properties: legacy('Properties', properties),
  nginx: legacy('Nginx', nginx),
  cmake: legacy('CMake', cmake),
  powershell: legacy('PowerShell', powerShell),
  perl: legacy('Perl', perl),
  ruby: legacy('Ruby', ruby),
  r: legacy('R', r),
  julia: legacy('Julia', julia),
  swift: legacy('Swift', swift),
  diff: legacy('Diff', diff),
  protobuf: legacy('Protocol Buffers', protobuf),
  verilog: legacy('Verilog', verilog),
  fortran: legacy('Fortran', fortran),
} satisfies Record<string, EditorLanguage>;

type LanguageId = keyof typeof LANGUAGES;

/** Whole file names (lower-case) that say more than their extension would. */
const BY_NAME: Record<string, LanguageId> = {
  '.bashrc': 'shell',
  '.bash_profile': 'shell',
  '.bash_aliases': 'shell',
  '.bash_logout': 'shell',
  '.profile': 'shell',
  '.zshrc': 'shell',
  '.zshenv': 'shell',
  '.zprofile': 'shell',
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  '.gitconfig': 'properties',
  '.gitmodules': 'properties',
  '.editorconfig': 'properties',
  '.npmrc': 'properties',
  'nginx.conf': 'nginx',
  'cmakelists.txt': 'cmake',
  'cargo.lock': 'toml',
  'poetry.lock': 'toml',
  'uv.lock': 'toml',
  pipfile: 'toml',
};

const BY_EXTENSION: Record<string, LanguageId> = {
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  ipynb: 'json',
  webmanifest: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  c: 'cpp',
  h: 'cpp',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cu: 'cpp',
  cuh: 'cpp',
  ino: 'cpp',
  rs: 'rust',
  go: 'go',
  html: 'html',
  htm: 'html',
  vue: 'html',
  svelte: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  xml: 'xml',
  svg: 'xml',
  plist: 'xml',
  xsl: 'xml',
  xsd: 'xml',
  csproj: 'xml',
  sql: 'sql',
  java: 'java',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ksh: 'shell',
  toml: 'toml',
  dockerfile: 'dockerfile',
  lua: 'lua',
  ini: 'properties',
  cfg: 'properties',
  conf: 'properties',
  properties: 'properties',
  env: 'properties',
  service: 'properties',
  desktop: 'properties',
  cmake: 'cmake',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  pl: 'perl',
  pm: 'perl',
  rb: 'ruby',
  r: 'r',
  jl: 'julia',
  swift: 'swift',
  diff: 'diff',
  patch: 'diff',
  proto: 'protobuf',
  v: 'verilog',
  sv: 'verilog',
  svh: 'verilog',
  f: 'fortran',
  f90: 'fortran',
  f95: 'fortran',
  f03: 'fortran',
  for: 'fortran',
};

export function languageFor(fileName: string): EditorLanguage {
  const base = fileName.toLowerCase();
  const byName = BY_NAME[base];
  if (byName) return LANGUAGES[byName];
  if (base.startsWith('dockerfile.')) return LANGUAGES.dockerfile;
  const dot = base.lastIndexOf('.');
  if (dot < 0) return PLAIN;
  const byExtension = BY_EXTENSION[base.slice(dot + 1)];
  return byExtension ? LANGUAGES[byExtension] : PLAIN;
}

const cache = new Map<EditorLanguage, Extension>();

/** The language's extension, built on first use and shared afterwards. */
export function languageExtension(language: EditorLanguage): Extension {
  let extension = cache.get(language);
  if (extension === undefined) {
    extension = language.load();
    cache.set(language, extension);
  }
  return extension;
}
