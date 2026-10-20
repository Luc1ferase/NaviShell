#!/usr/bin/env node
// Checks the plugin marketplace index `registry/plugins.json` before it ships.
//
//   node scripts/check-registry.mjs [--base <git-ref>] [--offline] [<index path>]
//
// Validates the index against `registry/plugins.schema.json` (draft-07, through Ajv), then
// runs the checks a schema cannot express (unique ids, semver shapes, a strictly descending
// `releases` history, real calendar dates), then — unless `--offline` — downloads every
// plugin zip to verify its SHA-256 and the `id`/`version` of the `plugin.json` inside it,
// and probes the entry's links.
//
// `--base <ref>` (e.g. `origin/master`) keeps a pull request cheap and quiet: a zip is
// downloaded only when its `(url, sha256)` tuple is missing from the index at that ref, and
// links are probed and advisory warnings raised only for entries whose JSON changed. Schema
// and the error-level consistency checks always cover the whole head index. A link to this repository's own `raw.githubusercontent.com/.../master/<path>`
// is not fetched but resolved in the working tree, so a PR can add a file and its registry
// link in one commit.
//
// Prints one finding per line — as `::error`/`::warning` workflow annotations when
// GITHUB_ACTIONS is set — and exits 1 when there was at least one error. Warnings never fail.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const USAGE =
  'usage: node scripts/check-registry.mjs [--base <git-ref>] [--offline] [<index path>]';

/** `1.2.3` with an optional pre-release suffix; the only version shape the registry accepts. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RELEASE_ASSET = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\//;
const RAW_MASTER = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/master\/(.+)$/;

const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const ZIP_TIMEOUT_MS = 60_000;
const LINK_TIMEOUT_MS = 20_000;
/** String fields holding one URL each; `screenshots[]` is handled separately. */
const LINK_FIELDS = ['homepage', 'repository', 'readme', 'changelog'];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const indexPath = path.resolve(
    options.indexPath ?? path.join(repoRoot, 'registry', 'plugins.json'),
  );
  const schemaPath = path.join(path.dirname(indexPath), 'plugins.schema.json');
  const indexName = toPosix(path.relative(repoRoot, indexPath)) || path.basename(indexPath);
  const report = createReport(indexName);
  const counts = { entries: 0, zips: 0, links: 0 };

  const index = readJson(indexPath, report);
  if (!index) return finish(report, counts);

  const schema = readJson(schemaPath, report);
  if (schema) checkSchema(schema, index, report);

  const base = options.base ? readBaseIndex(repoRoot, options.base, indexName, report) : null;
  const baseEntries = base ? collectById(base) : null;
  const items = collectEntries(index);
  counts.entries = items.length;
  checkSemantics(index, items, baseEntries, report);

  if (!options.offline) {
    const knownZips = base ? collectZipTuples(base) : null;
    const repoSlug = detectRepoSlug(repoRoot);
    for (const item of items) {
      counts.zips += await checkZips(item, knownZips, report);
      counts.links += await checkLinks(item, baseEntries, repoRoot, repoSlug, report);
    }
  }

  return finish(report, counts);
}

// --- command line ----------------------------------------------------------

function parseArgs(argv) {
  const options = { base: null, offline: false, indexPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--offline') {
      options.offline = true;
    } else if (arg === '--base') {
      i += 1;
      if (!argv[i]) fail('--base needs a git ref');
      options.base = argv[i];
    } else if (arg.startsWith('--base=')) {
      options.base = arg.slice('--base='.length);
      if (!options.base) fail('--base needs a git ref');
    } else if (arg === '--help' || arg === '-h') {
      writeLine(USAGE);
      process.exit(0);
    } else if (arg.startsWith('-')) {
      fail(`unknown option ${arg}`);
    } else if (options.indexPath) {
      fail('pass at most one index path');
    } else {
      options.indexPath = arg;
    }
  }
  return options;
}

function fail(message) {
  console.error(`check-registry: ${message}`);
  console.error(USAGE);
  process.exit(1);
}

// --- reporting -------------------------------------------------------------

function createReport(file) {
  const errors = [];
  const warnings = [];
  const annotate = process.env.GITHUB_ACTIONS === 'true';
  return {
    errors,
    warnings,
    error(message) {
      errors.push(message);
      writeLine(annotate ? `::error file=${file}::${message}` : `error: ${message}`);
    },
    warn(message) {
      warnings.push(message);
      writeLine(annotate ? `::warning file=${file}::${message}` : `warning: ${message}`);
    },
  };
}

