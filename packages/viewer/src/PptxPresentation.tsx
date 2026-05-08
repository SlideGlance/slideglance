import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  extractFontStyleCss,
  parseAspect,
  prepareSvg,
  uniquifyIds,
} from "./svg-utils.js";
import type {
  RenderedSlide,
  SlideController,
  SlideMeta,
  SlideSvg,
  TypefaceUsage,
} from "./types.js";
import { GridView } from "./presentation/GridView.js";
import { NotesPanel } from "./presentation/NotesPanel.js";
import { ThumbnailSidebar } from "./presentation/Thumbnail.js";
import { SlideshowOverlay } from "./presentation/SlideshowOverlay.js";
import { StatusBar } from "./presentation/StatusBar.js";
import { Toolbar } from "./presentation/Toolbar.js";
import { useKeyboardShortcuts } from "./presentation/use-keyboard-shortcuts.js";
import { usePrintPdfExport } from "./presentation/use-print-pdf-export.js";
import { useRulerGeometry } from "./presentation/use-ruler-geometry.js";
import { useSelectionStateMachine } from "./presentation/use-selection-state-machine.js";
import {
  RULER_SIZE,
  SHELL_GLOBAL_CSS,
  bodyStyle,
  iconButtonStyle,
  loadingOverlayStyle,
  loadingSpinnerStyle,
  loadingTextStyle,
  overlayStyle,
  progressBackdropStyle,
  progressBarFillStyle,
  progressBarIndeterminateStyle,
  progressBarTrackStyle,
  progressCounterStyle,
  progressHostStyle,
  progressPanelStyle,
  progressStepStyle,
  progressTitleStyle,
  rootStyle,
  rulerCornerStyle,
  rulerHStyle,
  rulerVStyle,
  searchDrawerStyle,
  searchEmptyStyle,
  searchHeaderStyle,
  searchHitNumStyle,
  searchInputStyle,
  searchItemStyle,
  searchListStyle,
  sidebarResizerStyle,
  sidebarStyle,
  stageAreaStyle,
  stageStyle,
  stageWrapStyle,
} from "./presentation/styles.js";
import type { CachedSlide } from "./presentation/types.js";
import { Ruler } from "./ui/Ruler.js";
import { SettingsDialog } from "./ui/SettingsDialog.js";
import { SectionNav } from "./ui/SectionNav.js";
import {
  SelectionOverlay,
} from "./ui/SelectionOverlay.js";
import { ShortcutsDialog } from "./ui/ShortcutsDialog.js";
// FontUsageIndicator is now mounted inside `presentation/StatusBar.tsx`.
import { searchSlides, type SearchHit } from "./ui/search.js";
import { inlineMediaAsDataUrls } from "./ui/media-inline.js";
// Print + PDF export top-level handlers live in
// `presentation/use-print-pdf-export.ts`.
import {
  applyTheme,
  detectSystemTheme,
  subscribeSystemTheme,
  dark,
  light,
  highContrast,
  type ThemeVars,
} from "./ui/themes.js";
import {
  clampSidebarWidth,
  loadSettings,
  saveSettings,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  subscribeSettings,
  type ThemeMode,
  type ViewerSettings,
} from "./ui/settings.js";
import { subscribeLocale, t } from "./ui/i18n.js";
import { X } from "@phosphor-icons/react";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
/** Width of the sidebar resize handle (CSS px). The full body grid
 * dedicates exactly this much horizontal space to the splitter so the
 * stage area's width tracks `sidebarWidth + RESIZER_WIDTH`. */
const SIDEBAR_RESIZER_WIDTH = 6;
// `RULER_SIZE` and the rest of the shell's CSS-in-JS constants live
// in `presentation/styles.ts`. The same module also exports
// `SHELL_GLOBAL_CSS` — the global stylesheet the shell mounts once
// per render to drive scrollbar theming, slideshow corner-nav fade-
// in, the loading-overlay spinner keyframes, and reset of native
// focus / touch chrome on shell buttons.
//
// Sub-components (`Thumbnail`, `NotesPanel`, `GridView`) live in
// `presentation/{Thumbnail,NotesPanel,GridView}.tsx` and import
// from `presentation/styles.ts` directly.

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Build the tooltip for deck-wide actions (Print / PDF / Slideshow)
 * so the user can see *why* the button is disabled — empty deck vs.
 * still-prefetching — instead of just a dead control.
 */
function deckGateTitle(base: string, ready: boolean, slideCount: number): string {
  if (slideCount === 0) return t("output.gateLoadFirst");
  if (!ready) return t("output.gatePreparing", { current: 0, total: slideCount });
  return base;
}

type ThemeName = "dark" | "light" | "high-contrast";
const THEME_TABLE: Record<ThemeName, ThemeVars> = {
  dark,
  light,
  "high-contrast": highContrast,
};
function resolveTheme(mode: ThemeMode): ThemeName {
  if (mode === "auto") return detectSystemTheme();
  return mode;
}

interface SlideMetaResolver {
  (slide: number): Promise<SlideMeta | null> | SlideMeta | null;
}

export interface PptxPresentationProps {
  controller: SlideController | null;
  name?: string | null;
  slideCount?: number;
  src?: Uint8Array | ArrayBuffer | string | null;
  className?: string;
  style?: CSSProperties;
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
  resolveMeta?: SlideMetaResolver;
  /**
   * Disable the deck-wide background prefetch.
   *
   * The viewer normally walks every slide in the background after the
   * deck loads so deck-wide actions (Print / PDF / Slideshow / Search)
   * are instant. On native hosts (Tauri viewer-desktop) every render
   * is a synchronous IPC roundtrip plus a JSON-string serialization of
   * the SVG, so prefetching all 100+ slides eagerly stalls the shell
   * for a long time before the first slide even paints.
   *
   * When `noPrefetch` is true:
   * - Slides are rendered lazily — only when navigated to.
   * - Print / PDF / Slideshow / Search trigger their own
   *   `ensureAllSlidesRendered()` on demand (the gate that hides the
   *   buttons until the prefetch finishes is removed).
   *
   * Browser hosts (worker-backed) keep prefetching by default because
   * the worker is concurrent with the main thread.
   */
  noPrefetch?: boolean;
  /**
   * Fired exactly once after the first slide's SVG has been appended
   * to the DOM (the moment a user can see content). Hosts use this to
   * dismiss their own loading overlays without having to guess at a
   * delay — a fast deck open shouldn't dwell behind a spinner that
   * outlasts the actual wait, and a slow first slide shouldn't drop
   * the spinner while the stage is still blank.
   *
   * Re-fires when the deck is replaced (i.e. the host re-keys this
   * component to remount it for a new file) — internal first-render
   * tracking is reset on mount.
   */
  onReady?: () => void;
  /**
   * Optional host-supplied stylesheet whose `@font-face` rules are
   * loaded into the worker's `FontFaceSet` alongside the deck's
   * embedded fonts. The chrome-extension passes its bundled Google
   * Fonts CSS here so decks that name `Anton`, `Alata`, etc. resolve
   * to the bundled face during canvas measurement (and not just at
   * paint time via the document-level stylesheet).
   *
   * Without this, decks that ship MTX-compressed embedded fonts —
   * which our renderer drops — would measure with the worker's OS
   * fallback metrics and produce wider lines than the browser will
   * paint.
   */
  bundledFontDefsCss?: string;
}

// `CachedSlide` lives in `presentation/types.ts` so the sub-component
// modules can import it without circling back through this file.

