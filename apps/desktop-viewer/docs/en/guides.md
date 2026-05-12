---
title: desktop-viewer — Guides
lang: en
kind: guides
app: desktop-viewer
last_verified_commit: 0000000000000000000000000000000000000000
source_files:
  - apps/desktop-viewer/src/
  - apps/desktop-viewer/src-tauri/
---

# desktop-viewer — Guides

## Run the app locally

### Goal

Iterate on both the Rust backend and the React shell with hot
reload.

### Steps

1. From the repo root: `pnpm --filter @slideglance/desktop-viewer dev`
   (starts Vite on port 5174).
2. From `apps/desktop-viewer/src-tauri/`: `cargo tauri dev`.

### Expected result

A native window opens; React source edits hot-reload through Vite;
Rust source edits trigger a full backend rebuild.

## Add a new IPC command

### Goal

Surface a new feature from the Rust backend to the React shell.

### Steps

1. Define the command in `src-tauri/src/commands/<name>.rs` using
   `#[tauri::command]`.
2. Register it in `src-tauri/src/main.rs` via
   `tauri::Builder::default().invoke_handler(...)`.
3. Update `src/lib/tauri-api.ts` (or equivalent) to expose a typed
   wrapper: `export const myCommand = () => invoke<Result>("my_command", { … });`
4. If the new command affects slide rendering, update the
   `SlideController` implementation in
   `src/tauri-slide-controller.ts`.

### Expected result

`cargo tauri build` succeeds; the React shell calls the new command
and receives the typed result.

## Build a signed macOS release

### Goal

Produce a notarised `.dmg` for distribution.

### Steps

1. Configure the Apple Developer ID in
   `src-tauri/tauri.conf.json` (or pass via env at build time).
2. Set the notarisation credentials in the environment
   (`APPLE_ID`, `APPLE_PASSWORD` / app-specific password,
   `APPLE_TEAM_ID`).
3. `cd apps/desktop-viewer/src-tauri && cargo tauri build`.
4. The build output includes the signed and notarised `.dmg` under
   `src-tauri/target/release/bundle/dmg/`.

### Expected result

`spctl --assess --type execute --verbose=4 /path/to/SlideGlance.app`
reports an accepted, notarised binary.
