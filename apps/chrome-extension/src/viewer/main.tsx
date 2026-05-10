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
  subscribeLocale,
  t,
  type SlideController,
} from "@slideglance/viewer";
// Bundle the viewer's worker chunk through THIS app's Vite pipeline
// so the resulting URL lives next to the extension's own bundle and
// the extension's vite-plugin-wasm can resolve `@slideglance/core`.
import PptxWorker from "@slideglance/viewer/dist/pptx-worker.js?worker";
import { parseViewerSrc } from "../shared/url-params.js";
import { EmptyState } from "./EmptyState.js";

// Inline folder-open icon — phosphor-icons isn't a direct dep of the
// extension and adding it just for one toolbar glyph would pull in
// the whole icon set. The path is the same `FolderOpen` shape the
// viewer uses elsewhere, simplified to a single 16×16 stroke.
function FolderOpenIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M245 110.6a16 16 0 0 0-13-6.6h-9V88a16 16 0 0 0-16-16h-69.3l-22-16.4A16 16 0 0 0 105.7 52H40a16 16 0 0 0-16 16v144a8 8 0 0 0 8 8h187.3a8 8 0 0 0 7.6-5.5l30.1-90.4a16 16 0 0 0-1.9-13.5ZM40 68h65.7l21.7 16.3a8 8 0 0 0 4.8 1.7H207v18H69.7a16 16 0 0 0-15.2 11l-14.5 43.5Zm173.6 136H43l27.2-81.5a0 0 0 0 1 0 0H231Z" />
    </svg>
  );
}

