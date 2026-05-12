---
title: Apps
lang: en
kind: navigation
last_verified_commit: 0000000000000000000000000000000000000000
source_files:
  - apps/
---

# Apps

> Part of the [SlideGlance workspace](./index.md).

End-user surfaces — each one consumes the WASM core and the packages
above it.

| Name | Surface | Docs |
|---|---|---|
| [`chrome-extension`](../../apps/chrome-extension/docs/en/index.md) | Manifest V3 extension that intercepts `.pptx` links | [index](../../apps/chrome-extension/docs/en/index.md) · [reference](../../apps/chrome-extension/docs/en/reference.md) · [guides](../../apps/chrome-extension/docs/en/guides.md) |
| [`web-playground`](../../apps/web-playground/docs/en/index.md) | Drag-and-drop SPA, GitHub Pages hosted | [index](../../apps/web-playground/docs/en/index.md) · [reference](../../apps/web-playground/docs/en/reference.md) · [guides](../../apps/web-playground/docs/en/guides.md) |
| [`desktop-viewer`](../../apps/desktop-viewer/docs/en/index.md) | Tauri 2 native shell (Mac / Windows / Linux) | [index](../../apps/desktop-viewer/docs/en/index.md) · [reference](../../apps/desktop-viewer/docs/en/reference.md) · [guides](../../apps/desktop-viewer/docs/en/guides.md) |
| [`vscode-extension`](../../apps/vscode-extension/docs/en/index.md) | VS Code extension: `.sgx` live preview + `.pptx` viewer | [index](../../apps/vscode-extension/docs/en/index.md) · [reference](../../apps/vscode-extension/docs/en/reference.md) · [guides](../../apps/vscode-extension/docs/en/guides.md) |
| [`landing`](../../apps/landing/docs/en/index.md) | Static marketing site for `slideglance.github.io` | [index](../../apps/landing/docs/en/index.md) · [reference](../../apps/landing/docs/en/reference.md) · [guides](../../apps/landing/docs/en/guides.md) |

## Surface vs. shared code

Every app under `apps/` is a thin shell. The heavy lifting lives in
`packages/` and `crates/`. If an app accumulates logic that another
surface could reuse, move it into a package; if it accumulates pure
algorithmic logic, move it into a Rust crate.

See [Distribution](./distribution.md) for release pipelines per app.
