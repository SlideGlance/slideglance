/**
 * builder-vscode webview entry — mounts `<PptxPresentation>` and bridges
 * messages with the extension host.
 *
 * Protocol (host ⇄ webview)
 * -------------------------
 *  - host → webview  `{ type: 'pptx', bytes: Uint8Array, name?: string, deckGeneration: number, invalidatedSlides?: number[] }`
 *      Replace the deck the viewer is showing. `deckGeneration` is a
 *      monotonic id the host bumps when the deck identity changes
 *      (different document, or explicit refresh). When the webview
 *      sees a higher value than the one it currently holds, it
 *      remounts `<PptxPresentation>` (via React `key`) and spins up a
 *      fresh worker controller — fully resetting slide index, zoom,
 *      pan, search state, and worker-side slide caches. Repeats of the
 *      same `deckGeneration` are edit cycles and stay incremental.
 *
 *  - host → webview  `{ type: 'error', message: string }`
 *      Show an error overlay (e.g. parse / build failure). Clears the
 *      previous deck so the user does not click on stale slides.
 *
 *  - webview → host  `{ type: 'revealSource', objectName: string }`
 *      Click on a slide element with `data-object-name="node#N"`. Host
 *      resolves the source position and reveals the editor.
 *
 *  - webview → host  `{ type: 'ready' }`
 *      Sent once on mount so the host can flush any pending PPTX bytes
 *      it queued while the webview was still loading.
 */

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PptxPresentation,
  createWorkerController,
  type SlideController,
} from "@slideglance/viewer";
// `?worker&url` returns the asset URL as a string (rather than a Worker
// constructor) — Vite resolves it through the bundle so it points at
// `dist/webview/assets/pptx-worker-<hash>.js`. We can't use the
// `?worker` form here because VS Code webviews load assets from a
// different origin than the document itself, and the `Worker(url)`
// constructor enforces same-origin. The Blob wrapper below sidesteps
// that — see `createSameOriginWorker`.
import workerUrl from "@slideglance/viewer/dist/pptx-worker.js?worker&url";

