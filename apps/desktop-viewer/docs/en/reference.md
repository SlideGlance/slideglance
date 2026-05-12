---
title: desktop-viewer — Reference
lang: en
kind: reference
app: desktop-viewer
last_verified_commit: 0000000000000000000000000000000000000000
source_files:
  - apps/desktop-viewer/package.json
  - apps/desktop-viewer/vite.config.ts
  - apps/desktop-viewer/src/
  - apps/desktop-viewer/src-tauri/
---

# desktop-viewer — Reference

## App layout

```
apps/desktop-viewer/
├── package.json
├── index.html
├── vite.config.ts
├── src/                      # React shell wired to a Tauri SlideController
│   └── …
├── src-tauri/                # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/                  # IPC commands, slide rendering, recent files
├── dist/                     # Vite output (web layer)
└── docs/en/{index,reference,guides}.md
```

## Tauri configuration (`src-tauri/tauri.conf.json`)

| Field | Purpose |
|---|---|
| `productName` | "SlideGlance" |
| `version` | Synced with `package.json` |
| `tauri.bundle.targets` | `["app", "dmg", "msi", "deb"]` per OS |
| `tauri.security.csp` | Restricts the webview origin; SVG / data: allowed for slide thumbnails |
| `tauri.windows[]` | Main window (resizable, drag-region menu bar) |

## IPC commands (Rust → JS)

The native shell exposes a small set of commands consumed by a
custom `SlideController` in the React shell:

| Command | Purpose |
|---|---|
| `load_deck(bytes)` | Parse a deck, return slide count |
| `render_slide(index, opts)` | Return `{ svg, mediaBlobs }` for one slide |
| `recent_files()` | Return the system recent-files list |
| `open_file_dialog()` | Native open-file picker |

## Build artefacts

Per `cargo tauri build`:

| OS | Artefact |
|---|---|
| macOS | `.app` bundle + `.dmg` installer (signed when notarisation creds are present) |
| Windows | `.msi` installer |
| Linux | `.deb` + `.AppImage` |

## Commands

| Script | Purpose |
|---|---|
| `pnpm --filter @slideglance/desktop-viewer dev` | Vite dev server (port 5174) |
| `pnpm --filter @slideglance/desktop-viewer build` | Vite production build → `dist/` |
| `pnpm --filter @slideglance/desktop-viewer preview` | Preview built bundle |
| `pnpm --filter @slideglance/desktop-viewer typecheck` | `tsc --noEmit` |
| `cargo tauri dev` (cwd `src-tauri`) | Native shell against Vite dev server |
| `cargo tauri build` | Cross-platform installer per target |