/**
 * Top-level presentation shell. React port of the original Lit
 * `<pptx-presentation>` Web Component, mirroring the same chrome:
 *
 *     ┌───────────────────────────────────────────────┐
 *     │ ribbon (filename / nav / search / print / …)  │
 *     ├──────────┬────────────────────────────────────┤
 *     │ thumb    │ stage (slide rendering with ruler) │
 *     │ + sects  │                                    │
 *     │          ├────────────────────────────────────┤
 *     │          │ notes (collapsible)                │
 *     ├──────────┴────────────────────────────────────┤
 *     │ status bar (slide / view modes / zoom slider) │
 *     └───────────────────────────────────────────────┘
 */
export function PptxPresentation(props: PptxPresentationProps): JSX.Element {
  const {
    controller,
    name,
    slideCount: externalSlideCount,
    src,
    className,
    style,
    toolbarStart,
    toolbarEnd,
    resolveMeta,
    noPrefetch = false,
    onReady,
  } = props;
  // One-shot guard for `onReady` — the SVG mount effect re-runs on
  // every layout / sidebar / notes / view-mode change, but the host
  // wants the callback fired exactly once per deck. Re-mounting the
  // component (host re-keys on file swap) zeroes the ref naturally.
  const onReadyFiredRef = useRef<boolean>(false);

  // ---- Settings + theme + locale -------------------------------------------
  const [settings, setSettings] = useState<ViewerSettings>(() => loadSettings());
  const [theme, setTheme] = useState<ThemeName>(() => resolveTheme(loadSettings().themeMode));
  const [, setLocaleTick] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const unsub = subscribeSettings((next) => {
      setSettings(next);
      setTheme(resolveTheme(next.themeMode));
      // Mirror persisted width updates from another surface (Settings
      // dialog, second viewer instance) into local drag state. Drags
      // write to local state directly, so this is a no-op for the
      // event the drag itself emitted.
      setSidebarWidth((prev) =>
        prev === next.sidebarWidth ? prev : next.sidebarWidth,
      );
    });
    return unsub;
  }, []);
  useEffect(() => {
    if (settings.themeMode !== "auto") return;
    const unsub = subscribeSystemTheme(() => setTheme(detectSystemTheme()));
    return unsub;
  }, [settings.themeMode]);
  useEffect(() => {
    const vars = THEME_TABLE[theme];
    if (rootRef.current) applyTheme(rootRef.current, vars);
    // Also propagate to <html> so chrome outside the shell (host page
    // body, fixed-position overlays / native scrollbar gutters in
    // Tauri / Electron windows) picks up the same theme variables.
    if (typeof document !== "undefined" && document.documentElement) {
      applyTheme(document.documentElement, vars);
    }
  }, [theme]);
  useEffect(() => {
    const unsub = subscribeLocale(() => setLocaleTick((n) => n + 1));
    return unsub;
  }, []);

  // ---- Slide state ---------------------------------------------------------
  const [slideCount, setSlideCount] = useState<number>(externalSlideCount ?? 0);
  // Per-typeface fallback report from controller.open(). Empty until a
  // deck is loaded; reset on every reopen so the status-bar indicator
  // reflects the current deck.
  const [fontUsage, setFontUsage] = useState<TypefaceUsage[]>([]);
  // Bare CSS body of the deck's `@font-face` declarations
  // (`<p:embeddedFontLst>` faces from PPTX), produced by
  // `slideglance-wasm`'s `fontDefs()` and stripped of its SVG `<defs>`
  // wrapper. Mounted into a deck-scoped `<style>` element in
  // `document.head` (see effect below) so that browser-side SVG
  // rendering can resolve embedded family names like "Noto Sans Bold"
  // — without this mount they would only live in the worker's
  // FontFaceSet (which is invisible to the document) and the SVG would
  // silently fall through the chain to a system font.
  const [fontDefsCss, setFontDefsCss] = useState<string>("");
  const [currentSlide, setCurrentSlide] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1);
  const [panX, setPanX] = useState<number>(0);
  const [panY, setPanY] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [phase, setPhase] = useState<string>("");
  // Long-running export pipelines (Print / PDF) post structured progress
  // here so the host can show a centred overlay instead of relying on
  // the easy-to-miss status bar at the bottom of the shell. `null`
  // means the deck is idle.
  const [progress, setProgress] = useState<{
    title: string;
    step: string;
    current?: number;
    total?: number;
  } | null>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  const [viewMode, setViewMode] = useState<"normal" | "grid">("normal");
  const [notesOpen, setNotesOpen] = useState<boolean>(false);
  // Sidebar width is user-resizable via the splitter handle and
  // persisted across sessions (clamped server-side in `loadSettings`).
  // Local state tracks the live value during a drag for low-latency
  // updates; the persisted copy in `settings.sidebarWidth` is rewritten
  // on pointer-up to avoid spamming localStorage from a 60Hz drag loop.
  const [sidebarWidth, setSidebarWidth] = useState<number>(
    () => loadSettings().sidebarWidth,
  );
  const sidebarResizeStartRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);
  const [slideshow, setSlideshow] = useState<boolean>(false);
  // `allSlidesReady` gates the deck-wide actions (Print / PDF /
  // Slideshow). When the background prefetch (or a manual
  // `ensureAllSlidesRendered`) finishes, the gate opens so those
  // actions stop showing partial output. Mirrors the historic Lit
  // shell's `allSlidesReady` flag.
  const [allSlidesReady, setAllSlidesReady] = useState<boolean>(false);
  // Selection model — set of `data-sp-id` strings for shapes selected
  // on the active slide, plus a live rubber-band rect (viewport coords)
  // when the user is dragging on empty stage. Both are derived data the
  // SelectionOverlay turns into stage-relative px boxes via `bboxMap`.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Status-bar selection-font popover. Toggled by clicking the
  // "폰트: …" / "Font: …" label so users with multi-typeface
  // selections can see the full list instead of a "+N more" summary
  // they can't drill into.
  const [selectionFontsOpen, setSelectionFontsOpen] = useState<boolean>(false);
  const selectionFontsRef = useRef<HTMLDivElement | null>(null);
  const [rubberBand, setRubberBand] =
    useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // Viewport bbox cache, keyed by sp-id. Built once per slide mount
  // (or when the SVG host re-renders) so hit-testing during pan/zoom
  // doesn't have to call getBBox/getCTM per shape per frame.
  const bboxMapRef = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(
    new Map(),
  );
  // Pointer-down snapshot used by the selection state machine. Stored
  // as a ref so re-renders during a drag don't reset it.
  const pointerDownAtRef = useRef<{
    x: number;
    y: number;
    target: HTMLElement | null;
  } | null>(null);
  const [textEditId, setTextEditId] = useState<string | null>(null);
  const [spaceHeld, setSpaceHeld] = useState<boolean>(false);
  const panStartRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [slideCache, setSlideCache] = useState<Map<number, CachedSlide>>(
    () => new Map(),
  );

  const stageRef = useRef<HTMLDivElement | null>(null);
  const slideRef = useRef<HTMLDivElement | null>(null);
  // The slideshow overlay mounts its own `<main>` and slide
  // container. Sharing a single `stageRef` / `slideRef` between
  // them caused a use-after-free when slideshow exits: React calls
  // the slideshow ref-callback with `null`, which clears the slot,
  // but the persistent normal `<main>`'s ref-callback never re-runs
  // because that element didn't remount. Result: stale `stageSize`
  // from the fullscreen viewport leaking into the post-exit render
  // → scrollbars + visibly larger slide. Two separate refs keep the
  // mode-specific pointers independent.
  const slideshowStageRef = useRef<HTMLDivElement | null>(null);
  const slideshowSlideRef = useRef<HTMLDivElement | null>(null);
  // Ref-handle for Cmd/Ctrl+P. Captured before the keyboard handler
  // is registered so we don't have to thread `handlePrint` through
  // the effect's dependency array (which would re-bind the listener
  // on every render).
  const handlePrintRef = useRef<(() => Promise<void>) | null>(null);
  const pendingRef = useRef<Map<number, Promise<CachedSlide | null>>>(new Map());
  // Monotonic deck-epoch counter. Incremented on every deck swap
  // (`externalSlideCount` / `name` change). Each `requestSlide` task
  // captures the epoch when it starts; if the epoch advances while
  // the IPC roundtrip is in flight, the stale resolution is dropped
  // before it stamps the new deck's cache. Without this, a deck swap
  // triggered while slide N is mid-render leaves the *old* SVG in
  // the new deck's `slideCache.get(N)` — which is exactly the
  // "previous deck's thumbnail" symptom.
  const deckEpochRef = useRef(0);

  // Sync external slideCount + flush slide cache on deck swap.
  //
  // Triggered by either `slideCount` *or* `name` changing — relying
  // only on `slideCount` lets a new deck with the same length re-use
  // the previous deck's cached SVG (and thus stale thumbnails).
  // `name` is the host-supplied display label; for native and worker
  // hosts that's always the file basename, so a new file = new name
  // = cache flush. The cache cleanup also revokes any lingering blob
  // URLs from earlier renders for safety, even though the current
  // pipeline inlines media as data URLs.
  useEffect(() => {
    if (typeof externalSlideCount !== "number") return;
    deckEpochRef.current += 1; // invalidate every in-flight task
    setSlideCount(externalSlideCount);
    setCurrentSlide(1);
    setAllSlidesReady(false);
    setSelectedIds(new Set());
    setTextEditId(null);
    setRubberBand(null);
    pendingRef.current.clear();
    setSlideCache((prev) => {
      for (const c of prev.values()) {
        for (const u of c.blobUrls) URL.revokeObjectURL(u);
      }
      return new Map();
    });
  }, [externalSlideCount, name]);

  // Stage sizing.
  //
  // Re-attached whenever `slideshow` flips because we mount two
  // different `<main>` elements (normal vs slideshow overlay) and
  // both share the same `stageRef`. Without re-binding the
  // ResizeObserver to the *active* element, the observer keeps
  // watching whichever main mounted first — which is `display: none`
  // in the inactive mode and reports size 0, collapsing `fit` and
  // hiding the slide.
  useEffect(() => {
    // Pick the active stage based on the current mode. In slideshow
    // mode the overlay's `<main>` is the truth; in normal mode the
    // gridded body's `<main>` is.
    const stage = slideshow ? slideshowStageRef.current : stageRef.current;
    if (!stage) return;
    const seed = stage.getBoundingClientRect();
    if (seed.width > 0 && seed.height > 0) {
      setStageSize({ w: seed.width, h: seed.height });
    } else if (slideshow) {
      // Fullscreen transition often hasn't laid out yet on the same
      // tick — fall back to viewport so the first frame still gets
      // a non-zero `fit`.
      setStageSize({ w: window.innerWidth, h: window.innerHeight });
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const r = entry.contentRect;
      setStageSize({ w: Math.max(0, r.width), h: Math.max(0, r.height) });
    });
    observer.observe(stage);
    // Window resize matters only in slideshow (fullscreen) — the
    // wrapping body handles resize for the windowed case.
    const onWinResize = (): void => {
      const cur = slideshow ? slideshowStageRef.current : stageRef.current;
      if (!cur) return;
      const r = cur.getBoundingClientRect();
      setStageSize({ w: Math.max(0, r.width), h: Math.max(0, r.height) });
    };
    if (slideshow) window.addEventListener("resize", onWinResize);
    return () => {
      observer.disconnect();
      if (slideshow) window.removeEventListener("resize", onWinResize);
    };
  }, [slideshow]);

  // Optional auto-open from `src` (browser path).
  useEffect(() => {
    if (!controller || src == null || externalSlideCount != null) return;
    let cancelled = false;
    void (async () => {
      try {
        setPhase("loading");
        let bytes: Uint8Array;
        if (typeof src === "string") {
          const res = await fetch(src);
          if (!res.ok) throw new Error(`fetch ${src} → ${res.status}`);
          bytes = new Uint8Array(await res.arrayBuffer());
        } else if (src instanceof Uint8Array) {
          bytes = src;
        } else {
          bytes = new Uint8Array(src);
        }
        const meta = await controller.open(bytes, {
          extraFontDefsCss: props.bundledFontDefsCss,
        });
        if (cancelled) return;
        setSlideCount(meta.slideCount);
        setFontUsage(meta.fontUsage ?? []);
        setFontDefsCss(extractFontStyleCss(meta.fontDefs ?? ""));
        // Register MTX-decoded TTF buffers on `document.fonts` via
        // the FontFace API. Worker already decoded the bytes and
        // pre-filtered them through `validateCmap` (the OTS cmap
        // checks Chromium prints uncatchable C++-level warnings
        // for); the bytes that reach us here are expected to load
        // cleanly. Non-OTS failure modes (e.g. CORS / detachment
        // races) DO surface as catchable promise rejections, which
        // we silence below since the metric-match fallback chain
        // and bundled Google Fonts carry the visible paint.
        if (typeof document !== "undefined" && document.fonts) {
          for (const d of meta.decodedFonts ?? []) {
            try {
              const face = new FontFace(d.family, d.bytes.buffer as ArrayBuffer, {
                weight: d.weight,
                style: d.style,
              });
              face
                .load()
                .then((loaded) => {
                  document.fonts.add(loaded);
                })
                .catch(() => {
                  // OTS rejection or other browser-side font decode
                  // failure — silently skip. The deck still renders
                  // via the Phase 2 bundled Google Fonts fallback or
                  // the metric-match catalog substitute.
                });
            } catch {
              // FontFace constructor itself only throws for invalid
              // descriptor strings — also silenced.
            }
          }
        }
        setCurrentSlide(1);
        setZoom(1);
        setPanX(0);
        setPanY(0);
        setErrorMsg(null);
        setPhase("");
        setSlideCache((prev) => {
          for (const c of prev.values()) {
            for (const u of c.blobUrls) URL.revokeObjectURL(u);
          }
          return new Map();
        });
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(`${(err as Error).message ?? err}`);
          setPhase("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [controller, src, externalSlideCount]);

  // Mount the deck's embedded `@font-face` declarations into a
  // document-scoped `<style>` so the browser's font matcher can
  // resolve family names like "Noto Sans Bold" referenced by SVG
  // `<text>` runs. The declarations come from PPTX
  // `<p:embeddedFontLst>` faces extracted by the WASM core
  // (`fontDefs()`), already de-obfuscated and base64-encoded. Without
  // this mount the embedded fonts would only live in the worker's
  // FontFaceSet (worker-local, invisible to `document`), and the SVG
  // would silently fall back to a system sans-serif — which on most
  // hosts is wider than the authored face and overflows text frames
  // into adjacent layout regions.
  //
  // The `<style>` element is identified by a single id so re-mounting
  // the component (or swapping decks) replaces the rules atomically;
  // empty CSS removes the element entirely. We tag with
  // `data-pptx-rs-fonts` so co-located shells can detect / clean up
  // orphan blocks.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const id = "pptx-rs-deck-fonts";
    const existing = document.getElementById(id) as HTMLStyleElement | null;
    if (fontDefsCss.length === 0) {
      if (existing) existing.remove();
      return;
    }
    const styleEl: HTMLStyleElement =
      existing ?? document.createElement("style");
    if (!existing) {
      styleEl.id = id;
      styleEl.dataset.pptxRsFonts = "true";
      document.head.appendChild(styleEl);
    }
    if (styleEl.textContent !== fontDefsCss) {
      styleEl.textContent = fontDefsCss;
    }

    // Eager-load every embedded face. CSS `@font-face` URLs are
    // *lazily* fetched — the browser only decodes the font payload
    // when a text node first references that family. While slide 1
    // is on stage, embedded faces used only by later slides (e.g.
    // "Lato Bold" used by slide 4) stay un-decoded; the
    // `FontUsageIndicator` then sees `document.fonts.check('12px
    // "Lato Bold"')` return `false` and walks past it to the OS
    // Latin fallback (`Helvetica Neue`), reporting a substitute that
    // disappears the moment the user switches to grid view (which
    // forces every slide to render and the missing faces to load).
    //
    // Calling `document.fonts.load(...)` for each declared family
    // forces the load to start *now*, so the indicator's initial
    // state is the same as its post-render-everything state and
    // doesn't mislead the user into thinking a substitution is in
    // effect when one isn't. Errors are swallowed — a partial load
    // (e.g. one variant of one face fails to decode) shouldn't
    // block the rest of the deck from showing the right state.
    if (document.fonts) {
      const families = new Set<string>();
      const matches = fontDefsCss.matchAll(
        /font-family\s*:\s*['"]([^'"]+)['"]/gi,
      );
      for (const match of matches) {
        families.add(match[1]);
      }
      for (const family of families) {
        const escaped = family.replace(/"/g, '\\"');
        document.fonts.load(`12px "${escaped}"`).catch(() => {
          // Ignore — single-face decode failure is non-fatal.
        });
      }
    }

    return () => {
      // Component-unmount cleanup: remove the deck-scoped `<style>` so
      // we don't leak base64 font payloads when the host tears down
      // the viewer (e.g. SPA route change, modal close).
      styleEl.remove();
    };
  }, [fontDefsCss]);

  const requestSlide = useCallback(
    async (slide: number): Promise<CachedSlide | null> => {
      if (!controller || slide < 1) return null;
      // Snapshot the current deck epoch so we can detect a deck swap
      // that lands while this task is in flight. Any IPC roundtrip
      // older than the current epoch is dropped before it stamps the
      // new deck's cache.
      const myEpoch = deckEpochRef.current;
      let cached: CachedSlide | undefined;
      setSlideCache((prev) => {
        cached = prev.get(slide);
        return prev;
      });
      if (cached) return cached;
      const inflight = pendingRef.current.get(slide);
      if (inflight) return inflight;
      const task = (async () => {
        try {
          const rendered: RenderedSlide = await controller.renderSlide(slide);
          if (myEpoch !== deckEpochRef.current) return null; // stale
          // Inline media as `data:` URLs rather than `blob:` URLs.
          //
          // `blob:` URLs are document-scoped and revoked on page
          // teardown — they also race catastrophically with React 18
          // StrictMode and Vite HMR (the component double-mounts;
          // first-mount cleanup revokes URLs the second mount has
          // already stamped into cache, surfacing as
          // `net::ERR_FILE_NOT_FOUND` on every grid-view toggle).
          // `data:` URLs are self-contained, never revoke, and copy
          // intact when the SVG is exported to print / PDF. The
          // base64 overhead is acceptable: identical media hashed to
          // the same key only encodes once per slide and the worker
          // already deduplicates across the deck.
          const result =
            rendered.media && rendered.media.size > 0
              ? {
                  svg: inlineMediaAsDataUrls(rendered.svg, rendered.media),
                  blobUrls: [] as string[],
                }
              : { svg: rendered.svg, blobUrls: [] as string[] };
          const inlineMeta: SlideMeta = {
            notes: rendered.notes,
            layout_name: rendered.layoutName,
            section_name: rendered.sectionName,
          };
          let mergedMeta = inlineMeta;
          if (resolveMeta) {
            try {
              const extra = await resolveMeta(slide);
              if (extra) mergedMeta = { ...inlineMeta, ...extra };
            } catch {
              /* fall through */
            }
          }
          if (myEpoch !== deckEpochRef.current) return null; // stale post-meta
          const entry: CachedSlide = {
            svg: result.svg,
            preparedSvg: prepareSvg(result.svg),
            blobUrls: result.blobUrls,
            meta: mergedMeta,
          };
          setSlideCache((prev) => {
            // Final defensive check inside the setState — if a deck
            // swap happened between the prior epoch read and this
            // commit, leave the (already-flushed) cache alone.
            if (myEpoch !== deckEpochRef.current) return prev;
            const existing = prev.get(slide);
            if (existing) {
              for (const u of entry.blobUrls) URL.revokeObjectURL(u);
              return prev;
            }
            const next = new Map(prev);
            next.set(slide, entry);
            return next;
          });
          return entry;
        } catch (err) {
          setErrorMsg(`${(err as Error).message ?? err}`);
          return null;
        } finally {
          pendingRef.current.delete(slide);
        }
      })();
      pendingRef.current.set(slide, task);
      return task;
    },
    [controller, resolveMeta],
  );

  const ensureAllSlidesRendered = useCallback(
    async (
      silent = false,
      onProgress?: (current: number, total: number) => void,
    ): Promise<SlideSvg[]> => {
      if (!controller || slideCount === 0) return [];
      const out: SlideSvg[] = [];
      for (let n = 1; n <= slideCount; n += 1) {
        if (!silent) {
          setPhase(t("phase.preparingSlideOf", { current: n, total: slideCount }));
        }
        onProgress?.(n, slideCount);
        const cached = await requestSlide(n);
        if (!cached) continue;
        out.push({
          slide_number: n,
          svg: cached.svg,
          notes: cached.meta.notes ?? undefined,
          layout_name: cached.meta.layout_name ?? undefined,
          section_name: cached.meta.section_name ?? undefined,
        });
      }
      if (!silent) setPhase("");
      if (out.length === slideCount) setAllSlidesReady(true);
      return out;
    },
    [controller, slideCount, requestSlide],
  );

  // Background prefetch — once a deck is loaded, walk every slide in
  // the background so deck-wide actions (Print / PDF / Slideshow /
  // Search) become available without an interactive stall. Failures
  // here are swallowed: prefetch is a UX accelerator, not a
  // correctness requirement. Cancellation is handled implicitly by
  // letting `slideCount` change reset the cache and start a new pass.
  useEffect(() => {
    if (noPrefetch) return; // host opted out — see prop docs
    if (!controller || slideCount === 0) return;
    if (allSlidesReady) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureAllSlidesRendered(true);
      } catch {
        /* ignore background prefetch errors */
      }
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [noPrefetch, controller, slideCount, allSlidesReady, ensureAllSlidesRendered]);

  // Active slide fetch.
  useEffect(() => {
    if (!controller || slideCount === 0) return;
    void requestSlide(currentSlide);
  }, [controller, slideCount, currentSlide, requestSlide]);

  // Cache cleanup intentionally left unmanaged on unmount.
  //
  // Earlier this effect revoked every cached blob URL when the
  // component tore down. That is correct in production but races
  // catastrophically with React 18 StrictMode (development) and HMR:
  // both double-mount the component, so the *first* mount's cleanup
  // revokes the URLs that the *second* mount has already stamped
  // into its slideCache. The second-mount thumbnails then load the
  // stale URLs from `cached.preparedSvg` and fail with
  // `net::ERR_FILE_NOT_FOUND` — exactly the symptom users see when
  // the grid view paints with random tiles missing.
  //
  // We rely on the browser's natural blob lifetime: blob URLs become
  // unreachable when the document is torn down (window close,
  // navigation), at which point the GC reclaims their backing bytes.
  // The brief window between component unmount and document teardown
  // leaks a few MB of media that the browser will collect anyway —
  // a fair trade for never showing broken thumbnails in dev.

  const activeSlide = slideCache.get(currentSlide);
  const slideSvg = activeSlide?.preparedSvg ?? "";
  const slideMeta = activeSlide?.meta ?? null;

  // Mount SVG.
  //
  // Re-runs whenever any layout-affecting state changes (sidebar /
  // notes toggle, view mode, ruler, stage size) so the host is
  // self-healing: if React reconciliation, a parent's display
  // toggle, or a wrapper unmount ever clears the slide host's
  // children, this effect re-injects the SVG immediately.
  //
  // The early-out check on `firstElementChild === <svg>` guarantees
  // the effect is a cheap no-op on most renders — full re-parse only
  // when the slide actually changed.
  useEffect(() => {
    // Mount the SVG into whichever slide host is currently visible.
    // Slideshow mode uses its own overlay-mounted div with a separate
    // ref so the slide doesn't get torn out when fullscreen flips.
    const host = slideshow ? slideshowSlideRef.current : slideRef.current;
    if (!host) return;
    if (!slideSvg) {
      while (host.firstChild) host.removeChild(host.firstChild);
      return;
    }
    const existing = host.firstElementChild;
    if (
      existing &&
      existing.tagName.toLowerCase() === "svg" &&
      host.dataset.slideSvgKey === slideSvg
    ) {
      return; // already mounted, no work
    }
    while (host.firstChild) host.removeChild(host.firstChild);
    try {
      // Rewrite every `id="…"` / `url(#…)` reference to a mount-unique
      // namespace so the main-stage SVG can never collide with the
      // sibling SVGs the thumbnail strip mounts simultaneously.
      const namespaced = uniquifyIds(slideSvg, `stage-s${currentSlide}`);
      const doc = new DOMParser().parseFromString(namespaced, "image/svg+xml");
      const root = doc.documentElement;
      if (!root) return;
      const errNode = root.querySelector("parsererror");
      if (errNode) {
        setErrorMsg(errNode.textContent ?? "svg parse error");
        return;
      }
      host.appendChild(document.importNode(root, true));
      host.dataset.slideSvgKey = slideSvg;
      // First successful mount of this deck — fire `onReady` once so
      // host-level loading overlays can dismiss right when the user
      // can actually see content. Subsequent slide changes re-enter
      // this branch but the ref guard short-circuits.
      if (!onReadyFiredRef.current) {
        onReadyFiredRef.current = true;
        try {
          onReady?.();
        } catch {
          // Host-supplied callback errors must never derail the SVG
          // mount path — the slide is already in the DOM at this
          // point and a thrown onReady would leak through to the
          // try/catch below and surface as a parser error to the user.
        }
      }
      // Rebuild bbox map for hit-testing. We use `getBoundingClientRect()`
      // (the browser-truth painted bounds) and project back into SVG
      // user space via the inverse of `getScreenCTM()` so the stored
      // rect always matches what the user actually sees.
      //
      // Why not `getBBox()` + `getCTM()`?
      //   `<g>.getBBox()` is unreliable for groups whose children are
      //   `<text>` runs whose width depends on font substitution: with
      //   web-font fallback in flight the geometric bbox can clip the
      //   visible glyph row, leaving the selection rectangle drawn too
      //   small / shifted relative to the glyph the user can see (a
      //   common artefact on table cells whose `<g>` wraps text laid
      //   out at the original metric-match width).
      //   `getBoundingClientRect()` reflects the rendered geometry
      //   after font load and after every transform on the chain, so
      //   it's the authoritative source for "where the shape is on
      //   screen" — converting through `inverseScreenCTM` then gives a
      //   user-space rect that the existing zoom-aware projection step
      //   in `selectionBoxes` can transform back to screen space.
      const map = new Map<string, { x: number; y: number; w: number; h: number }>();
      const svgEl = host.firstElementChild as SVGSVGElement | null;
      const screenCTM = svgEl?.getScreenCTM?.() ?? null;
      if (
        svgEl &&
        screenCTM &&
        typeof (svgEl as unknown as { createSVGPoint?: () => unknown })
          .createSVGPoint === "function"
      ) {
        let inverse: DOMMatrix | null = null;
        try {
          inverse = screenCTM.inverse();
        } catch {
          inverse = null;
        }
        if (inverse) {
          const els = svgEl.querySelectorAll<SVGGraphicsElement>("[data-sp-id]");
          for (const el of Array.from(els)) {
            const id = (el as unknown as HTMLElement).dataset.spId;
            if (!id) continue;
            const rect = el.getBoundingClientRect();
            // Skip elements that haven't laid out yet (e.g. inside
            // `display:none` ancestors or detached subtrees) — their
            // 0×0 rect would otherwise project to a 0-area selection
            // box anchored at the SVG origin.
            if (rect.width === 0 && rect.height === 0) continue;
            const p = svgEl.createSVGPoint();
            const corners = [
              [rect.left, rect.top],
              [rect.right, rect.top],
              [rect.left, rect.bottom],
              [rect.right, rect.bottom],
            ].map(([x, y]) => {
              p.x = x;
              p.y = y;
              return p.matrixTransform(inverse!);
            });
            const xs = corners.map((c) => c.x);
            const ys = corners.map((c) => c.y);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            map.set(id, { x: minX, y: minY, w: maxX - minX, h: maxY - minY });
          }
        }
      }
      bboxMapRef.current = map;
    } catch (err) {
      setErrorMsg(`${(err as Error).message ?? err}`);
    }
  }, [slideSvg, currentSlide, sidebarWidth, notesOpen, viewMode, slideshow, stageSize.w, stageSize.h]);

  // Clear selection when navigating away (sp-ids are slide-scoped).
  useEffect(() => {
    setSelectedIds(new Set());
    setTextEditId(null);
    setRubberBand(null);
  }, [currentSlide]);

  // Keyboard shortcuts — see `presentation/use-keyboard-shortcuts.ts`
  // for the full binding table and rationale.
  useKeyboardShortcuts({
    slideCount,
    allSlidesReady,
    searchOpen,
    slideshow,
    selectedIds,
    textEditId,
    handlePrintRef,
    bboxMapRef,
    slideRef,
    setSearchOpen,
    setSlideshow,
    setSelectedIds,
    setTextEditId,
    setRubberBand,
    setSpaceHeld,
    setShortcutsOpen,
    setCurrentSlide,
    setZoom,
    setPanX,
    setPanY,
  });

  // Pinch / Cmd-wheel zoom + plain-wheel slide navigation.
  //
  // Browsers deliver three flavours of wheel through the same event:
  //   1. Plain scroll (mouse wheel, two-finger trackpad scroll) —
  //      `ctrlKey: false`, large `deltaY` (often > 50 per notch).
  //   2. Trackpad pinch — synthesised as `wheel` with `ctrlKey: true`
  //      and small `deltaY` (~1-10 per frame) at high frequency.
  //   3. Cmd-wheel — explicit modifier, large `deltaY`.
  //
  // (2) and (3) are zoom intents; (1) drives slide navigation when
  // the stage scroll has reached its top / bottom edge — a
  // PowerPoint-style "scroll past the edge to flip pages" gesture.
  // While the slide is taller than the stage (zoomed in) the wheel
  // scrolls within it as usual; the navigation only kicks in once
  // the user has hit the boundary. To stop trackpad inertia from
  // skipping multiple slides per gesture, the boundary requires a
  // configurable extra travel (`BOUNDARY_THRESHOLD`) before the
  // jump fires, plus a brief post-jump cooldown so the tail end of
  // an inertial gesture can't immediately advance again.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // Tuned conservatively — historic Lit shell used a fixed 1.1/0.9
    // step which felt jumpy on trackpads. A base of ~0.0035 gives
    // the same perceived speed for a Cmd-wheel "click" (~100 deltaY)
    // while making pinch feel proportional.
    const SENSITIVITY = 0.0035;
    // How much wheel travel past the slide edge is required before
    // we commit to the next/previous slide. Sized so a single mouse-
    // wheel "click" (~100 px deltaY) doesn't immediately flip the
    // page — the user has to push deliberately past the boundary.
    const BOUNDARY_THRESHOLD = 240;
    // Window after a slide change during which subsequent wheel
    // events are swallowed. Covers macOS trackpad inertia tails
    // (~250 ms typical) so the residual deltas don't keep firing
    // page jumps after the user lifted their fingers.
    const COOLDOWN_MS = 350;
    // Inactivity reset — if the user pauses scrolling at the
    // boundary without committing, the accumulator decays so the
    // next gesture starts from zero. Otherwise idle decks could
    // accumulate drift across unrelated wheel events.
    const RESET_AFTER_MS = 250;

    let pendingZoomDelta = 0;
    let raf = 0;
    let boundaryDelta = 0;
    let lastWheelAt = 0;
    let cooldownUntil = 0;

    const flushZoom = (): void => {
      raf = 0;
      if (pendingZoomDelta === 0) return;
      // exp(-d * k): negative delta (zoom-in) → factor > 1.
      const factor = Math.exp(-pendingZoomDelta * SENSITIVITY);
      pendingZoomDelta = 0;
      setZoom((z) => clamp(z * factor, ZOOM_MIN, ZOOM_MAX));
    };

    const onWheel = (ev: WheelEvent): void => {
      // DOM_DELTA_LINE / PAGE → multiply to a px-equivalent so the
      // sensitivity / threshold constants work the same regardless
      // of input device. Most trackpads ship pixel deltas already.
      let dy = ev.deltaY;
      if (ev.deltaMode === 1) dy *= 16; // line → px
      else if (ev.deltaMode === 2) dy *= stage.clientHeight; // page

      // ctrlKey covers both real Ctrl-wheel AND the synthetic pinch
      // event the browser fires as ctrlKey=true.
      const isZoomIntent = ev.ctrlKey || ev.metaKey;
      if (isZoomIntent) {
        ev.preventDefault();
        pendingZoomDelta += dy;
        if (raf === 0) raf = requestAnimationFrame(flushZoom);
        return;
      }

      // Slideshow / grid view manage their own navigation; only the
      // normal slide stage opts into wheel-driven page flipping.
      if (slideshow) return;
      if (viewMode !== "normal") return;
      if (slideCount <= 0) return;

      const now = performance.now();
      if (now < cooldownUntil) {
        // Inertia tail after a recent slide change — block native
        // scroll too so the new slide stays put while the gesture
        // dies down.
        ev.preventDefault();
        return;
      }
      if (now - lastWheelAt > RESET_AFTER_MS) {
        boundaryDelta = 0;
      }
      lastWheelAt = now;

      // Treat sub-pixel rounding as still-at-edge.
      const atBottom = stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 1;
      const atTop = stage.scrollTop <= 0;

      if (dy > 0) {
        if (!atBottom) {
          boundaryDelta = 0;
          return; // native scroll handles it
        }
        ev.preventDefault();
        boundaryDelta = Math.max(0, boundaryDelta) + dy;
        if (boundaryDelta >= BOUNDARY_THRESHOLD) {
          boundaryDelta = 0;
          cooldownUntil = now + COOLDOWN_MS;
          setCurrentSlide((s) => Math.min(slideCount, s + 1));
        }
      } else if (dy < 0) {
        if (!atTop) {
          boundaryDelta = 0;
          return;
        }
        ev.preventDefault();
        boundaryDelta = Math.min(0, boundaryDelta) + dy;
        if (boundaryDelta <= -BOUNDARY_THRESHOLD) {
          boundaryDelta = 0;
          cooldownUntil = now + COOLDOWN_MS;
          setCurrentSlide((s) => Math.max(1, s - 1));
        }
      }
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      stage.removeEventListener("wheel", onWheel);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
    // Re-bind on slideshow / viewMode / slideCount changes so the
    // handler closes over the current values instead of stale state.
  }, [slideshow, viewMode, slideCount]);

  // Fullscreen change handling for slideshow exit.
  useEffect(() => {
    const onFs = (): void => {
      if (!document.fullscreenElement && slideshow) setSlideshow(false);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [slideshow]);

  // ---- Selection state machine --------------------------------------------
  // See `presentation/use-selection-state-machine.ts` — owns the
  // pointer-down/move/up dispatch, rubber-band hit-test, double-click
  // text-edit entry, selection-bbox projection, authored-font
  // derivation, and the status-bar font-popover lifecycle.
  const {
    onStagePointerDown,
    onStagePointerMove,
    onStagePointerUp,
    onStageDoubleClick,
    selectionBoxes,
    selectionFonts,
    rubberBandRect,
  } = useSelectionStateMachine({
    selectedIds,
    setSelectedIds,
    rubberBand,
    setRubberBand,
    textEditId,
    setTextEditId,
    spaceHeld,
    panX,
    panY,
    setPanX,
    setPanY,
    zoom,
    stageW: stageSize.w,
    stageH: stageSize.h,
    slideSvg,
    panStartRef,
    pointerDownAtRef,
    bboxMapRef,
    stageRef,
    slideRef,
    selectionFontsOpen,
    setSelectionFontsOpen,
    selectionFontsRef,
  });

  // ---- Layout math ---------------------------------------------------------
  const aspect = useMemo(() => parseAspect(slideSvg) ?? 16 / 9, [slideSvg]);
  const fit = useMemo(() => {
    if (stageSize.w <= 0 || stageSize.h <= 0) return 0;
    return Math.min(stageSize.w, stageSize.h * aspect);
  }, [aspect, stageSize.w, stageSize.h]);
  const slideW = fit * zoom;
  const slideH = fit > 0 ? (fit / aspect) * zoom : 0;
  const canvasW = Math.max(slideW, stageSize.w);
  const canvasH = Math.max(slideH, stageSize.h);
  const zoomPct = Math.round(zoom * 100);

  const reset = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, []);
  const setZoomFromPct = useCallback((pct: number) => {
    setZoom(clamp(pct / 100, ZOOM_MIN, ZOOM_MAX));
  }, []);

  // ---- Search --------------------------------------------------------------
  const runSearch = useCallback(
    async (q: string): Promise<void> => {
      if (!q.trim()) {
        setSearchHits([]);
        return;
      }
      const slides = await ensureAllSlidesRendered();
      setSearchHits(searchSlides(slides, q));
    },
    [ensureAllSlidesRendered],
  );

  // ---- Print / PDF ---------------------------------------------------------
  // Both handlers live in `usePrintPdfExport` — they share the same
  // pre-flight (force-render every slide, surface progress, inline
  // media as data URIs) and only differ on the final dispatch
  // (`printDeck` vs `exportToPdf`). The `handlePrintRef` indirection
  // stays here because the keyboard handler at line ~1011 needs to
  // call into `handlePrint` before its `useCallback` body has been
  // initialised on the first render.
  const { handlePrint, handleExportPdf } = usePrintPdfExport({
    name,
    ensureAllSlidesRendered,
    setProgress,
    setErrorMsg,
    setPhase,
  });
  useEffect(() => {
    handlePrintRef.current = handlePrint;
  }, [handlePrint]);

  const handleSlideshow = useCallback(async () => {
    setSlideshow(true);
    setCurrentSlide(1);
    try {
      await rootRef.current?.requestFullscreen();
    } catch {
      /* host disallowed fullscreen — soft slideshow */
    }
  }, []);

  // Section nav data.
  const sectionSlides: SlideSvg[] = useMemo(() => {
    return Array.from(slideCache.entries())
      .map(([n, c]) => ({
        slide_number: n,
        svg: c.svg,
        notes: c.meta.notes ?? undefined,
        layout_name: c.meta.layout_name ?? undefined,
        section_name: c.meta.section_name ?? undefined,
      }))
      .sort((a, b) => a.slide_number - b.slide_number);
  }, [slideCache]);
  const hasSections = sectionSlides.some((s) => !!s.section_name);

  // Ruler geometry — see `presentation/use-ruler-geometry.ts`.
  const rulerOn =
    settings.showRuler && !slideshow && viewMode === "normal" && !!slideSvg;
  const { intrinsic, intrinsicY, rulerRect } = useRulerGeometry({
    rulerOn,
    slideSvg,
    stageRef,
    slideRef,
    slideW,
    slideH,
    panX,
    panY,
    stageW: stageSize.w,
    stageH: stageSize.h,
  });

  return (
    <div
      ref={rootRef}
      data-pptx-shell=""
      className={className}
      style={{ ...rootStyle, ...style }}
    >
      <style>{SHELL_GLOBAL_CSS}</style>
      {/* ---- Ribbon ---- */}
      <Toolbar
        toolbarStart={toolbarStart}
        toolbarEnd={toolbarEnd}
        name={name}
        slideCount={slideCount}
        currentSlide={currentSlide}
        setCurrentSlide={setCurrentSlide}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        allSlidesReady={allSlidesReady}
        noPrefetch={noPrefetch}
        deckGateTitle={deckGateTitle}
        handlePrint={handlePrint}
        handleExportPdf={handleExportPdf}
        handleSlideshow={handleSlideshow}
        shortcutsOpen={shortcutsOpen}
        setShortcutsOpen={setShortcutsOpen}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
      />

      {/* ---- Body: sidebar + resizer + stage area ----
        Sidebar width is user-resizable; the splitter `<div>` sits on
        the column boundary. All three grid items keep their identity
        across renders so the imperatively-mounted slide SVG and
        thumbnail DOM cache survive layout changes. */}
      <div
        style={{
          ...bodyStyle,
          gridTemplateColumns: `${sidebarWidth}px ${SIDEBAR_RESIZER_WIDTH}px minmax(0, 1fr)`,
          display: slideshow ? "none" : "grid",
        }}
      >
        <aside
          key="sidebar"
          style={{
            ...sidebarStyle,
            gridTemplateRows: hasSections ? "auto 1fr" : "1fr",
          }}
        >
          {hasSections && (
            <SectionNav
              slides={sectionSlides}
              currentSlide={currentSlide}
              onJump={(n) => setCurrentSlide(n)}
            />
          )}
          <ThumbnailSidebar
            slideCount={slideCount}
            currentSlide={currentSlide}
            onSelect={setCurrentSlide}
            getThumbnail={requestSlide}
            aspectFallback={aspect}
            deckKey={name ?? ""}
          />
        </aside>

        {/* Splitter — drag horizontally to resize the sidebar.
            `setPointerCapture` keeps the grip even when a fast drag
            leaves the 6 px hit-zone. ARIA marks this as a vertical
            separator with min/max/now so assistive tech announces the
            current width. */}
        <div
          key="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("status.resizeSidebar")}
          aria-valuemin={SIDEBAR_WIDTH_MIN}
          aria-valuemax={SIDEBAR_WIDTH_MAX}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          style={sidebarResizerStyle}
          onPointerDown={(ev) => {
            ev.preventDefault();
            sidebarResizeStartRef.current = {
              pointerId: ev.pointerId,
              startX: ev.clientX,
              startWidth: sidebarWidth,
            };
            ev.currentTarget.setPointerCapture(ev.pointerId);
          }}
          onPointerMove={(ev) => {
            const start = sidebarResizeStartRef.current;
            if (!start || start.pointerId !== ev.pointerId) return;
            const next = clampSidebarWidth(start.startWidth + (ev.clientX - start.startX));
            setSidebarWidth(next);
          }}
          onPointerUp={(ev) => {
            const start = sidebarResizeStartRef.current;
            if (!start || start.pointerId !== ev.pointerId) return;
            sidebarResizeStartRef.current = null;
            try {
              ev.currentTarget.releasePointerCapture(ev.pointerId);
            } catch {
              /* capture may already be released by the platform */
            }
            // Persist only on release — a 60 Hz drag would otherwise
            // hammer localStorage and re-notify every settings
            // subscriber for each frame.
            saveSettings({ sidebarWidth: clampSidebarWidth(sidebarWidth) });
          }}
          onPointerCancel={() => {
            sidebarResizeStartRef.current = null;
          }}
          onKeyDown={(ev) => {
            // Keyboard a11y: ←/→ nudge by 10 px, Home/End jump to
            // bounds. Persist on each step.
            const STEP = 10;
            let next: number | null = null;
            if (ev.key === "ArrowLeft") next = sidebarWidth - STEP;
            else if (ev.key === "ArrowRight") next = sidebarWidth + STEP;
            else if (ev.key === "Home") next = SIDEBAR_WIDTH_MIN;
            else if (ev.key === "End") next = SIDEBAR_WIDTH_MAX;
            if (next == null) return;
            ev.preventDefault();
            const clamped = clampSidebarWidth(next);
            setSidebarWidth(clamped);
            saveSettings({ sidebarWidth: clamped });
          }}
        />

        <div
          key="stage-area"
          style={{
            ...stageAreaStyle,
            gridTemplateRows: notesOpen
              ? "minmax(0, 1fr) auto"
              : "minmax(0, 1fr)",
          }}
        >
          <div
            style={{
              ...stageWrapStyle,
              padding: rulerOn ? `${RULER_SIZE}px 0 0 ${RULER_SIZE}px` : 0,
            }}
          >
            {rulerOn && (
              <>
                <div style={rulerCornerStyle} />
                <Ruler
                  orientation="horizontal"
                  unit={settings.rulerUnit}
                  slideOriginPx={rulerRect.originX}
                  slideExtentPx={rulerRect.extentX || slideW}
                  slideExtentCm={intrinsic.cm}
                  slideIntrinsicPx={intrinsic.px}
                  style={rulerHStyle}
                />
                <Ruler
                  orientation="vertical"
                  unit={settings.rulerUnit}
                  slideOriginPx={rulerRect.originY}
                  slideExtentPx={rulerRect.extentY || slideH}
                  slideExtentCm={intrinsicY.cm}
                  slideIntrinsicPx={intrinsicY.px}
                  style={rulerVStyle}
                />
              </>
            )}
            <main
              ref={stageRef}
              style={{
                ...stageStyle,
                cursor: spaceHeld
                  ? panStartRef.current
                    ? "grabbing"
                    : "grab"
                  : undefined,
              }}
              onPointerDown={onStagePointerDown}
              onPointerMove={onStagePointerMove}
              onPointerUp={onStagePointerUp}
              onPointerCancel={onStagePointerUp}
              onDoubleClick={onStageDoubleClick}
            >
              {viewMode === "normal" ? (
                <>
                  {/*
                    Slide canvas is always mounted so the parsed SVG
                    survives layout changes (sidebar toggle, zoom, …).
                    If we conditionally unmount the host, the
                    DOMParser-injected `<svg>` is lost; the
                    `[slideSvg]` effect doesn't refire because the
                    state didn't change, so the re-mounted host stays
                    blank until the next slide load.
                   */}
                  <div
                    style={{
                      width: canvasW,
                      height: canvasH,
                      position: "relative",
                      visibility: slideSvg ? "visible" : "hidden",
                    }}
                  >
                    <div
                      ref={slideRef}
                      style={{
                        width: slideW,
                        height: slideH,
                        position: "absolute",
                        left: "50%",
                        top: "50%",
                        transform: `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px))`,
                        background: "white",
                        boxShadow: "0 4px 12px var(--pptx-shell-shadow, rgba(0, 0, 0, 0.45))",
                      }}
                    />
                    <SelectionOverlay
                      boxes={selectionBoxes}
                      rubberBand={rubberBandRect}
                    />
                  </div>
                  {!slideSvg &&
                    (errorMsg ? (
                      <div style={overlayStyle}>{errorMsg}</div>
                    ) : phase ? (
                      // `phase` is set while we're parsing the deck or
                      // preparing the next slide — surface a prominent
                      // centred loading panel with a spinner so the
                      // user doesn't have to scan the bottom-left
                      // status bar to know something is happening.
                      <div style={loadingOverlayStyle} role="status">
                        <div style={loadingSpinnerStyle} aria-hidden="true" />
                        <div style={loadingTextStyle}>
                          {t("viewer.loading")}
                        </div>
                      </div>
                    ) : slideCount === 0 ? (
                      <div style={overlayStyle}>{t("viewer.empty")}</div>
                    ) : (
                      <div style={loadingOverlayStyle} role="status">
                        <div style={loadingSpinnerStyle} aria-hidden="true" />
                        <div style={loadingTextStyle}>
                          {t("viewer.loading")}
                        </div>
                      </div>
                    ))}
                </>
              ) : (
                <GridView
                  slideCount={slideCount}
                  currentSlide={currentSlide}
                  cache={slideCache}
                  aspect={aspect}
                  onSelect={(n) => {
                    setCurrentSlide(n);
                    setViewMode("normal");
                  }}
                  getThumbnail={requestSlide}
                  deckKey={name ?? ""}
                />
              )}
            </main>
          </div>
          {notesOpen && (
            <NotesPanel currentSlide={currentSlide} meta={slideMeta} />
          )}
        </div>

        {/* Search drawer (overlay panel anchored to body). */}
        {searchOpen && (
          <div style={searchDrawerStyle}>
            <header style={searchHeaderStyle}>
              <span>{t("search.title")}</span>
              <button
                style={iconButtonStyle}
                onClick={() => setSearchOpen(false)}
                title={t("common.close")}
                aria-label={t("common.close")}
              >
                <X size={14} weight="bold" />
              </button>
            </header>
            <input
              type="search"
              placeholder={t("search.placeholder")}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                void runSearch(e.target.value);
              }}
              style={searchInputStyle}
              autoFocus
            />
            {searchHits.length === 0 ? (
              <div style={searchEmptyStyle}>
                {searchQuery ? t("search.noMatches") : t("search.typeToSearch")}
              </div>
            ) : (
              <ul style={searchListStyle}>
                {searchHits.map((hit) => (
                  <li
                    key={`${hit.slide_number}-${hit.excerpt}`}
                    style={searchItemStyle}
                    onClick={() => {
                      setCurrentSlide(hit.slide_number);
                      setSearchOpen(false);
                    }}
                  >
                    <span style={searchHitNumStyle}>#{hit.slide_number}</span>
                    <span>{hit.excerpt.replace(/\[\/?match\]/g, "")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ---- Slideshow overlay (presentation/SlideshowOverlay.tsx) ---- */}
      <SlideshowOverlay
        open={slideshow}
        currentSlide={currentSlide}
        slideCount={slideCount}
        setSlideshow={setSlideshow}
        setCurrentSlide={setCurrentSlide}
        fit={fit}
        slideSvg={slideSvg}
        canvasW={canvasW}
        canvasH={canvasH}
        slideW={slideW}
        slideH={slideH}
        slideshowStageRef={slideshowStageRef}
        slideshowSlideRef={slideshowSlideRef}
      />

      {/* ---- Status bar (presentation/StatusBar.tsx) ---- */}
      <StatusBar
        slideshow={slideshow}
        phase={phase}
        errorMsg={errorMsg}
        slideMeta={slideMeta}
        slideCount={slideCount}
        currentSlide={currentSlide}
        selectionFonts={selectionFonts}
        selectionFontsOpen={selectionFontsOpen}
        setSelectionFontsOpen={setSelectionFontsOpen}
        selectionFontsRef={selectionFontsRef}
        fontUsage={fontUsage}
        notesOpen={notesOpen}
        setNotesOpen={setNotesOpen}
        viewMode={viewMode}
        setViewMode={setViewMode}
        zoom={zoom}
        zoomPct={zoomPct}
        setZoom={setZoom}
        setZoomFromPct={setZoomFromPct}
        reset={reset}
      />

      {/* ---- Settings dialog ---- */}
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSettingsChange={(next) => setSettings(next)}
      />

      {/* ---- Shortcuts help dialog (?) ---- */}
      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      {/* ---- Long-running export progress overlay ----
          The status bar at the bottom is too easy to miss on a 100+
          slide deck where Print / PDF can take many seconds before
          the OS print dialog or download fires. A centred modal
          surface confirms the click was received and gives a live
          counter so users don't suspect the click was lost. */}
      {progress && (
        <div
          style={progressHostStyle}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div style={progressBackdropStyle} />
          <div style={progressPanelStyle}>
            <div style={progressTitleStyle}>{progress.title}</div>
            <div style={progressStepStyle}>{progress.step}</div>
            <div style={progressBarTrackStyle}>
              <div
                style={{
                  ...progressBarFillStyle,
                  ...(progress.total && progress.total > 0
                    ? {
                        width: `${Math.min(100, ((progress.current ?? 0) / progress.total) * 100)}%`,
                      }
                    : progressBarIndeterminateStyle),
                }}
              />
            </div>
            {progress.total != null && progress.total > 0 ? (
              <div style={progressCounterStyle}>
                {(progress.current ?? 0)} / {progress.total}
              </div>
            ) : (
              <div style={progressCounterStyle}>&nbsp;</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Subcomponents (`ThumbnailSidebar`, `Thumbnail`, `NotesPanel`,
// `GridView`) live in `presentation/{Thumbnail,NotesPanel,GridView}.tsx`.

