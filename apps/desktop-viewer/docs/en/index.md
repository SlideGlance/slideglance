---
title: desktop-viewer
lang: en
kind: index
app: desktop-viewer
last_verified_commit: 0000000000000000000000000000000000000000
source_files:
  - apps/desktop-viewer/package.json
  - apps/desktop-viewer/src/
  - apps/desktop-viewer/src-tauri/
---

# desktop-viewer

> Part of the SlideGlance workspace.
> See also: [all apps](../../../../docs/en/apps.md) ·
> [distribution](../../../../docs/en/distribution.md).

## What it is

A Tauri 2 native desktop application for viewing `.pptx` files on
macOS, Windows, and Linux. Hosts
[`@slideglance/viewer`](../../../../packages/viewer/docs/en/index.md)
inside a system webview backed by a Rust pipeline.

## Run it

Development:

```sh
pnpm --filter @slideglance/desktop-viewer dev   # Vite dev server
# in another terminal, from apps/desktop-viewer:
cargo tauri dev                                  # native shell
```

Production builds (per-OS installer):

```sh
cargo tauri build
```

## When to use this

- Offline / kiosk environments where a browser extension is not
  viable.
- Hosts that need OS-level features (menu bar, file associations,
  drag-and-drop, recent files).

## Where to go next

- [Reference](./reference.md) — Tauri configuration, IPC commands,
  build artefacts
- [Guides](./guides.md) — local development, signing, releasing
- Source: [`apps/desktop-viewer/`](../../)
