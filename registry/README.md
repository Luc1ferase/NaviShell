# NaviShell plugin registry

`plugins.json` in this directory is the **plugin marketplace index**: the list NaviShell
shows under _Settings → Plugins → Marketplace_. It is a plain JSON document served over
HTTPS, nothing more — there is no server, no account and no build step behind it.

| File                  | What it is                                                      |
| --------------------- | --------------------------------------------------------------- |
| `plugins.json`        | The index itself. One entry per published plugin.               |
| `plugins.schema.json` | JSON Schema (draft-07) for `plugins.json`, for editors and CI.  |
| `README.md`           | This guide: the entry format, the rules, how to submit a plugin. |

The app fetches it from

```
https://raw.githubusercontent.com/Luc1ferase/NaviShell/master/registry/plugins.json
```

which is the default; a different URL can be set in _Settings → Plugins_ (stored as
`plugins.registryUrl`), so anyone can run a private index with the same format.

## How the app reads the index

The `plugins_fetch_registry` command downloads the document with a 15 s deadline, accepts
only `http` / `https` URLs and refuses an index larger than 1 MiB. It then drops every
entry it could not use and logs a warning for it, instead of failing the whole list, so
one broken entry only costs that entry. An entry is dropped when

- `id` does not match `^[a-z0-9][a-z0-9._-]*$`, or starts with `navishell.` (reserved for
  the built-in plugins);
- `version` is missing or empty;
- `url` is not an `http` / `https` URL;
- any required field is missing (`id`, `name`, `version`, `url`).

Optional metadata is cleaned rather than fatal: a non-http(s) `homepage`, `repository`,
`readme`, `changelog` or screenshot is ignored, and a release under `releases` without a
version or an http(s) `url` is skipped, each with a log line.

Picking an entry just calls the normal "install from URL" path with that entry's `url` and
`sha256`, so everything below about zip layout is enforced at install time, not here.

## Entry format

```json
{
  "id": "acme.hello",
  "name": { "en": "Hello", "zh-CN": "你好" },
  "description": { "en": "A hello-world panel.", "zh-CN": "一个示例面板。" },
  "version": "1.1.0",
  "url": "https://github.com/acme/navishell-hello/releases/download/v1.1.0/acme.hello-1.1.0.zip",
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "homepage": "https://github.com/acme/navishell-hello",
  "repository": "https://github.com/acme/navishell-hello",
  "readme": "https://raw.githubusercontent.com/acme/navishell-hello/v1.1.0/README.md",
  "changelog": "https://raw.githubusercontent.com/acme/navishell-hello/v1.1.0/CHANGELOG.md",
  "license": "MIT",
  "author": "acme",
  "minHostVersion": "0.2.0",
  "icon": "Puzzle",
  "categories": ["productivity"],
  "tags": ["hello", "example"],
  "screenshots": ["https://raw.githubusercontent.com/acme/navishell-hello/v1.1.0/docs/panel.png"],
  "releases": [
    {
      "version": "1.0.0",
      "url": "https://github.com/acme/navishell-hello/releases/download/v1.0.0/acme.hello-1.0.0.zip",
      "sha256": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
      "minHostVersion": "0.2.0",
      "date": "2026-09-01"
    }
  ]
}
```

Required: `id`, `name`, `version`, `url`. Everything else is optional, but the marketplace
is only as good as the metadata, so fill in what you have.