interface VsCodeApi {
  postMessage(msg: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// Acquire ONCE at module scope. `acquireVsCodeApi()` may only be
// called a single time per webview instance — calling it from two
// `useEffect`s (or even one effect under React 18 StrictMode's
// double-mount) throws "An instance of the VS Code API has already
// been acquired".
const vscode = acquireVsCodeApi();

/**
 * Build a Worker that runs the slideglance worker chunk under the
 * webview's own origin.
 *
 * Why this is non-trivial
 * -----------------------
 * VS Code serves webview HTML at `vscode-webview://<uuid>` but
 * `webview.asWebviewUri(...)` rewrites resource paths to a cross-origin
 * cdn (`https://file+.vscode-resource.vscode-cdn.net/...`). Two
 * separate restrictions follow:
 *
 *  - The `Worker(url)` constructor rejects cross-origin script URLs
 *    with `SecurityError`.
 *  - Cross-origin module imports (static AND dynamic — including
 *    `import("./foo.js")` resolved against `import.meta.url` of a
 *    cross-origin module) are stricter than `fetch()`. Even when the
 *    cdn responds OK to `fetch`, the same URL fails as a module load
 *    with "Failed to fetch dynamically imported module".
 *
 * Strategy: recursive `fetch` + Blob inlining
 * -------------------------------------------
 * Walk every module reachable from the worker entry, `fetch()` its
 * source through `connect-src` (CORS-permitted), rewrite all relative
 * imports inside it to point at sibling Blob URLs we materialize
 * recursively, then wrap the result in a `blob:` URL the browser
 * accepts as a module specifier.
 *
 * `import.meta.url` is rewritten to a string literal of the original
 * cdn URL inside each module. The slideglance wasm shim uses this
 * to compute the `.wasm` payload URL via `new URL(name,
 * import.meta.url)`; keeping it cdn-pointed means the eventual
 * `fetch(wasmUrl)` lands on the cdn (CORS-permitted) and
 * `WebAssembly.instantiateStreaming` works.
 */
async function fetchSource(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Failed to fetch ${url}: ${r.status} ${r.statusText}`);
  }
  return r.text();
}

async function fetchAsBlobUrl(url: string, mimeType: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Failed to fetch ${url}: ${r.status} ${r.statusText}`);
  }
  const bytes = await r.arrayBuffer();
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

async function createSameOriginWorker(srcUrl: string): Promise<Worker> {
  const absolute = new URL(srcUrl, document.baseURI).href;
  // Memoize so a diamond-shaped import graph doesn't double-fetch /
  // double-blob the same chunk (and so cross-references stay stable).
  const blobUrlByCdnUrl = new Map<string, string>();
  const assetBlobByCdnUrl = new Map<string, string>();

  async function inlineModule(moduleUrl: string): Promise<string> {
    const cached = blobUrlByCdnUrl.get(moduleUrl);
    if (cached) return cached;
    const baseDir = moduleUrl.substring(0, moduleUrl.lastIndexOf("/") + 1);
    const source = await fetchSource(moduleUrl);

    // ---- Step 1: relative JS imports ---------------------------------
    //
    // Three regexes covering the only positions where a relative
    // specifier in compiled module code is actually a module load:
    //
    //   1. dynamic import:        import("./name")
    //   2. static `... from`:     import x from "./name"
    //                             export { x } from "./name"
    //   3. bare side-effect:      import "./name"
    //
    // All three quote styles (`"`, `'`, `` ` ``) must be matched —
    // Vite emits backtick-quoted dynamic imports in minified worker
    // chunks (e.g. `import(\`./slideglance_wasm-XXX.js\`)`).
    //
    // String literals that look like `./name` but appear elsewhere
    // (object keys, regex strings, comments, …) are NOT module loads
    // and must be left untouched. The wasm-bindgen bundler shim ships
    // an imports map keyed by `"./slideglance_wasm_bg.js"` — matching
    // that as an import would 404 on `fetch` of a file that doesn't
    // exist on disk.
    const DYN_RE = /\bimport\s*\(\s*(["'`])\.\/([^"'`]+)\1\s*\)/g;
    const FROM_RE = /\bfrom\s+(["'`])\.\/([^"'`]+)\1/g;
    const BARE_RE = /\bimport\s+(["'`])\.\/([^"'`]+)\1/g;

    const relPaths = new Set<string>();
    for (const re of [DYN_RE, FROM_RE, BARE_RE]) {
      let match: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((match = re.exec(source)) !== null) {
        relPaths.add(match[2]);
      }
    }

    const childBlobUrl = new Map<string, string>();
    for (const name of relPaths) {
      childBlobUrl.set(name, await inlineModule(baseDir + name));
    }

    let rewritten = source;
    for (const [name, blobUrl] of childBlobUrl) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      rewritten = rewritten
        .replace(
          new RegExp(
            `\\bimport\\s*\\(\\s*(["'\`])\\./${escaped}\\1\\s*\\)`,
            "g",
          ),
          (_m, q: string) => `import(${q}${blobUrl}${q})`,
        )
        .replace(
          new RegExp(`\\bfrom\\s+(["'\`])\\./${escaped}\\1`, "g"),
          (_m, q: string) => `from ${q}${blobUrl}${q}`,
        )
        .replace(
          new RegExp(`\\bimport\\s+(["'\`])\\./${escaped}\\1`, "g"),
          (_m, q: string) => `import ${q}${blobUrl}${q}`,
        );
    }

    // ---- Step 2: non-JS asset URLs ----------------------------------
    //
    // The slideglance wasm shim spells out its `.wasm` payload URL via
    //   new URL("slideglance_wasm_bg-XXX.wasm", import.meta.url)
    // The eventual `fetch()` is run from the worker's origin (the blob:
    // URL we materialize below). Worker → cdn fetches for `.wasm`
    // bytes have surfaced as garbage payloads in this VS Code release
    // (`WebAssembly.instantiate(): expected magic word, found 52 65 71
    // 75 @+0` — bytes that start with `Requ`, presumably an HTTP
    // error / wrapped service-worker response). Side-stepping the
    // cross-origin worker fetch by pre-fetching the asset on the main
    // thread and substituting the URL expression with a same-origin
    // `blob:` URL avoids the failure entirely.
    //
    // We only handle assets explicitly authored as `new URL("name",
    // import.meta.url)` so plain string literals are unaffected.
    const ASSET_URL_RE =
      /\bnew\s+URL\s*\(\s*(["'`])([^"'`]+)\1\s*,\s*import\.meta\.url\s*\)/g;
    const assetMatches: { fullMatch: string; name: string }[] = [];
    {
      let match: RegExpExecArray | null;
      ASSET_URL_RE.lastIndex = 0;
      while ((match = ASSET_URL_RE.exec(rewritten)) !== null) {
        assetMatches.push({ fullMatch: match[0], name: match[2] });
      }
    }
    for (const { fullMatch, name } of assetMatches) {
      const assetUrl = baseDir + name;
      let assetBlob = assetBlobByCdnUrl.get(assetUrl);
      if (!assetBlob) {
        const mime = name.endsWith(".wasm")
          ? "application/wasm"
          : "application/octet-stream";
        assetBlob = await fetchAsBlobUrl(assetUrl, mime);
        assetBlobByCdnUrl.set(assetUrl, assetBlob);
      }
      // Replace the entire `new URL(..., import.meta.url)` expression
      // with `new URL("blob:...")`. Calling `.href` on either form
      // yields a usable URL string, which is what the shim consumes.
      const replacement = `new URL(${JSON.stringify(assetBlob)})`;
      rewritten = rewritten.split(fullMatch).join(replacement);
    }

    // ---- Step 3: residual `import.meta.url` -------------------------
    //
    // Anything still referencing `import.meta.url` after Step 2 is
    // unrelated to asset loading. Keep it pointed at the cdn URL —
    // some chunks log it for diagnostics. Doesn't matter that it
    // disagrees with the actual blob URL the module loaded from.
    rewritten = rewritten.replace(
      /\bimport\.meta\.url\b/g,
      JSON.stringify(moduleUrl),
    );

    const blob = new Blob([rewritten], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    blobUrlByCdnUrl.set(moduleUrl, blobUrl);
    return blobUrl;
  }

  const workerBlobUrl = await inlineModule(absolute);
  return new Worker(workerBlobUrl, { type: "module" });
}

function App(): JSX.Element {
  const [controller, setController] = useState<SlideController | null>(null);
  const [src, setSrc] = useState<Uint8Array | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 1-based slide indices the host computed as "changed since the
  // last successful render". Forwarded to slideglance/viewer as
  // `invalidatedSlides`; the viewer flushes only those cache entries
  // (everything else stays cached and avoids re-rendering). Tracked
  // alongside `src` so the viewer sees them update atomically when
  // React re-renders this component.
  const [invalidatedSlides, setInvalidatedSlides] = useState<
    number[] | undefined
  >(undefined);
  // Host-driven deck identity. Bumped when the host swaps to a
  // different document or issues a refresh; used as a React `key` on
  // `<PptxPresentation>` to force a full unmount/remount that wipes
  // currentSlide / zoom / pan / search / dialog state. The worker
  // controller is intentionally NOT torn down on key change — the
  // viewer's `open(bytes)` already replaces the loaded deck inside
  // the worker, so a single long-lived worker is enough to fully
  // reinitialize visible state. Re-creating the worker here would
  // also race with React's commit/effect ordering: the old <Pptx…>
  // would briefly mount with the new src under the soon-to-be-closed
  // controller, transferring the ArrayBuffer to a dying worker and
  // surfacing as "Failed to execute 'postMessage' on 'Worker':
  // ArrayBuffer at index 0 is already detached."
  const [deckGeneration, setDeckGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const worker = await createSameOriginWorker(workerUrl);
        // Surface worker-thread crashes (wasm init failures, runtime
        // panics, deserialization errors) to the host log + the error
        // overlay. Without these listeners they only appear in the
        // worker's own DevTools target, which is hard to reach inside
        // a VS Code Extension Development Host.
        worker.addEventListener("error", (ev) => {
          if (cancelled) return;
          const detail = ev.message
            ? `${ev.message}${ev.filename ? ` (${ev.filename}:${ev.lineno}:${ev.colno})` : ""}`
            : "Worker error (no message)";
          setErrorMsg(`Preview worker error: ${detail}`);
        });
        worker.addEventListener("messageerror", () => {
          if (cancelled) return;
          setErrorMsg("Preview worker message could not be deserialized.");
        });
        const c = await createWorkerController(worker);
        if (cancelled) {
          c.close();
          return;
        }
        setController(c);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(`Failed to start preview worker: ${msg}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to host messages.
  useEffect(() => {
    function onMessage(ev: MessageEvent): void {
      const msg = ev.data as
        | {
            type: "pptx";
            bytes: ArrayBuffer | Uint8Array;
            name?: string;
            invalidatedSlides?: number[];
            deckGeneration?: number;
          }
        | { type: "error"; message: string };
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "pptx") {
        const bytes =
          msg.bytes instanceof Uint8Array
            ? msg.bytes
            : new Uint8Array(msg.bytes);
        setErrorMsg(null);
        setName(msg.name ?? null);
        setSrc(bytes);
        setInvalidatedSlides(msg.invalidatedSlides);
        // Functional update: a stale `deckGeneration` captured in
        // this closure would compare against the wrong value when
        // multiple messages arrive between renders.
        if (typeof msg.deckGeneration === "number") {
          const incoming = msg.deckGeneration;
          setDeckGeneration((prev) => (incoming > prev ? incoming : prev));
        }
      } else if (msg.type === "error") {
        setErrorMsg(msg.message);
      }
    }
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Source-reveal: capture clicks on any element carrying
  // `data-object-name="node#N"` and forward to the host. The slideglance
  // renderer emits this attribute from the OOXML `<p:cNvPr name>`
  // pom seeded during PPTX build, so we can intercept on document
  // bubble without slideglance/viewer exposing a dedicated callback.
  //
  // The thumbnail rail and grid view render the same SVG (with the
  // same `data-object-name` attributes) inside `<button>` tiles whose
  // own click handler navigates the deck. Suppressing source-reveal
  // when the click hits anything inside a `<button>` keeps the
  // navigation path intact and limits source-reveal to the main slide
  // stage (which mounts SVG into a plain `<div>` host, no button
  // ancestor).
  useEffect(() => {
    function onClick(e: MouseEvent): void {
      const target = e.target as Element | null;
      if (!target || !("closest" in target)) return;
      if (target.closest("button")) return;
      const hit = target.closest<HTMLElement>("[data-object-name]");
      if (!hit) return;
      const objectName = hit.dataset.objectName;
      if (!objectName) return;
      e.preventDefault();
      e.stopPropagation();
      vscode.postMessage({ type: "revealSource", objectName });
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  if (errorMsg) {
    return <ErrorOverlay message={errorMsg} />;
  }

  if (!controller || !src) {
    return <LoadingOverlay />;
  }

  return (
    // `key={deckGeneration}` only changes when the host signals a deck
    // identity swap (new document, refresh) — those cases unmount and
    // remount `<PptxPresentation>`, wiping currentSlide / zoom / pan /
    // search / dialog state that would otherwise leak from the previous
    // deck. Edit cycles on the same document keep the same key, so
    // `incrementalUpdate` continues to preserve UI state across the
    // setSrc → buildPptx → re-render sequence (the deck loader's
    // setCurrentSlide(1) / setZoom(1) / setPan(0) reset block stays
    // skipped within a generation).
    <PptxPresentation
      key={deckGeneration}
      controller={controller}
      name={name}
      src={src}
      incrementalUpdate
      invalidatedSlides={invalidatedSlides}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

function LoadingOverlay(): JSX.Element {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        flexDirection: "column",
        color: "var(--vscode-descriptionForeground, #888)",
        fontSize: 13,
      }}
      role="status"
      aria-live="polite"
    >
      <div
        style={{
          width: 32,
          height: 32,
          border: "3px solid var(--vscode-editorWidget-border, #555)",
          borderTopColor: "var(--vscode-progressBar-background, #0e70c0)",
          borderRadius: "50%",
          animation: "builder-spin 0.9s linear infinite",
        }}
        aria-hidden="true"
      />
      <style>{`@keyframes builder-spin { to { transform: rotate(360deg); } }`}</style>
      <div>Rendering preview…</div>
    </div>
  );
}

function ErrorOverlay({ message }: { message: string }): JSX.Element {
  return (
    <div
      style={{
        padding: 16,
        height: "100%",
        boxSizing: "border-box",
        overflow: "auto",
      }}
    >
      <div
        style={{
          background:
            "color-mix(in srgb, var(--vscode-errorForeground, #f48771) 12%, transparent)",
          border:
            "1px solid color-mix(in srgb, var(--vscode-errorForeground, #f48771) 55%, transparent)",
          borderRadius: 4,
          padding: "12px 14px",
          color: "var(--vscode-errorForeground, #f48771)",
          whiteSpace: "pre-wrap",
          fontFamily: "var(--vscode-editor-font-family, monospace)",
          fontSize: 12,
          lineHeight: 1.55,
        }}
      >
        <strong style={{ fontWeight: 700 }}>Error:</strong> {message}
      </div>
    </div>
  );
}

const root = document.getElementById("app");
if (root) {
  createRoot(root).render(<App />);
}