function App(): JSX.Element {
  const [controller, setController] = useState<SlideController | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [src, setSrc] = useState<Uint8Array | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Re-render whenever the active locale changes so the strings the
  // App itself emits (toolbar "Open file" label, the "loading…"
  // panel) follow the user's language switch in Settings. Without
  // this, only the children that subscribe internally
  // (EmptyState / PptxPresentation) update — the toolbarStart slot
  // sits in the parent's render output and stays frozen at the
  // locale active when App first rendered.
  const [, setLocaleTick] = useState(0);
  useEffect(() => subscribeLocale(() => setLocaleTick((n) => n + 1)), []);
  // True while a presentation is being loaded into memory — set by
  // both the `?src=…` URL fetch path and the local file-pick path.
  // Suppresses the EmptyState ("Open a .pptx file.") prompt during
  // the load window: the user already triggered the open, so the
  // upload prompt is jarring and confusing if it flashes back at
  // them while they wait for bytes to arrive.
  const [loading, setLoading] = useState<boolean>(
    () => parseViewerSrc(window.location.href) !== null,
  );
  // Bundled Google Fonts stylesheet contents — fetched once at startup
  // from the same `<link>` URL the extension's HTML loads for paint.
  // Forwarded to `controller.open()` so the worker's `FontFaceSet` has
  // the same fonts the main thread does, keeping canvas-based text
  // measurement aligned with the eventual paint.
  const [bundledFontDefsCss, setBundledFontDefsCss] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/assets/google-fonts.css");
        if (!res.ok) return;
        const css = await res.text();
        if (!cancelled) setBundledFontDefsCss(css);
      } catch {
        // Bundled-font failure is non-fatal — measurement just falls
        // back to OS metrics for unbundled families. Do not surface.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Spawn one viewer worker for the page lifetime.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const c = await createWorkerController(new PptxWorker());
      if (cancelled) {
        c.close();
        return;
      }
      setController(c);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadBuffer = useCallback((displayName: string, buf: Uint8Array) => {
    setName(displayName);
    setSrc(buf);
    setOpenCount((n) => n + 1);
  }, []);

  // On mount, check ?src — if present, fetch it with credentials.
  useEffect(() => {
    const remote = parseViewerSrc(window.location.href);
    if (!remote) return;
    const display = remote.split("/").pop()?.split("?")[0] ?? remote;
    void (async () => {
      try {
        const res = await fetch(remote, { credentials: "include" });
        if (!res.ok) {
          setError(`HTTP ${res.status} fetching ${remote}`);
          return;
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        loadBuffer(display, buf);
      } catch (err) {
        setError((err as Error).message ?? String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [loadBuffer]);

  const onFile = useCallback(
    async (file: File) => {
      // Flip `loading` BEFORE awaiting `arrayBuffer()` so the
      // EmptyState yields to the loading panel for the entire read.
      // For multi-megabyte decks the buffer read takes hundreds of
      // milliseconds — long enough for the user to notice if the
      // upload prompt is still on screen.
      setLoading(true);
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        loadBuffer(file.name, buf);
      } catch (err) {
        setError((err as Error).message ?? String(err));
      } finally {
        setLoading(false);
      }
    },
    [loadBuffer],
  );

  // Hidden <input type="file"> shared by the EmptyState button and
  // the in-toolbar "Open" button. Kept on the App-level so the file
  // picker stays alive across re-renders, and reset on each pick so
  // re-selecting the same file fires `onChange` again.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const onPickFromInput = useCallback(
    async (ev: React.ChangeEvent<HTMLInputElement>) => {
      const file = ev.target.files?.[0];
      // Reset before await so the user can pick the same file again
      // immediately after this load completes.
      ev.target.value = "";
      if (file) {
        await onFile(file);
      }
    },
    [onFile],
  );
  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  if (error) {
    return (
      <div style={errorWrapStyle}>
        <div style={{ maxWidth: 600 }}>
          <h2>Failed to load presentation</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>{error}</pre>
        </div>
      </div>
    );
  }

  if (!src) {
    // The user has already initiated a load (URL fetch or local
    // file pick) — render a minimal loading panel until the bytes
    // arrive instead of showing the EmptyState's upload prompt.
    if (loading) {
      return (
        <div style={loadingWrapStyle}>
          <div>{t("common.loading")}</div>
        </div>
      );
    }
    return <EmptyState onFile={onFile} />;
  }

  return (
    <>
      <PptxPresentation
        key={`${name ?? ""}::${openCount}`}
        controller={controller}
        name={name}
        src={src}
        bundledFontDefsCss={bundledFontDefsCss}
        toolbarStart={
          <button
            style={openButtonStyle}
            onClick={openFilePicker}
            title={t("viewer.openFile")}
            aria-label={t("viewer.openFile")}
          >
            <FolderOpenIcon />
            <span>{t("viewer.openFile")}</span>
          </button>
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pptx"
        style={{ display: "none" }}
        onChange={onPickFromInput}
      />
    </>
  );
}

const errorWrapStyle = {
  display: "grid",
  placeItems: "center",
  width: "100%",
  height: "100%",
  padding: 24,
  color: "var(--pptx-shell-fg, #ececec)",
  background: "var(--pptx-shell-bg, #0e0e10)",
  fontFamily: "system-ui, -apple-system, sans-serif",
} as const;

const loadingWrapStyle = {
  display: "grid",
  placeItems: "center",
  width: "100%",
  height: "100%",
  color: "var(--pptx-shell-fg, #ececec)",
  background: "var(--pptx-shell-bg, #0e0e10)",
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: 14,
} as const;

// Mirrors the iconButtonStyle the viewer uses for its built-in
// toolbar buttons — picked from CSS custom properties the shell sets
// so light / dark / high-contrast themes all flow through.
const openButtonStyle: CSSProperties = {
  height: 28,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  background: "transparent",
  color: "var(--pptx-shell-fg, #ececec)",
  border: "1px solid var(--pptx-shell-border, #2a2a30)",
  borderRadius: 4,
  cursor: "pointer",
  padding: "0 10px",
  marginRight: 8,
  font: "inherit",
  whiteSpace: "nowrap",
};

const container = document.getElementById("root");
if (!container) throw new Error("missing #root");
createRoot(container).render(<App />);
