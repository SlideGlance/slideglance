// Vite config for the VS Code webview bundle.
//
// Why Vite (and not esbuild like the extension host)
// --------------------------------------------------
// `@slideglance/viewer/dist/pptx-worker.js` boots its WASM core via
// `await import("@slideglance/core")`, with the dynamic-import marker
// `/* @vite-ignore */`. Vite's `vite-plugin-wasm` +
// `vite-plugin-top-level-await` know how to resolve that into a
// concrete worker chunk that loads the WASM binary. esbuild does not
// have an equivalent and would either inline the wasm as base64
// (large, slow) or leave the dynamic import unresolved.
//
// Output layout
// -------------
// `dist/webview/` is the directory the extension's webview HTML loads
// via `webview.asWebviewUri(...)`. Vite emits:
//   - assets/main-<hash>.js    — the React entry
//   - assets/index-<hash>.css  — viewer styles (if any)
//   - assets/pptx-worker-<hash>.js  — the slideglance worker chunk
//   - assets/slideglance_wasm_bg-<hash>.wasm  — WASM payload
//   - index.html               — boot HTML; consumed by `preview.ts` to
//                                build the webview HTML with CSP nonces.
//
// VS Code webview CSP requires every script tag to carry a per-instance
// nonce; since Vite emits `<script type="module" src="...">` with no
// inline content, we add the nonce on the host side by post-processing
// the emitted index.html in `preview.ts`.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { resolve } from "node:path";

// `root` points at `src/webview/` so Vite emits `dist/webview/index.html`
// at the top level (rather than nested under `src/webview/index.html`,
// which is what happens when `root` is left at the package root and the
// HTML is reached via a sub-path input). The viewer fetches its assets
// from `./assets/...` which lives next to the index — see `preview.ts`'s
// HTML rewriter that turns those into webview URIs.
export default defineConfig({
  root: resolve(__dirname, "src/webview"),
  // `./` keeps every emitted asset reference relative. Required for
  // VS Code webviews: with Vite's default `base: '/'` the main bundle
  // calls `new Worker("/assets/...")`, which resolves against the
  // webview origin (e.g. `https://uuid.vscode-webview.net/assets/...`)
  // and 404s — the real assets live under the extension's URI prefix.
  // Relative `./assets/...` resolves against `import.meta.url` of the
  // loaded chunk, which is the webview URI VS Code already serves.
  base: "./",
  plugins: [react(), wasm(), topLevelAwait()],
  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()],
  },
  build: {
    target: "es2022",
    outDir: resolve(__dirname, "dist/webview"),
    emptyOutDir: true,
    sourcemap: true,
  },
  optimizeDeps: {
    exclude: ["@slideglance/core", "@slideglance/viewer"],
  },
  server: {
    fs: {
      allow: [".."],
    },
  },
});
