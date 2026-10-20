# NaviShell plugin registry

`plugins.json` in this directory is the **plugin marketplace index**: the list NaviShell
shows under _Settings → Plugins → Marketplace_. It is a plain JSON document served over
HTTPS, nothing more — there is no server, no account and no build step behind it.

| File                  | What it is                                                     |
| --------------------- | -------------------------------------------------------------- |
| `plugins.json`        | The index itself. One entry per published plugin.              |
| `plugins.schema.json` | JSON Schema (draft-07) for `plugins.json`, for editors and CI. |

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

Picking an entry just calls the normal "install from URL" path with that entry's `url` and
`sha256`, so everything below about zip layout is enforced at install time, not here.

## Submitting a plugin

1. Publish the plugin zip somewhere stable (see below) and note its SHA-256.
2. Fork this repository and add one object to the `plugins` array of `plugins.json`.
3. Set `updatedAt` to today (`YYYY-MM-DD`).
4. Run `pnpm exec prettier --write registry` so the formatting matches CI.
5. Open a pull request titled `registry: add <your plugin id>`.

```json
{
  "id": "acme.hello",
  "name": { "en": "Hello", "zh-CN": "你好" },
  "description": { "en": "A hello-world panel.", "zh-CN": "一个示例面板。" },
  "version": "1.0.0",
  "url": "https://github.com/acme/navishell-hello/releases/download/v1.0.0/acme.hello-1.0.0.zip",
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "homepage": "https://github.com/acme/navishell-hello",
  "author": "acme",
  "minHostVersion": "0.2.0",
  "icon": "Puzzle"
}
```

Rules for an entry:

- `id` must be exactly the `id` of the plugin's own `plugin.json`, and unique in the index.
  The convention is `<vendor>.<plugin>`; duplicates are not rejected by the app, they just
  both show up, so a PR that collides with an existing id will be asked to rename.
- `name` and `description` are either one string or an object keyed by UI locale (`en`,
  `zh-CN`). The app falls back to `en`, so include it.
- `version` must match the `version` of the `plugin.json` inside the zip at `url`.
- `url` must point at the zip itself, not at a web page, and should be pinned to a tag.
- `sha256` is optional but strongly recommended: the app verifies it before unpacking and
  refuses a download that does not match, which is what keeps a replaced asset from
  installing silently.
- `icon` is a [lucide-react](https://lucide.dev/icons/) icon name in PascalCase.

Releasing a new version is the same change: update `version`, `url` and `sha256` together
in one PR. An entry is just a pointer, so the registry has no history of older versions.

A listed plugin is still third-party code that the host evaluates in its renderer. Review
is a sanity check on the entry (the fields, the zip layout, the digest) and not an audit of
the plugin — install from this list with the same judgement you would apply to any zip.

## Plugins maintained in this repository

Plugins under `packages/` that are not bundled with the app (today `plugin-hwmon`) follow
the same rules: the *Plugin release* workflow (`.github/workflows/plugin-release.yml`)
builds and zips them with `scripts/pack-plugin.mjs` and attaches the zip to a pre-release
tagged `plugin-<id>-v<version>`; the entry here points at that asset. See
`docs/RELEASING.md`, "Plugin releases".

## Hosting the zip

A GitHub Release asset is the easiest stable home:

1. Build the plugin (`main.js`, any `style.css`, `plugin.json`).
2. Zip it with `plugin.json` at the **root** of the archive, or inside a **single**
   top-level directory — both shapes are accepted.
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
