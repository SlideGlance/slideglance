import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri's frontendDist points at apps/desktop-viewer/dist after `vite build`.
// We don't need vite-plugin-wasm here because rendering happens natively;
// the frontend speaks to Rust over IPC + the pptx:// custom protocol.
export default defineConfig({
  clearScreen: false,
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: true,
  },
  optimizeDeps: {
    exclude: ["@slideglance/viewer"],
  },
});