/** Writes synchronously so `process.exit` below can never drop a finding. */
function writeLine(text) {
  writeSync(1, `${text}\n`);
}

function finish(report, counts) {
  const summary =
    `${counts.entries} entries, ${counts.zips} zips verified, ${counts.links} links checked, ` +
    `${report.errors.length} errors, ${report.warnings.length} warnings`;
  writeLine(summary);
  appendStepSummary(report, summary);
  return report.errors.length > 0 ? 1 : 0;
}

function appendStepSummary(report, summary) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const lines = ['### Plugin registry check', '', summary, ''];
  for (const message of report.errors) lines.push(`- **error:** ${message}`);
  for (const message of report.warnings) lines.push(`- warning: ${message}`);
  lines.push('');
  try {
    appendFileSync(file, lines.join('\n'));
  } catch (error) {
    writeLine(`warning: cannot append to GITHUB_STEP_SUMMARY (${describe(error)})`);
  }
}

// --- the index itself ------------------------------------------------------

function readJson(file, report) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    report.error(`cannot read ${file} (${describe(error)})`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    report.error(`${file} is not valid JSON (${describe(error)})`);
    return null;
  }
}

/** Entries paired with the label every finding about them is prefixed with. */
function collectEntries(index) {
  const plugins = Array.isArray(index.plugins) ? index.plugins : [];
  const items = [];
  for (const [position, entry] of plugins.entries()) {
    if (!isObject(entry)) continue;
    const id = typeof entry.id === 'string' ? entry.id : `plugins[${position}]`;
    items.push({ entry, position, id, label: id });
  }
  return items;
}

function checkSchema(schema, index, report) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (error) {
    report.error(`the schema does not compile (${describe(error)})`);
    return;
  }
  if (validate(index)) return;
  for (const problem of validate.errors ?? []) {
    report.error(`schema ${problem.instancePath || '/'}: ${problem.message}`);
  }
}

// --- semantic checks -------------------------------------------------------

function checkSemantics(index, items, baseEntries, report) {
  if (index.updatedAt !== undefined && !isCalendarDate(index.updatedAt)) {
    report.error(`updatedAt "${index.updatedAt}" is not a real YYYY-MM-DD date`);
  }
  const seen = new Map();
  for (const item of items) {
    if (seen.has(item.id)) {
      report.error(
        `${item.label}: duplicate id (plugins[${seen.get(item.id)}] and plugins[${item.position}])`,
      );
    } else {
      seen.set(item.id, item.position);
    }
    checkEntry(item, report);
    checkReleases(item, report);
    if (!unchangedSince(item, baseEntries)) checkEntryWarnings(item, report);
  }
}

/** Whether the entry is byte-for-byte (key order aside) what the base ref already had. */
function unchangedSince(item, baseEntries) {
  const previous = baseEntries?.get(item.id);
  return previous !== undefined && deepEqual(previous, item.entry);
}

function checkEntry({ entry, label }, report) {
  if (typeof entry.version === 'string' && !SEMVER.test(entry.version)) {
    report.error(`${label}: version "${entry.version}" is not <major>.<minor>.<patch>`);
  }
  if (typeof entry.minHostVersion === 'string' && !SEMVER.test(entry.minHostVersion)) {
    report.error(
      `${label}: minHostVersion "${entry.minHostVersion}" is not <major>.<minor>.<patch>`,
    );
  }
  if (typeof entry.url === 'string' && !isZipUrl(entry.url)) {
    report.error(`${label}: url does not end with .zip (${entry.url})`);
  }
}

