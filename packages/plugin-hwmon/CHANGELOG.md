# Changelog

## 0.1.1 (2026-10-20)

- The table layout (six or more GPUs) unfolds a GPU's compute processes under its row,
  the same `pid · name · memory` list the cards show; the header's process column expands or
  collapses every GPU at once. Open rows survive resampling.
- Sampling backs off while it fails: the interval doubles per consecutive failed sample, up
  to 30 s, and resets on success, on switching targets or on Retry.

## 0.1.0 (2026-10-20)

- First release: CPU, memory, GPU and disk overview for this machine and for SSH targets
  (Linux and macOS), cards for up to five GPUs and a dense table from six on, per-GPU
  utilization history and process lists, NVIDIA (`nvidia-smi`) and AMD (`rocm-smi`,
  sysfs) support, selectable sampling interval.
