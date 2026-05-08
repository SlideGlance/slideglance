import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait(), crx({ manifest })],
  worker: {
    format: "es",
    // The pptx worker imports `@slideglance/core` which ships ESM-WASM.
    // Re-applying the wasm + top-level-await plugins to the worker
    // bundle pipeline lets Vite resolve the WASM module identically
    // to the main bundle.
    plugins: () => [wasm(), topLevelAwait()],
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      // Explicitly tell Rollup to treat the viewer HTML as an entry
      // so its <script> / <link> references get resolved + emitted
      // as bundled JS / CSS. Without this, crxjs only emits the
      // service worker and manifest, and copies index.html verbatim
      // (with raw .tsx references that won't load).
      input: {
        viewer: resolve(__dirname, "src/viewer/index.html"),
      },
    },
  },
  optimizeDeps: {
    exclude: ["@slideglance/core", "@slideglance/viewer"],
  },
  server: {
    fs: {
      // Allow @slideglance/core's wasm assets to be served from the
      // workspace `packages/` tree.
      allow: [".."],
    },
  },
});
