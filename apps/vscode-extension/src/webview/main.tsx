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
 *  - host → webview  `{ type: 'status', message: string | null }`
 *      A build is still running (`string`) or has finished (`null`).
 *      Unlike `error` this leaves the deck on screen — a slow build is
 *      not a failed one, and the result still arrives.
 *
 *  - webview → host  `{ type: 'revealSource', objectName: string }`
 *      Click on a slide element with `data-object-name="node#N"`. Host
 *      resolves the source position and reveals the editor.
 *
 *  - webview → host  `{ type: 'ready' }`
 *      Sent once on mount so the host can flush any pending PPTX bytes
 *      it queued while the webview was still loading.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
  const [errorMsg, setErrorMsg] = useState<PreviewError | null>(null);
  // Host-reported progress for a build that outran the slow-render
  // notice threshold. Purely informational: the deck stays interactive
  // and the build's result still lands when it completes.
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  // Slides the host is rebuilding: an explicit list, or "all" for a
  // change every slide depends on. Empty array once the build lands.
  const [pendingSlides, setPendingSlides] = useState<number[] | "all">([]);
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
  // The page the reader is on, kept in a ref rather than state: it
  // changes on every navigation and nothing in this component's own
  // output depends on it, so state here would re-render the whole
  // viewer tree for a number only the remount path and the menu read.
  const currentSlideRef = useRef(1);
  const onSlideChange = useCallback((slide: number) => {
    currentSlideRef.current = slide;
  }, []);
  // Anchor + target of the open context menu, or null when closed.
  const [menu, setMenu] = useState<MenuState | null>(null);

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
          setErrorMsg({
            message: `Preview worker error: ${detail}`,
            kind: "internal",
          });
        });
        worker.addEventListener("messageerror", () => {
          if (cancelled) return;
          setErrorMsg({
            message: "Preview worker message could not be deserialized.",
            kind: "internal",
          });
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
        setErrorMsg({
          message: `Failed to start preview worker: ${msg}`,
          kind: "internal",
        });
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
        | {
            type: "error";
            message: string;
            kind?: "document" | "internal";
            issues?: BuildIssue[];
          }
        | { type: "status"; message: string | null }
        | { type: "pending"; slides: number[] | null };
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
        setErrorMsg({
          message: msg.message,
          kind: msg.kind ?? "internal",
          issues: msg.issues,
        });
      } else if (msg.type === "status") {
        setStatusMsg(msg.message);
      } else if (msg.type === "pending") {
        // `null` means the host is rebuilding the whole deck; the
        // thumbnails resolve that against the live slide count.
        setPendingSlides(msg.slides ?? "all");
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

  // Right-click menu. Two shapes: on a slide element it offers the
  // copy actions plus the render actions; on the surrounding canvas
  // only the render actions. The browser's own menu is suppressed
  // either way — inside a webview it offers nothing that applies here.
  useEffect(() => {
    function onContextMenu(e: MouseEvent): void {
      const target = e.target as Element | null;
      e.preventDefault();
      // A thumbnail wins over the shape inside it. The tile draws the
      // same SVG the stage does, so both selectors match, and the one
      // the reader meant is the page they pointed at.
      const tile = target?.closest<HTMLElement>("[data-slide-number]") ?? null;
      const tileSlide = Number(tile?.dataset.slideNumber);
      const onThumbnail = Number.isFinite(tileSlide) && tileSlide > 0;
      const hit = target?.closest<HTMLElement>("[data-object-name]") ?? null;
      const objectName = hit?.dataset.objectName;
      // `textContent` is empty when the viewer is painting glyph
      // outlines rather than `<text>` runs; the menu says so rather
      // than offering a copy that yields nothing.
      const text = hit ? (hit.textContent ?? "").trim() : "";
      setMenu({
        x: e.clientX,
        y: e.clientY,
        slide: onThumbnail ? tileSlide : currentSlideRef.current,
        onThumbnail,
        ...(onThumbnail || !objectName ? {} : { objectName }),
        text: onThumbnail ? "" : text,
      });
    }
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // Any click outside, Escape, or scroll closes the menu — the same
  // dismissal a native menu has.
  //
  // The listener runs in the capture phase because the source-reveal
  // handler above calls `stopPropagation()` on clicks that land on a
  // slide shape. A bubble-phase listener never hears those, and the
  // menu would sit open over the deck the user just clicked.
  //
  // Clicks inside the menu are left alone: each item closes the menu
  // itself once its action has run, so dismissing here would race the
  // item's own handler for no gain.
  useEffect(() => {
    if (!menu) return;
    const close = (e?: Event): void => {
      const target = e?.target;
      if (
        target instanceof Element &&
        target.closest(`[${MENU_MARKER_ATTR}]`)
      ) {
        return;
      }
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMenu(null);
    };
    const dismiss = (): void => setMenu(null);
    document.addEventListener("click", close, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", dismiss);
    document.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("click", close, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", dismiss);
      document.removeEventListener("scroll", dismiss, true);
    };
  }, [menu]);

  // A broken document does not take the deck away. The bytes on screen
  // are the last build that succeeded, and keeping them there is what
  // an author wants while fixing XML — the alternative unmounts the
  // viewer, throws away the page they were reading, the zoom, and the
  // slide cache, and makes recovery depend on a clean remount.
  //
  // The full-screen form survives for the one case where there is
  // nothing behind the message: the first build of a document failed,
  // so no deck was ever shown.
  if (errorMsg && (!controller || !src)) {
    return <ErrorOverlay error={errorMsg} />;
  }

  if (!controller || !src) {
    return <LoadingOverlay note={statusMsg} />;
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
    <>
      <PptxPresentation
        key={deckGeneration}
        controller={controller}
        name={name}
        src={src}
        incrementalUpdate
        invalidatedSlides={invalidatedSlides}
        pendingSlides={pendingSlides}
        // Read at render, which for this prop is exactly the remount
        // the host asked for: the viewer consumes it on mount and on
        // deck reset, so the reader lands back on the page they were
        // on instead of page 1.
        initialSlide={currentSlideRef.current}
        onSlideChange={onSlideChange}
        toolbarEnd={<RenderActions currentSlideRef={currentSlideRef} />}
        style={{ width: "100%", height: "100%" }}
      />
      {statusMsg ? <StatusBadge message={statusMsg} /> : null}
      {errorMsg ? (
        <ErrorPanel error={errorMsg} onDismiss={() => setErrorMsg(null)} />
      ) : null}
      {menu ? <ContextMenu menu={menu} onClose={() => setMenu(null)} /> : null}
    </>
  );
}

/** Marks the menu subtree so the outside-click handler can skip it. */
const MENU_MARKER_ATTR = "data-preview-menu";

interface MenuState {
  x: number;
  y: number;
  /**
   * Page the menu acts on. The page being read, except on a thumbnail
   * — there the reader picked a page explicitly and it is that one.
   */
  slide: number;
  /**
   * True when the menu opened on a thumbnail. The tile renders the
   * slide's own SVG, so a shape is under the cursor there too, but the
   * reader pointed at a page and the menu answers about the page.
   */
  onThumbnail: boolean;
  /** `node#N` of the shape under the cursor; absent on the canvas. */
  objectName?: string;
  /** Rendered text inside that shape; empty in glyph-outline mode. */
  text: string;
}

/** Ask the host to rebuild, and say which pages should be repainted. */
function requestRerender(scope: "slide" | "all", slide: number): void {
  vscode.postMessage({ type: "rerender", scope, slide });
}

/**
 * Toolbar controls for repainting.
 *
 * A build is deterministic, so a rebuild the deck did not ask for is
 * normally pointless — these exist for the times the screen and the
 * source have drifted anyway, which is exactly when the reader cannot
 * tell whether what they are looking at is current.
 */
function RenderActions({
  currentSlideRef,
}: {
  currentSlideRef: { current: number };
}): JSX.Element {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <button
        onClick={() => requestRerender("slide", currentSlideRef.current)}
        title="Rebuild the deck and repaint the page you are on"
        style={toolbarButtonStyle}
      >
        Render page
      </button>
      <button
        onClick={() => requestRerender("all", currentSlideRef.current)}
        title="Rebuild the deck and repaint every page, keeping your place"
        style={toolbarButtonStyle}
      >
        Render all
      </button>
    </span>
  );
}

const toolbarButtonStyle: CSSProperties = {
  background: "none",
  border: "1px solid var(--vscode-editorWidget-border, #454545)",
  borderRadius: 3,
  padding: "2px 8px",
  color: "var(--vscode-foreground, #ccc)",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  whiteSpace: "nowrap",
};

/**
 * Right-click menu.
 *
 * On a shape it offers the two copies — one aimed at a person, one at
 * an LLM that has to be told where in the source to edit — plus the
 * render actions. On the canvas only the render actions apply.
 */
function ContextMenu({
  menu,
  onClose,
}: {
  menu: MenuState;
  onClose: () => void;
}): JSX.Element {
  const slide = menu.slide;
  const items: {
    label: string;
    hint?: string;
    disabled?: boolean;
    run: () => void;
  }[] = [];

  if (menu.onThumbnail) {
    items.push({
      label: `Copy edit prompt for page ${slide}`,
      hint: "deck, page, file, lines, template path",
      run: () => vscode.postMessage({ type: "copyPagePrompt", slide }),
    });
  } else if (menu.objectName !== undefined) {
    items.push({
      label: "Copy edit prompt",
      hint: "page, file, lines, template path",
      run: () =>
        vscode.postMessage({
          type: "copyPrompt",
          objectName: menu.objectName,
          slide,
          text: menu.text,
        }),
    });
    items.push({
      label: "Copy text",
      ...(menu.text
        ? {}
        : { hint: "no text — the viewer is drawing outlines" }),
      disabled: !menu.text,
      run: () => vscode.postMessage({ type: "copyText", text: menu.text }),
    });
  }
  items.push({
    label: menu.onThumbnail ? `Render page ${slide}` : "Render page",
    run: () => requestRerender("slide", slide),
  });
  items.push({ label: "Render all", run: () => requestRerender("all", slide) });

  return (
    <div
      role="menu"
      {...{ [MENU_MARKER_ATTR]: "" }}
      style={{
        position: "fixed",
        left: Math.min(menu.x, window.innerWidth - 260),
        top: Math.min(menu.y, window.innerHeight - items.length * 28 - 12),
        zIndex: 40,
        minWidth: 220,
        padding: 4,
        borderRadius: 4,
        background: "var(--vscode-menu-background, #252526)",
        border: "1px solid var(--vscode-menu-border, #454545)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.45)",
        fontSize: 12,
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            item.run();
            onClose();
          }}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            background: "none",
            border: "none",
            borderRadius: 3,
            padding: "5px 10px",
            font: "inherit",
            color: item.disabled
              ? "var(--vscode-disabledForeground, #7f7f7f)"
              : "var(--vscode-menu-foreground, #ccc)",
            cursor: item.disabled ? "default" : "pointer",
          }}
        >
          {item.label}
          {item.hint ? (
            <span
              style={{
                marginLeft: 8,
                opacity: 0.6,
                fontSize: 11,
              }}
            >
              {item.hint}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * Corner badge for a build that is still running. Non-modal and
 * click-through so the deck underneath stays usable.
 */
function StatusBadge({ message }: { message: string }): JSX.Element {
  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        maxWidth: 360,
        padding: "8px 12px",
        borderRadius: 4,
        background: "var(--vscode-editorWidget-background, #252526)",
        border: "1px solid var(--vscode-editorWidget-border, #454545)",
        color: "var(--vscode-descriptionForeground, #999)",
        fontSize: 12,
        lineHeight: 1.5,
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.35)",
        pointerEvents: "none",
        zIndex: 10,
      }}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}

function LoadingOverlay({ note }: { note?: string | null }): JSX.Element {
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
      {note ? (
        <div style={{ maxWidth: 360, textAlign: "center" }}>{note}</div>
      ) : null}
    </div>
  );
}

/** One problem the parser reported, with where to find it. */
interface BuildIssue {
  text: string;
  file?: string;
  line?: number;
}

interface PreviewError {
  message: string;
  /**
   * `"document"` — the deck's XML is wrong; the list below says where.
   * `"internal"` — the extension or the builder failed, and editing the
   * deck will not help.
   */
  kind: "document" | "internal";
  issues?: BuildIssue[];
}

/** Issues rendered before the list collapses behind a "show all". */
const ISSUE_PREVIEW_COUNT = 30;

function baseName(file: string): string {
  const parts = file.split(/[\\/]/);
  return parts[parts.length - 1] || file;
}

/**
 * The failure screen.
 *
 * Two things it has to answer at a glance: is this my document or is the
 * tooling broken, and where do I go to fix it. A parse failure lists one
 * clickable row per problem; anything else says plainly that the deck is
 * not at fault and keeps the raw text for a bug report.
 */
/**
 * Problems from a build that failed, docked over a deck that is still
 * on screen.
 *
 * The deck behind it is the last build that succeeded, which the
 * heading says outright — a reader who is not told will take a stale
 * page for a current one and conclude their fix did nothing.
 */
function ErrorPanel({
  error,
  onDismiss,
}: {
  error: PreviewError;
  onDismiss: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const issues = error.issues ?? [];
  const isDocument = error.kind === "document";
  const shown = expanded ? issues : issues.slice(0, ISSUE_PREVIEW_COUNT);
  const hidden = issues.length - shown.length;

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 30,
        maxHeight: "45%",
        overflow: "auto",
        padding: "10px 12px",
        borderRadius: 4,
        background: "var(--vscode-editorWidget-background, #252526)",
        border:
          "1px solid color-mix(in srgb, var(--vscode-errorForeground, #f48771) 55%, transparent)",
        color: "var(--vscode-foreground, #ccc)",
        fontSize: 12,
        lineHeight: 1.55,
        boxShadow: "0 2px 16px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div
          style={{
            color: "var(--vscode-errorForeground, #f48771)",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {isDocument
            ? issues.length > 0
              ? `${issues.length} problem${issues.length > 1 ? "s" : ""} to fix`
              : "This deck could not be read"
            : "The preview failed to build"}
        </div>
        <div style={{ opacity: 0.8, flex: 1 }}>
          {isDocument
            ? "The pages below are the last build that succeeded. Fix these and the preview rebuilds on save."
            : "This is a failure in the extension or the builder, not in your document."}
        </div>
        <button
          onClick={onDismiss}
          title="Hide until the next build"
          style={{
            background: "none",
            border: "none",
            padding: "0 4px",
            color: "var(--vscode-descriptionForeground, #999)",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          Hide
        </button>
      </div>

      {isDocument && issues.length > 0 ? (
        <ul
          style={{
            listStyle: "none",
            margin: "8px 0 0",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {shown.map((issue, i) => (
            <IssueRow
              key={`${issue.file ?? ""}:${issue.line ?? 0}:${i}`}
              issue={issue}
            />
          ))}
          {hidden > 0 ? (
            <li>
              <button
                onClick={() => setExpanded(true)}
                style={{
                  marginTop: 6,
                  background: "none",
                  border: "none",
                  padding: "4px 6px",
                  color: "var(--vscode-textLink-foreground, #3794ff)",
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                Show {hidden} more
              </button>
            </li>
          ) : null}
        </ul>
      ) : (
        <pre
          style={{
            margin: "8px 0 0",
            whiteSpace: "pre-wrap",
            fontFamily: "var(--vscode-editor-font-family, monospace)",
            color: "var(--vscode-descriptionForeground, #999)",
          }}
        >
          {error.message}
        </pre>
      )}
    </div>
  );
}

function ErrorOverlay({ error }: { error: PreviewError }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const issues = error.issues ?? [];
  const document = error.kind === "document";
  const shown = expanded ? issues : issues.slice(0, ISSUE_PREVIEW_COUNT);
  const hidden = issues.length - shown.length;

  return (
    <div
      style={{
        padding: 16,
        height: "100%",
        boxSizing: "border-box",
        overflow: "auto",
        color: "var(--vscode-foreground, #ccc)",
        fontSize: 12,
        lineHeight: 1.55,
      }}
    >
      <div
        style={{
          background:
            "color-mix(in srgb, var(--vscode-errorForeground, #f48771) 10%, transparent)",
          border:
            "1px solid color-mix(in srgb, var(--vscode-errorForeground, #f48771) 45%, transparent)",
          borderRadius: 4,
          padding: "12px 14px",
        }}
      >
        <div
          style={{
            color: "var(--vscode-errorForeground, #f48771)",
            fontWeight: 600,
            fontSize: 13,
            marginBottom: 4,
          }}
        >
          {document
            ? issues.length > 0
              ? `This deck has ${issues.length} problem${issues.length > 1 ? "s" : ""} to fix`
              : "This deck could not be read"
            : "The preview failed to build"}
        </div>
        <div style={{ opacity: 0.85 }}>
          {document
            ? "The XML is not valid, so nothing was rendered. Fix the entries below and the preview rebuilds on save."
            : "This is a failure in the extension or the builder, not in your document. Editing the deck will not clear it — the message below belongs in a bug report."}
        </div>
      </div>

      {document && issues.length > 0 ? (
        <ul
          style={{
            listStyle: "none",
            margin: "12px 0 0",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {shown.map((issue, i) => (
            <IssueRow
              key={`${issue.file ?? ""}:${issue.line ?? 0}:${i}`}
              issue={issue}
            />
          ))}
          {hidden > 0 ? (
            <li>
              <button
                onClick={() => setExpanded(true)}
                style={{
                  marginTop: 6,
                  background: "none",
                  border: "none",
                  padding: "4px 6px",
                  color: "var(--vscode-textLink-foreground, #3794ff)",
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                Show {hidden} more
              </button>
            </li>
          ) : null}
        </ul>
      ) : (
        <pre
          style={{
            margin: "12px 0 0",
            whiteSpace: "pre-wrap",
            fontFamily: "var(--vscode-editor-font-family, monospace)",
            color: "var(--vscode-descriptionForeground, #999)",
          }}
        >
          {error.message}
        </pre>
      )}
    </div>
  );
}

/**
 * One problem. Clicking opens the file at the line when the parser knew
 * one; without a location the row is plain text rather than a link that
 * goes nowhere.
 */
function IssueRow({ issue }: { issue: BuildIssue }): JSX.Element {
  const locatable = issue.line !== undefined;
  const location = locatable
    ? `${issue.file ? baseName(issue.file) : "line"} ${issue.line}`
    : null;

  const body = (
    <>
      {location ? (
        <span
          style={{
            flex: "0 0 auto",
            fontFamily: "var(--vscode-editor-font-family, monospace)",
            color: "var(--vscode-textLink-foreground, #3794ff)",
            textDecoration: "underline",
          }}
          title={issue.file}
        >
          {location}
        </span>
      ) : null}
      <span style={{ color: "var(--vscode-foreground, #ccc)" }}>
        {issue.text}
      </span>
    </>
  );

  const rowStyle: CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "baseline",
    width: "100%",
    textAlign: "left",
    padding: "3px 6px",
    borderRadius: 3,
    background: "none",
    border: "none",
    font: "inherit",
    fontSize: 12,
  };

  if (!locatable) {
    return (
      <li>
        <div style={rowStyle}>{body}</div>
      </li>
    );
  }

  return (
    <li>
      <button
        style={{ ...rowStyle, cursor: "pointer" }}
        onClick={() =>
          vscode.postMessage({
            type: "revealAt",
            file: issue.file,
            line: issue.line,
          })
        }
        title={
          issue.file
            ? `Open ${issue.file}:${issue.line}`
            : `Go to line ${issue.line}`
        }
      >
        {body}
      </button>
    </li>
  );
}

const root = document.getElementById("app");
if (root) {
  createRoot(root).render(<App />);
}
