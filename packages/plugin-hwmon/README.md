# Hardware Monitor

A live dashboard of CPU, memory, GPUs and disks for this machine and for the servers you
are connected to over SSH. It is built for multi-GPU boxes: up to five GPUs are shown as
cards, from six on as a dense table that keeps sixteen cards readable without scrolling,
each with its utilization history and the compute processes running on it.

## What it shows

- **Host**: OS, kernel, uptime, load average.
- **CPU**: model, cores and threads, overall and per-core utilization, clock, temperature
  where the OS reports one.
- **Memory**: used, available and total, plus swap.
- **GPUs**: name, utilization, memory, temperature, power and limit, fan, clock, and the
  processes on each card with their memory. Cards keep a utilization sparkline; the table
  unfolds a GPU's processes when you click its row and can expand all GPUs at once.
- **Disks**: usage per mounted filesystem.

Pick the target (this machine or any connected SSH server) and the sampling interval in
the toolbar. Only the selected target is sampled, and only while the panel is visible.
When sampling fails the interval backs off up to 30 s and recovers on the next success.

## Requirements

Everything is collected with tools that ship with the operating system; nothing is
installed on the target.

| Target  | Needs                                                                                       |
| ------- | ------------------------------------------------------------------------------------------- |
| Windows | Windows PowerShell 5.1 (built in). NVIDIA GPUs need `nvidia-smi`, which the driver installs. |
| Linux   | `sh` and `/proc`. NVIDIA via `nvidia-smi`; AMD via `rocm-smi` or, failing that, sysfs.      |
| macOS   | `top`, `vm_stat` and `system_profiler` (built in). The interval floor is 2 s.               |

SSH targets must be Linux or macOS; the plugin probes `uname -s` and uses the matching
script. GPU utilization and processes depend on the vendor tool being present on the
target; without it the GPUs are listed without live numbers and a note says why.

## Install

In NaviShell open **Settings → Plugins → Marketplace** and install *Hardware Monitor*
(host 0.4.0 or newer). The panel opens in the centre; reopen it any time from the
**Panels** menu in the top bar.

## Privacy

The plugin runs read-only system commands on the selected target through the host's
`ctx.local.exec` (this machine) or `ctx.ssh.exec` (servers). It makes no network requests
of its own and stores only your preferences (target, interval, layout).

## Building from source

```bash
pnpm --filter ./packages/plugin-hwmon build   # dist/main.js, style.css, plugin.json
node scripts/pack-plugin.mjs packages/plugin-hwmon   # deterministic zip + SHA-256
```

Install the zip from **Settings → Plugins → Install from file**. Releases are published as
`plugin-luciferase.hwmon-v<version>` pre-releases of the NaviShell repository and listed in
`registry/plugins.json`.

## License

Apache License 2.0, same as NaviShell.
