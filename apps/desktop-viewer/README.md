# @slideglance/desktop-viewer

Tauri-based desktop application that opens `.pptx` files locally — no
server, no upload — backed by [`@slideglance/viewer`](../../packages/viewer)
and a native Rust renderer running inside the Tauri shell.

Part of the [SlideGlance](https://github.com/SlideGlance/slideglance)
project. Private / not published.

## Run locally

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
per-OS installers as artifacts.

## How it differs from the web playground

The web playground (`apps/web-playground`) parses + renders entirely
inside the browser tab via the WASM core. The desktop viewer offloads
parsing + rendering to a native Rust process inside Tauri and routes
slide SVGs through an IPC bridge — heavier deck handling at the cost
of an OS-specific binary.

## License

MIT — see [LICENSE](./LICENSE).
