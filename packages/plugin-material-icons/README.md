# Material File Icons

A file icon theme for NaviShell's file manager: the file and folder icons of the
[Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme)
known from VS Code, chosen by file name, extension or folder name. Besides the usual
languages and formats it knows the files of machine-learning work: PyTorch checkpoints
(`.pt`, `.pth`, `.ckpt`, `.safetensors`), ONNX models, CUDA sources, notebooks, NumPy and
HDF5 dumps, conda environments.

It is also the example of a plugin that contributes a theme through `ctx.fileIcons`: one
`registerTheme` call, a lookup function, and the SVGs inlined into the bundle.

## Requirements

NaviShell 0.10.0 or newer (the `fileIcons` API).

## Using it

Install it from *Settings → Plugins → Marketplace*. The first time it runs it switches the
file manager to the Material icons and says so in a toast. From then on the choice is
yours: *Settings → Appearance → File icons* lists every installed theme next to NaviShell's
own icons, and disabling or uninstalling the plugin falls back to those.

## What is covered

- **Exact file names**: `Dockerfile`, `Makefile`, `CMakeLists.txt`, `package.json`,
  lock files (pnpm, yarn, npm, uv, poetry, Cargo, Go), `pyproject.toml`, `environment.yml`,
  `nginx.conf`, `Chart.yaml`, shell rc files, SSH keys and `known_hosts`, git and editor
  configuration files.
- **Name prefixes**: `README*`, `LICENSE*`, `CHANGELOG*`, `CONTRIBUTING*`, `tsconfig*`,
  `vite.config.*`, `.env*`, `requirements*`, `TODO*`.
- **Extensions**: some 190 of them, from scripts and languages through data, markup and
  media to archives, binaries, keys and infrastructure files.
- **Folder names**: `src`, `lib`, `node_modules`, `.git`, `config`, `docker`, `images`,
  `logs`, `venv`, `scripts`, `tests`, `dist`, `docs`, `tmp`, `downloads`, `.ssh`,
  `notebooks`, `data` and about sixty more; any other directory gets the plain folder.

Symlinks and special files keep NaviShell's own glyphs. A file nothing matches gets the
generic document icon.

## Adding icons

Everything is in two files:

- `src/mapping.ts` holds the three lookups - `FILE_NAMES`, `FILE_NAME_PREFIXES`,
  `EXTENSIONS` - and `FOLDER_NAMES`. Each value is the name of an SVG in `src/icons/`.
- `src/icons/` holds the SVGs; `src/theme.ts` inlines every file of that directory at build
  time (`import.meta.glob` with `?raw`), so a new icon only needs to be dropped there and
  referenced from a lookup. `src/icons/NAMES.txt` lists the upstream icons the set was
  downloaded from.

Then `pnpm --filter @navishell/plugin-material-icons build` and `pnpm --filter
@navishell/plugin-material-icons pack` produce the zip the marketplace installs.

## Icons

The SVGs in `src/icons/` come from the
[Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) by
Material Extensions / Philipp Kief, licensed under the MIT License (see
`src/icons/LICENSE`). They are unmodified copies, except `folder.svg`, the plain folder,
which is the folder shape of the theme's `folder-base.svg` on its own in the theme's
default folder colour.

The plugin code is licensed under Apache-2.0, like NaviShell.
