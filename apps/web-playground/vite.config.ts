import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  base: "./",
  plugins: [react(), wasm(), topLevelAwait()],
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
    headers: {
      // Aggressively disable browser caching during development so a
      // fresh `pnpm run build:wasm` is picked up on the next page
      // reload — without this the browser reuses the previous wasm
      // module from disk cache even after a rebuild.
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  },
});