function checkReleases({ entry, label }, report) {
  if (entry.releases === undefined) return;
  if (!Array.isArray(entry.releases)) {
    report.error(`${label}: releases is not an array`);
    return;
  }
  // Every url in the entry, mapped to a phrase naming who claimed it first.
  const urls = new Map();
  if (typeof entry.url === 'string') urls.set(entry.url, 'the top-level url');
  const versions = new Set();
  let previous = null;

  for (const [position, release] of entry.releases.entries()) {
    if (!isObject(release)) {
      report.error(`${label}: releases[${position}] is not an object`);
      continue;
    }
    const where = `${label} ${typeof release.version === 'string' ? release.version : `releases[${position}]`}`;

    if (typeof release.version !== 'string') {
      report.error(`${where}: release has no version`);
    } else {
      if (!SEMVER.test(release.version)) {
        report.error(`${where}: release version is not <major>.<minor>.<patch>`);
      }
      if (
        typeof entry.version === 'string' &&
        compareVersions(release.version, entry.version) >= 0
      ) {
        report.error(
          `${where}: release version is not lower than the current version ${entry.version}`,
        );
      }
      if (versions.has(release.version)) {
        report.error(`${where}: duplicate release version`);
      } else {
        versions.add(release.version);
      }
      if (previous !== null && compareVersions(release.version, previous) > 0) {
        report.error(`${where}: releases must be newest first (${previous} is listed before it)`);
      }
      previous = release.version;
    }

    if (typeof release.minHostVersion === 'string' && !SEMVER.test(release.minHostVersion)) {
      report.error(
        `${where}: minHostVersion "${release.minHostVersion}" is not <major>.<minor>.<patch>`,
      );
    }

    if (typeof release.url !== 'string') {
      report.error(`${where}: release has no url`);
    } else if (urls.has(release.url)) {
      report.error(`${where}: url is the same as ${urls.get(release.url)}`);
    } else {
      urls.set(release.url, `the url of release ${release.version}`);
      if (!isZipUrl(release.url)) {
        report.error(`${where}: url does not end with .zip (${release.url})`);
      }
    }

    if (release.date !== undefined && !isCalendarDate(release.date)) {
      report.error(`${where}: date "${release.date}" is not a real YYYY-MM-DD date`);
    }
  }
}

function checkEntryWarnings({ entry, label }, report) {
  if (typeof entry.sha256 !== 'string') {
    report.warn(`${label}: no sha256, so the app installs the zip unverified`);
  }
  if (typeof entry.readme !== 'string') report.warn(`${label}: no readme`);
  if (typeof entry.license !== 'string') report.warn(`${label}: no license`);
  if (!Array.isArray(entry.categories) || entry.categories.length === 0) {
    report.warn(`${label}: no categories`);
  }

  const asset = typeof entry.url === 'string' ? RELEASE_ASSET.exec(entry.url) : null;
  const vendor = typeof entry.id === 'string' ? entry.id.split('.')[0] : '';
  if (asset && vendor && asset[1].toLowerCase() !== vendor) {
    report.warn(
      `${label}: vendor prefix "${vendor}" does not match the GitHub owner "${asset[1].toLowerCase()}"`,
    );
  }
}

/** Numeric comparison of the dotted part only; a pre-release suffix is ignored. */
function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

