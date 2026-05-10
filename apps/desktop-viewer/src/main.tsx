import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  PptxPresentation,
  t,
  subscribeLocale,
  type SlideController,
  type SlideMeta,
  type RenderedSlide,
} from "@slideglance/viewer";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FolderOpen } from "@phosphor-icons/react";

interface DocSummary {
  name: string;
  slideCount: number;
}

/**
 * Tauri-backed `SlideController`.
 *
 * On macOS, the `pptx://` custom URI scheme handler registered by
 * `register_uri_scheme_protocol` is reachable from document-style
 * loads (`<image href="pptx://...">`) but NOT from JS `fetch()`. We
 * therefore route slide SVGs through the IPC bridge and let media
 * URLs resolve through the document loader. The cost is one extra
 * UTF-8 string serialization per slide; acceptable for typical PPTX
 * payloads.
 */
function createTauriController(): SlideController {
  let renderCount = 0;
  return {
    async open(_bytes: Uint8Array) {
      const count = await invoke<number>("slide_count");
      // The Tauri Rust side does not currently surface font metadata —
      // the controller contract widened to carry usage / failure / decoded
      // arrays for the web side, but the desktop renderer renders slides
      // directly via the system font stack so the lists stay empty here.
      return {
        slideCount: count,
        fontDefs: "",
        fontUsage: [],
        fontLoadFailures: [],
        decodedFonts: [],
      };
    },
    async renderSlide(slide: number): Promise<RenderedSlide> {
      const id = ++renderCount;
      const t0 = performance.now();
      // eslint-disable-next-line no-console
      console.log(`[viewer-desktop] renderSlide#${id} → ${slide} (in flight)`);
      try {
        const svg = await invoke<string>("render_slide_svg", { slide });
        const elapsed = performance.now() - t0;
        // eslint-disable-next-line no-console
        console.log(
          `[viewer-desktop] renderSlide#${id} ← ${slide} ${elapsed.toFixed(1)}ms (${svg.length} chars)`,
        );
        return { slide, svg, media: new Map() };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[viewer-desktop] renderSlide#${id} ✗ ${slide} after ${(performance.now() - t0).toFixed(1)}ms`,
          err,
        );
        throw err;
      }
    },
    close() {
      void invoke("close_pptx").catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn("close_pptx failed", err);
      });
    },
  };
}

// Toggle the static loading overlay declared in index.html. Bypassing
// React's reconcile / commit cycle means the indicator paints in the
// very next frame after the user picks a file — keeping the spinner
// in the React tree adds a full PptxPresentation reconcile to the
// critical path which on large decks shows up as a perceptible "click
// → blank → spinner" gap.
function showLoadingOverlay(label: string): void {
  const text = document.getElementById("pptx-loading-text");
  if (text) text.textContent = label;
  document.body.dataset.pptxLoading = "1";
}

function hideLoadingOverlay(): void {
  delete document.body.dataset.pptxLoading;
}