| Field            | Meaning                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Exactly the `id` of the plugin's own `plugin.json`, unique in the index. Convention `<vendor>.<plugin>`; the vendor should be your GitHub user or organisation.               |
| `name`           | One string, or an object keyed by UI locale (`en`, `zh-CN`, `zh-TW`, `ja`). The app falls back to `en`, so include it.                                                       |
| `description`    | One sentence, same shape as `name`.                                                                                                                                          |
| `version`        | The **latest** version, `x.y.z` with an optional pre-release suffix, identical to the `version` of the `plugin.json` inside the zip at `url`.                                 |
| `url`            | Direct link to the zip itself (ends with `.zip`), not a web page, pinned to a tag.                                                                                           |
| `sha256`         | Hex SHA-256 of that zip. The app verifies it before unpacking and refuses a download that does not match, which is what keeps a replaced asset from installing silently.     |
| `homepage`       | Documentation page, shown as a link.                                                                                                                                         |
| `repository`     | Source repository.                                                                                                                                                           |
| `readme`         | **Raw** Markdown (a `raw.githubusercontent.com` URL, not the GitHub page), rendered on the plugin's detail page. Pin it to a tag or branch.                                   |
| `changelog`      | Raw Markdown changelog, rendered next to the README.                                                                                                                         |
| `license`        | SPDX identifier (`Apache-2.0`, `MIT`, …).                                                                                                                                    |
| `author`         | Who publishes the plugin.                                                                                                                                                    |
| `minHostVersion` | Lowest NaviShell version the latest release works with. The app refuses to install on older hosts.                                                                           |
| `icon`           | A [lucide-react](https://lucide.dev/icons/) icon name in PascalCase.                                                                                                          |
| `categories`     | One to three of `terminal`, `connections`, `files`, `monitoring`, `languages`, `productivity`, `themes`, `other`; the first is the primary. Shown as translated filter chips. |
| `tags`           | Up to ten lowercase keywords (`[a-z0-9-]`) for search.                                                                                                                       |
| `screenshots`    | Up to eight image URLs (PNG, JPEG or WebP) for the detail page.                                                                                                              |
| `releases`       | **Previous** versions, newest first, each with `version`, `url` and ideally `sha256`, `minHostVersion`, `date`. See below.                                                   |

### Releases

The entry's own `version` / `url` / `sha256` / `minHostVersion` always describe the newest
release, so a host that knows nothing about `releases` keeps working. `releases` lists the
older ones, which lets a newer app offer the newest version a given host supports and lets
users go back to a previous version. Rules:

- every release `version` is lower than the entry's `version`;
- releases are sorted newest first and have distinct versions and URLs;
- a release whose zip is gone should be removed from the list rather than left dangling.

Releasing a new version is one PR: move the current `version` / `url` / `sha256` /
`minHostVersion` to the top of `releases` (add its `date`), then put the new values in the
entry and bump `updatedAt`.

## Checks

Every pull request that touches `registry/` runs the **Registry** workflow
(`.github/workflows/registry.yml`), which is `scripts/check-registry.mjs`:

```bash
node scripts/check-registry.mjs                     # everything, with downloads
node scripts/check-registry.mjs --offline           # schema and consistency only
node scripts/check-registry.mjs --base origin/master  # what CI does for a PR
```

It fails the PR when

- the index does not match `plugins.schema.json` or is not formatted by Prettier
  (`pnpm exec prettier --write registry`);
- an `id` is duplicated, a version is not `x.y.z[-suffix]`, a `url` does not end in `.zip`,
  a date is not a real `YYYY-MM-DD`, or `releases` breaks the rules above;
- a zip cannot be downloaded (50 MiB cap, 60 s), its SHA-256 differs from the listed one,
  or the `plugin.json` inside it is missing from the archive root or has a different `id`
  or `version`;
- `homepage`, `repository`, `readme`, `changelog` or a screenshot does not answer 2xx.

Links into this repository on `master` (`https://raw.githubusercontent.com/Luc1ferase/NaviShell/master/...`)
are checked against the pull request's own tree instead of being fetched, so a README and
the entry that points at it can land in the same PR.

In a pull request only the zips and links that the PR added or changed are downloaded,
and the advisory warnings (missing `sha256`, `readme`, `license` or `categories`; a vendor
prefix that differs from the GitHub owner of the download URL) are raised only for the
entries the PR touched. Schema and consistency rules always cover the whole index, and a
push to `master` or a manual run verifies everything.

A listed plugin is still third-party code that the host evaluates in its renderer. These
checks are a sanity check on the entry (the fields, the zip layout, the digest) and not an
audit of the plugin — install from this list with the same judgement you would apply to
any zip.

## Submitting a plugin

1. Publish the plugin zip somewhere stable (see below) and note its SHA-256.
2. Fork this repository and add one object to the `plugins` array of `plugins.json`.
3. Set `updatedAt` to today (`YYYY-MM-DD`).
4. Run `pnpm exec prettier --write registry` and `node scripts/check-registry.mjs`.
5. Open a pull request titled `registry: add <your plugin id>`; the Registry workflow
   reports what, if anything, still needs fixing.

## Plugins maintained in this repository

Plugins under `packages/` that are not bundled with the app (today `plugin-hwmon`) follow
the same rules: the _Plugin release_ workflow (`.github/workflows/plugin-release.yml`)
builds and zips them with `scripts/pack-plugin.mjs` and attaches the zip to a pre-release
tagged `plugin-<id>-v<version>`; the entry here points at that asset, and `readme` /
`changelog` point at the package's `README.md` / `CHANGELOG.md` on `master`. See
`docs/RELEASING.md`, "Plugin releases".

## Hosting the zip

A GitHub Release asset is the easiest stable home:

1. Build the plugin (`main.js`, any `style.css`, `plugin.json`).
2. Zip it with `plugin.json` at the **root** of the archive, or inside a **single**
   top-level directory — both shapes are accepted by the installer (the registry check
   expects the root form).
3. Create a release with a `v<version>` tag and attach the zip.
4. Use the asset URL, which never moves once published:
   `https://github.com/<owner>/<repo>/releases/download/v1.0.0/<name>.zip`.

Do not point `url` at `https://github.com/<owner>/<repo>/archive/refs/heads/master.zip` or
any other branch URL: its contents change under the digest, and the app will then refuse
the install.

What the installer enforces on that zip:

- `plugin.json` sits at the archive root or inside a single top-level directory.
- `id` matches `^[a-z0-9][a-z0-9._-]*$` and does not start with `navishell.`; `version` is
  non-empty; the file named by `main` (default `main.js`) really exists in the archive.
- The archive is at most 50 MiB unpacked, the download times out after 60 s, and only
  `http` / `https` URLs are downloaded.
- Entries with absolute paths, `..` segments or Windows drive prefixes are rejected, and
  symlink entries are skipped.
- The plugin installs into `<appData>/plugins/<id>/`; installing over an existing id asks
  the user to confirm the replacement.

See the "Plugin development" section of the [root README](../README.en.md) for the manifest
fields and the bundling setup.

## Computing the SHA-256

```bash
# Linux, macOS, Git Bash
sha256sum acme.hello-1.0.0.zip
shasum -a 256 acme.hello-1.0.0.zip   # macOS without coreutils
```

```powershell
# Windows PowerShell
Get-FileHash acme.hello-1.0.0.zip -Algorithm SHA256 | Format-List
```

Both print the same 64 hex characters; case does not matter to the app. Hash the exact file
you uploaded, after any signing or repacking step.
