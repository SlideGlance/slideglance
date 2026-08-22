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

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { resolve, join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";

// Strip `/* @vite-ignore */` from @slideglance/viewer's pre-built worker
// chunk. The directive exists so viewer's OWN vite build leaves
// `import("@slideglance/core")` external (its rollupOptions.external
// handles the actual externalization; the comment suppresses Vite's
// static-import warning). For us — the consumer — leaving the
// directive in would cause Vite to skip resolution, ship a bare
// specifier into the worker chunk, and produce
// "Failed to resolve module specifier '@slideglance/core'" at runtime
// inside the VS Code webview blob worker.
function stripViteIgnoreFromViewerWorker(): Plugin {
  return {
    name: "strip-vite-ignore-from-viewer-worker",
    enforce: "pre",
    transform(code, id) {
      const cleanId = id.split("?")[0];
      const matchesViewerWorker =
        cleanId.endsWith("/viewer/dist/pptx-worker.js") &&
        code.includes("@vite-ignore") &&
        code.includes("@slideglance/core");
      if (!matchesViewerWorker) return null;
      return {
        code: code.replace(/\/\*\s*@vite-ignore\s*\*\//g, ""),
        map: null,
      };
    },
  };
}

// Fail the build when the emitted bundle calls a `self.__slideglance*`
// hook that nothing in the bundle installs.
//
// The webview bundles two artefacts that have to agree on those names:
// the wasm-bindgen glue for `@slideglance/core` (which CALLS them) and
// `@slideglance/viewer/dist/pptx-worker.js` (which INSTALLS them). Note
// the second is the viewer's *pre-built dist*, not its source — so a
// stale `packages/viewer/dist` produces a bundle whose halves disagree
// even though every source file in the tree is correct.
//
// That is how v0.1.3 shipped: the worker installed the pre-rename
// `__pptxRs*` names while the glue called `__slideglance*`. Nothing
// failed at build time; the preview died at runtime with
// "self.__slideglanceMeasureLineMetrics is not a function", which
// points at neither artefact.
//
// The check is name-agnostic — it compares what is called against what
// is assigned — so a future rename is caught the same way.
function assertWorkerGlobalsInstalled(outDir: string): Plugin {
  // Anchored on `self.` so the wasm-bindgen import symbols
  // (`__wbg___slideglanceMeasureText_4793a066…`) stay out of it — those
  // are never installed on the global and are not hooks.
  const CALLED = /self\s*\.\s*(__slideglance[A-Za-z0-9_]+)/g;
  const ASSIGNED = /self\s*\.\s*(__slideglance[A-Za-z0-9_]+)\s*=(?!=)/g;

  return {
    name: "assert-worker-globals-installed",
    apply: "build",
    closeBundle() {
      const assetsDir = join(outDir, "assets");
      let files: string[];
      try {
        files = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
      } catch {
        return; // no assets emitted — nothing to check
      }

      const referenced = new Set<string>();
      const installed = new Set<string>();
      for (const file of files) {
        const code = readFileSync(join(assetsDir, file), "utf8");
        for (const m of code.matchAll(CALLED)) referenced.add(m[1]);
        for (const m of code.matchAll(ASSIGNED)) installed.add(m[1]);
      }

      const missing = [...referenced].filter((n) => !installed.has(n)).sort();
      if (missing.length > 0) {
        throw new Error(
          [
            `[webview] ${missing.length} host hook(s) are called but never installed:`,
            ...missing.map((n) => `  self.${n}`),
            "",
            "The wasm glue and @slideglance/viewer/dist/pptx-worker.js disagree on",
            "these names. The viewer's built dist is almost certainly stale — run",
            "`pnpm --filter @slideglance/viewer build` and package again.",
          ].join("\n"),
        );
      }
    },
  };
}

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
  plugins: [
    stripViteIgnoreFromViewerWorker(),
    react(),
    wasm(),
    topLevelAwait(),
    assertWorkerGlobalsInstalled(resolve(__dirname, "dist/webview")),
  ],
  worker: {
    format: "es",
    plugins: () => [stripViteIgnoreFromViewerWorker(), wasm(), topLevelAwait()],
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