function ViewerDesktopApp(): JSX.Element {
  const [name, setName] = useState<string | null>(null);
  const [slideCount, setSlideCount] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, setLocaleTick] = useState(0);
  // Bumped every successful `open_pptx_path` so the PptxPresentation
  // child gets a brand-new React key and remounts from scratch.
  const [openCount, setOpenCount] = useState<number>(0);

  useEffect(() => subscribeLocale(() => setLocaleTick((n) => n + 1)), []);

  // One controller for the lifetime of the app. The native side keeps
  // the parsed document; the controller is just an IPC stub.
  const controllerRef = useRef<SlideController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createTauriController();
  }
  const controller = controllerRef.current;

  const openPath = useCallback(async (path: string): Promise<void> => {
    const t0 = performance.now();
    const basename = path.split("/").pop() ?? path;
    const label = t("playground.loadingFile", { name: basename });
    // Synchronous DOM mutation FIRST — before any React state change
    // or microtask boundary. We do NOT call setErrorMsg(null) here:
    // PptxPresentation isn't memoized, so any setState on this shell
    // forces a full re-render of the deck stage / sidebar / ribbon —
    // and that reconcile sits on the main thread between us and the
    // first paint. Stale errors get cleared post-success below.
    showLoadingOverlay(label);
    const tShow = performance.now();
    // eslint-disable-next-line no-console
    console.log(
      `[viewer-desktop] openPath ${path} | overlay+${(tShow - t0).toFixed(1)}ms`,
    );
    try {
      const summary = await invoke<DocSummary>("open_pptx_path", { path });
      const tParsed = performance.now();
      // eslint-disable-next-line no-console
      console.log(
        `[viewer-desktop] open_pptx_path OK ${summary.name} (${summary.slideCount} slides) | parse+${(tParsed - tShow).toFixed(1)}ms total+${(tParsed - t0).toFixed(1)}ms`,
      );
      setName(summary.name);
      setSlideCount(summary.slideCount);
      setOpenCount((n) => n + 1);
      setErrorMsg(null);
      // Loading overlay stays up until the first slide actually
      // paints — `<PptxPresentation onReady>` calls
      // `hideLoadingOverlay()` when its SVG mount effect appends the
      // slide to the DOM. Clearing earlier would flash the empty
      // stage between IPC return and the first slide render's IPC +
      // paint round-trip.
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[viewer-desktop] open_pptx_path failed", err);
      setErrorMsg(`${err as string}`);
      hideLoadingOverlay();
    }
  }, []);

  const openDialog = useCallback(async (): Promise<void> => {
    const t0 = performance.now();
    // eslint-disable-next-line no-console
    console.log("[viewer-desktop] openDialog (invoking open_pptx_dialog)");
    try {
      const path = await invoke<string | null>("open_pptx_dialog");
      const tDialog = performance.now();
      // eslint-disable-next-line no-console
      console.log(
        `[viewer-desktop] open_pptx_dialog returned ${path} | dialog+${(tDialog - t0).toFixed(1)}ms`,
      );
      if (path) await openPath(path);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[viewer-desktop] open_pptx_dialog failed", err);
      setErrorMsg(`${err as string}`);
    }
  }, [openPath]);

  // OS event channels:
  //   - `menu://open-path` fires for Open Recent / CLI-arg opens —
  //     payload is the path string we forward straight to `openPath`.
  //   - `menu://open` fires for the File → Open… menu item (Cmd+O on
  //     macOS, Ctrl+O on Windows/Linux). No payload — we just trigger
  //     the same native picker as the toolbar's Open button.
  //   - `tauri://drag-drop` fires when the user drops a file onto the
  //     window. We pick the first `.pptx` and open it.
  //   - `pptx://picked` fires from `open_pptx_dialog`'s callback the
  //     moment the OS panel returns a path. The command's IPC reply
  //     can lag this callback by several seconds on macOS (Cocoa ↔
  //     tokio handoff), so we use this event to flip the loading
  //     overlay on immediately instead of waiting for `await invoke()`.
  useEffect(() => {
    const unsubs: UnlistenFn[] = [];
    let cancelled = false;
    void (async () => {
      const offMenuPath = await listen<string>("menu://open-path", (e) => {
        void openPath(e.payload);
      });
      if (cancelled) {
        offMenuPath();
        return;
      }
      unsubs.push(offMenuPath);
      const offMenuOpen = await listen("menu://open", () => {
        void openDialog();
      });
      if (cancelled) {
        offMenuOpen();
        return;
      }
      unsubs.push(offMenuOpen);
      const offDrop = await listen<{ paths: string[] }>(
        "tauri://drag-drop",
        (e) => {
          const first = e.payload.paths.find((p) =>
            p.toLowerCase().endsWith(".pptx"),
          );
          if (first) void openPath(first);
        },
      );
      if (cancelled) {
        offDrop();
        return;
      }
      unsubs.push(offDrop);
      const offPicked = await listen<string>("pptx://picked", (e) => {
        // eslint-disable-next-line no-console
        console.log("[viewer-desktop] pptx://picked", e.payload);
        const basename = e.payload.split("/").pop() ?? e.payload;
        showLoadingOverlay(t("playground.loadingFile", { name: basename }));
      });
      if (cancelled) {
        offPicked();
        return;
      }
      unsubs.push(offPicked);
    })();
    return () => {
      cancelled = true;
      for (const off of unsubs) off();
    };
  }, [openPath, openDialog]);

  // Per-slide metadata via IPC. The shell calls this hook only after
  // each slide's SVG arrives, so we never speculatively prefetch
  // metadata for the entire deck.
  const resolveMeta = useCallback(
    async (slide: number): Promise<SlideMeta | null> => {
      try {
        return await invoke<SlideMeta | null>("slide_meta", { slide });
      } catch {
        return null;
      }
    },
    [],
  );

  const toolbarStart = useMemo(
    () => (
      <button
        style={openButtonStyle}
        onClick={() => void openDialog()}
        title={t("file.open")}
        aria-label={t("file.open")}
      >
        <FolderOpen size={16} weight="regular" />
        <span>{t("file.open")}</span>
      </button>
    ),
    [openDialog],
  );

  return (
    <div style={shellStyle}>
      <PptxPresentation
        // Re-key on every deck swap so the entire shell — including
        // every Thumbnail's local `svg` state and any in-flight task
        // resolutions — tears down and starts fresh. `name` alone
        // wasn't enough because two different files can share a
        // basename ("index.pptx") and would slip through; pairing it
        // with a load-counter forces a fresh instance every open.
        key={`${name ?? ""}::${openCount}`}
        controller={controller}
        name={name}
        slideCount={slideCount}
        toolbarStart={toolbarStart}
        resolveMeta={resolveMeta}
        // Native host: every slide render is a synchronous IPC + JSON
        // serialization roundtrip. Eagerly prefetching all slides
        // stalls the shell for ~minutes on large decks; lazy-fetch
        // on navigation / on-demand for Print/PDF/Slideshow is the
        // right tradeoff here. Browser hosts (worker-backed) keep
        // the prefetch.
        noPrefetch={true}
        // Drop the loading overlay only when the first slide paints —
        // covers parse + first slide render + DOM mount end-to-end so
        // the user sees the spinner for the full perceived wait, not
        // just the IPC parse phase.
        onReady={hideLoadingOverlay}
      />
      {errorMsg && (
        <div style={errorBannerStyle} role="alert">
          <span>{t("viewer.error", { message: errorMsg })}</span>
          <button
            style={errorDismissStyle}
            onClick={() => setErrorMsg(null)}
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

const openButtonStyle: CSSProperties = {
  background: "var(--pptx-shell-active, #3a3a44)",
  color: "var(--pptx-shell-fg, #ececec)",
  border: "1px solid var(--pptx-shell-border, #3a3a44)",
  borderRadius: 4,
  padding: "4px 12px",
  font: "inherit",
  cursor: "pointer",
  minHeight: 28,
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

const shellStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  display: "block",
};

const errorBannerStyle: CSSProperties = {
  position: "absolute",
  top: 12,
  left: "50%",
  transform: "translateX(-50%)",
  background: "var(--pptx-shell-error-bg, #3a1f1f)",
  color: "var(--pptx-shell-error-fg, #ffd1d1)",
  border: "1px solid var(--pptx-shell-error-border, #ff5566)",
  borderRadius: 6,
  padding: "8px 12px",
  fontSize: 12,
  fontFamily: "system-ui, sans-serif",
  display: "flex",
  alignItems: "center",
  gap: 8,
  maxWidth: "70%",
  zIndex: 1000,
  boxShadow: "0 4px 16px var(--pptx-shell-shadow, rgba(0, 0, 0, 0.5))",
};

const errorDismissStyle: CSSProperties = {
  background: "transparent",
  color: "inherit",
  border: "1px solid var(--pptx-shell-error-border, #ff5566)",
  borderRadius: 4,
  padding: "0 6px",
  cursor: "pointer",
  fontSize: 11,
  marginLeft: 8,
};

// Diagnostic: every code-path on the way to a working window logs a
// breadcrumb. If the user reports "console is empty" we can pinpoint
// whether the bundle was even evaluated, whether React mounted, or
// whether the Tauri internals were injected.
// eslint-disable-next-line no-console
console.log("[viewer-desktop] bundle evaluated", {
  href: window.location.href,
  hasTauri: typeof (window as unknown as { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__,
  ua: navigator.userAgent,
});
window.addEventListener("error", (ev) => {
  // eslint-disable-next-line no-console
  console.error("[viewer-desktop] window error", ev.message, ev.error);
});
window.addEventListener("unhandledrejection", (ev) => {
  // eslint-disable-next-line no-console
  console.error("[viewer-desktop] unhandled rejection", ev.reason);
});

const container = document.getElementById("root");
if (!container) {
  const fatal = document.createElement("pre");
  fatal.style.cssText = "color:#fff;padding:24px;font:13px monospace";
  fatal.textContent = "[viewer-desktop] FATAL: missing #root container";
  document.body.appendChild(fatal);
  throw new Error("missing #root container");
}
// eslint-disable-next-line no-console
console.log("[viewer-desktop] mounting React");
try {
  createRoot(container).render(<ViewerDesktopApp />);
  // eslint-disable-next-line no-console
  console.log("[viewer-desktop] React mounted");
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("[viewer-desktop] React mount failed", err);
  const fatal = document.createElement("pre");
  fatal.style.cssText = "color:#f55;padding:24px;font:13px monospace";
  fatal.textContent = `[viewer-desktop] React mount failed:\n${(err as Error).stack ?? err}`;
  container.replaceChildren(fatal);
}
