#!/usr/bin/env node
// Zips a built plugin for distribution and prints its SHA-256.
//
//   node scripts/pack-plugin.mjs packages/plugin-hwmon
//
// Reads `<package>/plugin/plugin.json` for the id and version, takes every file of
// `<package>/dist/` (the output of `vite build`; `main.js`, `plugin.json`, `style.css`, …)
// and writes `<package>/dist/<id>-<version>.zip` with `plugin.json` at the archive root,
// which is the layout `plugins_install_from_url` expects.
//
// The archive is deterministic: entries are stored uncompressed, sorted by name, with a
// fixed timestamp, so the same build always gives the same digest and the `sha256` in
// `registry/plugins.json` can be computed before the asset is uploaded.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function main() {
  const packageDir = path.resolve(process.argv[2] ?? '.');
  const manifestPath = path.join(packageDir, 'plugin', 'plugin.json');
  const distDir = path.join(packageDir, 'dist');

  if (!existsSync(manifestPath)) fail(`no plugin manifest at ${manifestPath}`);
  if (!existsSync(path.join(distDir, 'main.js'))) {
    fail(`no ${path.join(distDir, 'main.js')}; run the package's build first`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof manifest.id !== 'string' || typeof manifest.version !== 'string') {
    fail('plugin.json needs string `id` and `version` fields');
  }

  const files = collectFiles(distDir)
    .filter((relative) => !relative.endsWith('.zip') && !relative.endsWith('.sha256'))
    .sort();
  if (!files.includes('plugin.json')) fail('dist/ has no plugin.json (is `publicDir` set?)');

  const zipName = `${manifest.id}-${manifest.version}.zip`;
  const zipPath = path.join(distDir, zipName);
  const zip = buildZip(
    files.map((relative) => ({
      name: relative.split(path.sep).join('/'),
      data: readFileSync(path.join(distDir, relative)),
    })),
  );
  writeFileSync(zipPath, zip);
  const sha256 = createHash('sha256').update(zip).digest('hex');
  writeFileSync(`${zipPath}.sha256`, `${sha256}  ${zipName}\n`);

  // Key=value lines so a workflow can pick them up with `>> $GITHUB_OUTPUT`.
  console.log(`id=${manifest.id}`);
  console.log(`version=${manifest.version}`);
  console.log(`zip=${zipPath}`);
  console.log(`name=${zipName}`);
  console.log(`sha256=${sha256}`);
  console.log(`files=${files.join(',')}`);
}

// ---------------------------------------------------------------------------

function fail(message) {
  console.error(`pack-plugin: ${message}`);
  process.exit(1);
}

function collectFiles(root, prefix = '') {
  const out = [];
  for (const entry of readdirSync(path.join(root, prefix))) {
    const relative = prefix ? path.join(prefix, entry) : entry;
    if (statSync(path.join(root, relative)).isDirectory())
      out.push(...collectFiles(root, relative));
    else out.push(relative);
  }
  return out;
}

/** Minimal ZIP writer: STORE method only, UTF-8 names, 1980-01-01 timestamps. */
function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(0, 10); // mod time 00:00:00
    local.writeUInt16LE(0x0021, 12); // mod date 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBytes, data);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4); // version made by
    record.writeUInt16LE(20, 6); // version needed
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt16LE(0, 12);
    record.writeUInt16LE(0x0021, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt16LE(0, 30); // extra
    record.writeUInt16LE(0, 32); // comment
    record.writeUInt16LE(0, 34); // disk
    record.writeUInt16LE(0, 36); // internal attributes
    record.writeUInt32LE(0, 38); // external attributes
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, ...central, end]);
}

function crc32(data) {
  const table = crcTable();
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

let cachedCrcTable;
function crcTable() {
  if (!cachedCrcTable) {
    cachedCrcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      cachedCrcTable[n] = c >>> 0;
    }
  }
  return cachedCrcTable;
}

main();
