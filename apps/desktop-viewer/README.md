# @slideglance/desktop-viewer

Native desktop application that opens `.pptx` files locally — no server, no upload — built on Tauri 2 with [`@slideglance/viewer`](../../packages/viewer) inside.

Part of the [SlideGlance](https://github.com/SlideGlance/slideglance) project. Private / not published.

## What it does

Wraps the same React viewer shell as the Chrome extension and web
playground, but runs it inside a native window with OS-level menubar
integration, drag-drop, and recent-files state. The Rust core executes
directly in the Tauri shell (rather than as WebAssembly inside a
sandboxed tab), so heavier decks render with less memory pressure.

## Develop

```sh
# from the workspace root
pnpm install
pnpm --filter @slideglance/desktop-viewer tauri:dev
```

`tauri:dev` starts the Vite dev server for the React frontend and
spins up the Tauri shell against it.

## Build installers

```sh
pnpm --filter @slideglance/desktop-viewer tauri:build
```

The CI workflow `tauri-build.yml` runs the same command across
ubuntu-latest / macos-latest / windows-latest matrices and uploads the
per-OS installers (`.dmg`, `.msi`, `.AppImage`) as artifacts.

## How it differs from the web playground

The web playground (`apps/web-playground`) parses + renders entirely
inside the browser tab via the WASM core. The desktop viewer offloads
parsing + rendering to a native Rust process inside Tauri and routes
slide SVGs through an IPC bridge — heavier deck handling at the cost
of an OS-specific binary.

## License

MIT — see [LICENSE](./LICENSE).