function versionParts(version) {
  return String(version)
    .split('-')[0]
    .split('.')
    .map((part) => {
      const value = Number.parseInt(part, 10);
      return Number.isFinite(value) ? value : 0;
    });
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isZipUrl(url) {
  return url.toLowerCase().endsWith('.zip');
}

// --- what the base ref already covered -------------------------------------

function readBaseIndex(repoRoot, ref, relativePath, report) {
  let text;
  try {
    text = execFileSync('git', ['show', `${ref}:${relativePath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    report.warn(`cannot read ${relativePath} at ${ref} (${describe(error)}); checking everything`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    report.warn(
      `${relativePath} at ${ref} is not valid JSON (${describe(error)}); checking everything`,
    );
    return null;
  }
}

function collectZipTuples(base) {
  const tuples = new Set();
  for (const entry of Array.isArray(base?.plugins) ? base.plugins : []) {
    if (!isObject(entry)) continue;
    if (typeof entry.url === 'string') tuples.add(zipTuple(entry.url, entry.sha256));
    for (const release of Array.isArray(entry.releases) ? entry.releases : []) {
      if (isObject(release) && typeof release.url === 'string') {
        tuples.add(zipTuple(release.url, release.sha256));
      }
    }
  }
  return tuples;
}

function zipTuple(url, sha256) {
  return `${url}\u0000${typeof sha256 === 'string' ? sha256.toLowerCase() : ''}`;
}

function collectById(base) {
  const byId = new Map();
  for (const entry of Array.isArray(base?.plugins) ? base.plugins : []) {
    if (isObject(entry) && typeof entry.id === 'string' && !byId.has(entry.id)) {
      byId.set(entry.id, entry);
    }
  }
  return byId;
}

// --- zip checks ------------------------------------------------------------

async function checkZips({ entry, id, label }, knownZips, report) {
  const targets = [];
  if (typeof entry.url === 'string') {
    targets.push({ label, url: entry.url, sha256: entry.sha256, version: entry.version });
  }
  for (const release of Array.isArray(entry.releases) ? entry.releases : []) {
    if (!isObject(release) || typeof release.url !== 'string') continue;
    targets.push({
      label: `${label} ${release.version ?? '?'}`,
      url: release.url,
      sha256: release.sha256,
      version: release.version,
    });
  }

  let verified = 0;
  for (const target of targets) {
    if (knownZips?.has(zipTuple(target.url, target.sha256))) continue;
    if (await checkZip(id, target, report)) verified += 1;
  }
  return verified;
}

/** Downloads one zip, verifies its digest and the manifest it carries. */
async function checkZip(id, target, report) {
  let body;
  try {
    body = await download(target.url);
  } catch (error) {
    report.error(`${target.label}: cannot download ${target.url} (${describe(error)})`);
    return false;
  }

  const digest = createHash('sha256').update(body).digest('hex');
  if (typeof target.sha256 === 'string' && target.sha256.toLowerCase() !== digest) {
    report.error(
      `${target.label}: sha256 mismatch (expected ${target.sha256.toLowerCase()}, got ${digest})`,
    );
  }

  let manifestBytes;
  try {
    manifestBytes = readZipFile(body, 'plugin.json');
  } catch (error) {
    report.error(`${target.label}: ${describe(error)}`);
    return true;
  }
  if (!manifestBytes) {
    report.error(`${target.label}: the zip has no plugin.json at its root`);
    return true;
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    report.error(`${target.label}: plugin.json in the zip is not valid JSON (${describe(error)})`);
    return true;
  }
  const inZip = isObject(manifest) ? manifest : {};
  if (inZip.id !== id) {
    report.error(`${target.label}: plugin.json has id "${inZip.id}", the registry says "${id}"`);
  }
  if (target.version !== undefined && inZip.version !== target.version) {
    report.error(
      `${target.label}: plugin.json has version "${inZip.version}", the registry says "${target.version}"`,
    );
  }
  return true;
}

async function download(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(ZIP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trimEnd());
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ZIP_BYTES) {
    throw new Error(`${declared} bytes is over the ${MAX_ZIP_BYTES} byte limit`);
  }
  if (!response.body) return Buffer.alloc(0);

  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_ZIP_BYTES) throw new Error(`body is over the ${MAX_ZIP_BYTES} byte limit`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// --- minimal zip reader ----------------------------------------------------

/** Returns the bytes of the archive-root file `wanted`, or null when it is not there. */
function readZipFile(buffer, wanted) {
  const end = findEndOfCentralDirectory(buffer);
  const total = buffer.readUInt16LE(end + 10);
  const size = buffer.readUInt32LE(end + 12);
  const start = buffer.readUInt32LE(end + 16);
  if (total === 0xffff || size === 0xffffffff || start === 0xffffffff) {
    throw new Error('zip64 archives are not supported');
  }

  let position = start;
  for (let i = 0; i < total; i += 1) {
    if (position + 46 > buffer.length || buffer.readUInt32LE(position) !== 0x02014b50) {
      throw new Error('damaged zip: expected a central directory record');
    }
    const nameLength = buffer.readUInt16LE(position + 28);
    const name = buffer.toString('utf8', position + 46, position + 46 + nameLength);
    if (name === wanted) {
      return readLocalFile(buffer, {
        name,
        method: buffer.readUInt16LE(position + 10),
        compressedSize: buffer.readUInt32LE(position + 20),
        uncompressedSize: buffer.readUInt32LE(position + 24),
        offset: buffer.readUInt32LE(position + 42),
      });
    }
    position +=
      46 + nameLength + buffer.readUInt16LE(position + 30) + buffer.readUInt16LE(position + 32);
  }
  return null;
}

function findEndOfCentralDirectory(buffer) {
  const earliest = Math.max(0, buffer.length - 0xffff - 22);
  for (let position = buffer.length - 22; position >= earliest; position -= 1) {
    if (buffer.readUInt32LE(position) === 0x06054b50) return position;
  }
  throw new Error('not a zip file (no end of central directory record)');
}

function readLocalFile(buffer, entry) {
  if (entry.compressedSize === 0xffffffff || entry.uncompressedSize === 0xffffffff) {
    throw new Error(`zip64 entries are not supported (${entry.name})`);
  }
  if (entry.offset + 30 > buffer.length || buffer.readUInt32LE(entry.offset) !== 0x04034b50) {
    throw new Error(`damaged zip: no local header for ${entry.name}`);
  }
  const start =
    entry.offset +
    30 +
    buffer.readUInt16LE(entry.offset + 26) +
    buffer.readUInt16LE(entry.offset + 28);
  const end = start + entry.compressedSize;
  if (end > buffer.length) {
    throw new Error(`damaged zip: ${entry.name} runs past the end of the archive`);
  }
  const data = buffer.subarray(start, end);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`);
}

// --- link checks -----------------------------------------------------------

async function checkLinks(item, baseEntries, repoRoot, repoSlug, report) {
  if (unchangedSince(item, baseEntries)) return 0;
  let checked = 0;
  for (const [field, url] of collectLinks(item.entry)) {
    checked += 1;
    await checkLink(item.label, field, url, repoRoot, repoSlug, report);
  }
  return checked;
}

function collectLinks(entry) {
  const links = [];
  for (const field of LINK_FIELDS) {
    if (typeof entry[field] === 'string') links.push([field, entry[field]]);
  }
  if (Array.isArray(entry.screenshots)) {
    for (const [position, url] of entry.screenshots.entries()) {
      if (typeof url === 'string') links.push([`screenshots[${position}]`, url]);
    }
  }
  return links;
}

async function checkLink(label, field, url, repoRoot, repoSlug, report) {
  const local = sameRepoPath(url, repoSlug);
  if (local !== null) {
    if (!existsSync(path.join(repoRoot, local))) {
      report.error(
        `${label}: ${field} points at ${local}, which does not exist in this repository`,
      );
    }
    return;
  }
  try {
    const status = await probe(url);
    if (status < 200 || status > 299) {
      report.error(`${label}: ${field} ${url} answered HTTP ${status}`);
    }
  } catch (error) {
    report.error(`${label}: ${field} ${url} is unreachable (${describe(error)})`);
  }
}

/** HEAD, falling back to GET when the server dislikes HEAD. */
async function probe(url) {
  try {
    const head = await request(url, 'HEAD');
    if (head !== 405 && head !== 403) return head;
  } catch {
    // Some hosts reset the connection on HEAD; let GET have the last word.
  }
  return request(url, 'GET');
}

async function request(url, method) {
  const response = await fetch(url, {
    method,
    redirect: 'follow',
    signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
  });
  await response.body?.cancel();
  return response.status;
}

/**
 * The path a link points at inside this very repository, or null when the link is
 * somewhere else and has to be fetched.
 */
function sameRepoPath(url, repoSlug) {
  if (!repoSlug) return null;
  const match = RAW_MASTER.exec(url);
  if (!match) return null;
  if (`${match[1]}/${match[2]}`.toLowerCase() !== repoSlug.toLowerCase()) return null;
  return decodeURIComponent(match[3].split(/[?#]/)[0]);
}

function detectRepoSlug(repoRoot) {
  const fromEnv = process.env.GITHUB_REPOSITORY?.trim();
  if (fromEnv) return fromEnv;
  let remote;
  try {
    remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
  const match = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/.exec(remote);
  return match ? `${match[1]}/${match[2]}` : '';
}

// --- helpers ---------------------------------------------------------------

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Key order and prototype aside, are these two JSON values the same? */
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

function describe(error) {
  if (!error) return 'unknown error';
  const stderr = typeof error.stderr === 'string' ? error.stderr : error.stderr?.toString();
  const firstLine = stderr?.trim().split('\n')[0];
  if (firstLine) return firstLine;
  if (error.name === 'TimeoutError') return 'timed out';
  if (error.cause?.message) return `${error.message}: ${error.cause.message}`;
  return error.message || String(error);
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

// `process.exitCode` rather than `process.exit`: tearing the process down while a keep-alive
// socket is still open makes libuv abort on Windows, and every finding is already written
// synchronously, so there is nothing left to flush.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`check-registry: ${describe(error)}`);
    process.exitCode = 1;
  },
);
