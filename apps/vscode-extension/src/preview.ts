/**
 * `PreviewPanel` — extension-host side of the webview.
 *
 * Responsibilities
 * ----------------
 * 1. Spin up a VS Code webview panel that boots the slideglance/viewer
 *    React shell (Vite-bundled output under `dist/webview/`).
 * 2. Watch the active slide builder XML document (`.sgx` or `.xml` with
 *    the slideglance namespace) for changes, debounce, and rebuild a
 *    fresh PPTX via the builder on every settled edit. One build runs at
 *    a time; edits that land while it runs collapse into a single
 *    rebuild that starts when it ends.
 * 3. Stream the PPTX bytes to the webview.
 * 4. Receive `revealSource` clicks from the webview (a click on any
 *    SVG element carrying `data-object-name="node#N"`) and reveal the
 *    matching source line in the user's editor.
 *
 * Not responsible for
 * -------------------
 * - Rendering. The viewer shell handles SVG paint, navigation, zoom,
 *   thumbnails, etc. — builder-vscode intentionally ships no
 *   slide-rendering UI.
 */

import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import {
  buildPptx,
  parseBuilderDocument,
  type Diagnostic,
  type DiagnosticCode,
  type BuilderSourceMap,
  type BuilderSourcePos,
  type PositionedNode,
} from "@slideglance/builder";
import { CoalescingRunner } from "./coalescingRunner.js";
import { changedByHash, diffSlides, maxNodeId } from "./slideDiff.js";
import { createFsImportResolver } from "./importResolver.js";
import { buildWebviewHtml } from "./webviewHtml.js";

const DEBOUNCE_MS = 500;
// How long a build may run before the preview says it is still working.
// This is a notice, not a deadline: the build keeps running and its result
// is still delivered. Abandoning it would buy nothing — the builder has no
// cancellation, so the CPU is spent either way and giving up only discards
// the finished deck, which on a loaded machine reads as a failed render.
const DEFAULT_SLOW_RENDER_NOTICE_MS = 15_000;

/** `0` (or a negative override) hides the notice entirely. */
function slowRenderNoticeMs(): number {
  const configured = vscode.workspace
    .getConfiguration("slideglance.preview")
    .get<number>("slowRenderNoticeMs");
  return typeof configured === "number" && configured >= 0
    ? configured
    : DEFAULT_SLOW_RENDER_NOTICE_MS;
}
const DEFAULT_SLIDE_WIDTH = 1280;
const DEFAULT_SLIDE_HEIGHT = 720;

const SEVERITY_MAP: Record<DiagnosticCode, vscode.DiagnosticSeverity> = {
  // Parse / render diagnostics
  IMAGE_MEASURE_FAILED: vscode.DiagnosticSeverity.Error,
  IMAGE_NOT_PREFETCHED: vscode.DiagnosticSeverity.Error,
  AUTOFIT_OVERFLOW: vscode.DiagnosticSeverity.Warning,
  SCALE_BELOW_THRESHOLD: vscode.DiagnosticSeverity.Warning,
  MASTER_PPTX_PARSE_FAILED: vscode.DiagnosticSeverity.Warning,
  INVALID_HREF_SCHEME: vscode.DiagnosticSeverity.Warning,
  INVALID_IMAGE_SRC: vscode.DiagnosticSeverity.Warning,
  TEMPLATE_EXPANSION_LIMIT: vscode.DiagnosticSeverity.Error,
  MASTER_PPTX_SIZE_LIMIT: vscode.DiagnosticSeverity.Warning,
  TEMPLATES_NOT_AT_ROOT: vscode.DiagnosticSeverity.Warning,
  INVALID_NUMBER_TYPE: vscode.DiagnosticSeverity.Warning,
  // Lint — Phase A (overflow / dimension)
  OUT_OF_PAGE: vscode.DiagnosticSeverity.Error,
  OUT_OF_PARENT: vscode.DiagnosticSeverity.Error,
  NEGATIVE_DIM: vscode.DiagnosticSeverity.Error,
  ZERO_DIM: vscode.DiagnosticSeverity.Warning,
  TEXT_OVERFLOW_V: vscode.DiagnosticSeverity.Warning,
  TEXT_OVERFLOW_H: vscode.DiagnosticSeverity.Warning,
  TEXT_WRAP_TO_1CH: vscode.DiagnosticSeverity.Error,
  LINE_OVER_PARENT: vscode.DiagnosticSeverity.Warning,
  IMAGE_MISSING: vscode.DiagnosticSeverity.Error,
  // Lint — Phase B (visual coherence)
  BASELINE_MIX_IN_ROW: vscode.DiagnosticSeverity.Warning,
  INFLATED_LINE_HEIGHT_IN_ROW: vscode.DiagnosticSeverity.Warning,
  ANCHOR_INCONSISTENT: vscode.DiagnosticSeverity.Warning,
  OVERLAP_LAYER: vscode.DiagnosticSeverity.Information,
  LOW_CONTRAST: vscode.DiagnosticSeverity.Information,
  // Lint — Phase C (design system)
  UNUSED_STYLE: vscode.DiagnosticSeverity.Information,
  UNUSED_TEMPLATE: vscode.DiagnosticSeverity.Information,
  HARDCODED_COLOR: vscode.DiagnosticSeverity.Information,
  INCONSISTENT_FONT: vscode.DiagnosticSeverity.Information,
  MASTER_COLLISION: vscode.DiagnosticSeverity.Warning,
  // Lint — Phase D (accessibility)
  IMG_NO_ALT: vscode.DiagnosticSeverity.Warning,
  READING_ORDER_AMBIGUOUS: vscode.DiagnosticSeverity.Information,
  ICON_NO_LABEL: vscode.DiagnosticSeverity.Information,
  TINY_FONT: vscode.DiagnosticSeverity.Information,
  // Lint — Phase E (performance)
  LARGE_IMAGE_INLINED: vscode.DiagnosticSeverity.Information,
  EXCESS_NODES: vscode.DiagnosticSeverity.Information,
  SLIDE_FONT_COUNT: vscode.DiagnosticSeverity.Information,
  // Lint — schema integrity
  DUPLICATE_NODE_ID: vscode.DiagnosticSeverity.Error,
  RAW_LT_GT_IN_ATTR: vscode.DiagnosticSeverity.Warning,
  // Lint — connector validity
  UNKNOWN_CONNECTOR_ENDPOINT: vscode.DiagnosticSeverity.Error,
  INVALID_CONNECTOR_SELF_REF: vscode.DiagnosticSeverity.Error,
  CONNECTOR_UNKNOWN_SHAPE_IDX: vscode.DiagnosticSeverity.Error,
};

function toVsDiagnostics(items: Diagnostic[]): vscode.Diagnostic[] {
  const range = new vscode.Range(0, 0, 0, 0);
  return items.map((d) => {
    const diag = new vscode.Diagnostic(
      range,
      `[${d.code}] ${d.message}`,
      SEVERITY_MAP[d.code],
    );
    diag.source = "slidebuilder";
    return diag;
  });
}

interface BuildSuccess {
  type: "success";
  bytes: Uint8Array;
  diagnostics: Diagnostic[];
  sourceMap: BuilderSourceMap | undefined;
  /** Hash of deck-wide content (slideSize, masters, defaultTextStyle …). */
  commonHash: string;
  /** Per-slide content hash. Length === slide count. */
  slideHashes: string[];
  /**
   * `__nodeId` of each slide's root, in deck order. Lets the panel
   * answer "where is page 7 written" without re-parsing — the shape
   * ids in the SVG only reach shapes, and a page is not one.
   */
  slideNodeIds: (number | undefined)[];
  /** Highest `__nodeId` this parse allocated. Closes the last slide's range. */
  maxNodeId: number;
  /** Laid-out slides, kept so the next build can skip unchanged ones. */
  positionedSlides: PositionedNode[] | undefined;
}

/**
 * One thing wrong with the document, with where to find it when the
 * parser knew. `file` is absolute; it is undefined for the root document
 * (the panel already knows which file that is).
 */
export interface BuildIssue {
  text: string;
  file?: string;
  line?: number;
}

interface BuildError {
  type: "error";
  message: string;
  /**
   * `"document"` — the deck's own XML is wrong and the author fixes it.
   * `"internal"` — the builder or the extension failed, and no edit to
   * the document is going to help. The panel says which, because a wall
   * of red otherwise reads the same either way.
   */
  kind: "document" | "internal";
  /** Present for a document error: one entry per reported problem. */
  issues?: BuildIssue[];
}

/** What the panel hands the webview when a build fails. */
interface ErrorPayload {
  error: string;
  kind: "document" | "internal";
  issues?: BuildIssue[];
}

interface BuildEmpty {
  type: "empty";
}

interface BuildNoop {
  type: "noop";
}

interface RenderSnapshot {
  commonHash: string;
  slideHashes: string[];
  /** Slide-root `__nodeId`s from this build, deck order. */
  slideNodeIds: (number | undefined)[];
  /** Highest `__nodeId` this build allocated. */
  maxNodeId: number;
  /**
   * Layout from the build that produced these hashes. Handed back to the
   * next build for the slides whose hash still matches — laying a slide
   * out is where a build spends nearly all of its time, so a one-word
   * edit in a twenty-page deck goes from re-measuring twenty pages to
   * re-measuring one.
   */
  positionedSlides?: PositionedNode[];
}

/** One queued rebuild. */
/**
 * How long the "refreshed" confirmation stays on screen. Long enough to
 * read the timestamp, short enough not to sit over the deck.
 */
const REFRESH_NOTICE_MS = 2500;

interface RenderRequest {
  /** Source XML to build. */
  content: string;
  /** Document `content` was read from, captured at queue time. */
  uri: vscode.Uri;
  /**
   * Ignore the previous render's snapshot so the webview receives a full
   * reload instead of a slide-level diff. Set by an explicit refresh and
   * by a swap to a different document.
   */
  full: boolean;
  /**
   * The user asked for this build from the Refresh button. A rebuild
   * whose output is identical changes nothing on screen, so the panel
   * confirms it finished — otherwise the button reads as dead.
   */
  refresh?: boolean;
  /**
   * Build even when every hash matches the previous render.
   *
   * A rebuild the source did not change is normally nothing to ship,
   * which is why the noop path exists. Someone who pressed Render meant
   * exactly that build, so this carries their intent past the check —
   * the layout snapshot is kept, so it is still the cheap path.
   */
  force?: boolean;
  /**
   * Slides to repaint, in place of the diff this build would compute.
   * `[]` is not a value here — an empty list means "nothing changed",
   * which is the opposite of what a Render request asks for.
   */
  invalidate?: number[];
}

/** What a caller of `render()` wants beyond the source itself. */
interface RenderOptions {
  full?: boolean;
  refresh?: boolean;
  force?: boolean;
  invalidate?: number[];
}

/** SHA-1 keyed change detection — not adversarial, just collision-rare. */
function sha1(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex");
}

/**
 * Strip per-parse `__nodeId` fields so source-position metadata —
 * which changes every parse even when the underlying XML is byte
 * identical — does not perturb the content hash.
 */
function stripPomIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPomIds);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "__nodeId") continue;
      out[k] = stripPomIds(v);
    }
    return out;
  }
  return value;
}

function hashNode(value: unknown): string {
  return sha1(JSON.stringify(stripPomIds(value)));
}

/**
 * Build a PPTX buffer plus per-slide content hashes the panel uses
 * to drive surgical (cache-preserving) updates in the slideglance
 * viewer. Returns `{ type: "noop" }` when both the deck-wide
 * structure and every slide's source XML are byte-identical to
 * `previous` — saving the host the cost of running buildPptx /
 * pptxgenjs / shipping a fresh bundle to the webview.
 */
async function buildPptxFromXml(
  content: string,
  documentPath: string,
  previous: RenderSnapshot | undefined,
  importTracker: Set<string>,
  /**
   * Called once the change set is known and before the expensive part
   * starts, so the panel can mark those slides in flight. `undefined`
   * means the whole deck: either the first render, or a change to
   * something every slide depends on (slide size, a master, the default
   * text style, the slide count).
   */
  onPlan?: (changedSlides: number[] | undefined) => void,
  /** Skip the "nothing changed, ship nothing" shortcut. */
  force = false,
): Promise<BuildSuccess | BuildError | BuildEmpty | BuildNoop> {
  // Reset before each build so removed <Import>s drop out of the set
  // and an emptied document stops triggering rebuilds from prior imports.
  importTracker.clear();
  if (!content.trim()) return { type: "empty" };
  try {
    const importResolver = createFsImportResolver(importTracker);
    const { document } = parseBuilderDocument(content, {
      resolveImport: importResolver,
      sourcePath: documentPath,
      equalize: true,
      // This parse runs before the build and is the one that throws on a
      // malformed document, so it has to be the one carrying source
      // positions — without it every validation error reaches the panel
      // as bare text with nothing to click.
      trackSourcePos: true,
    });
    if (document.nodes.length === 0) return { type: "empty" };
    const slideWidth = document.slideSize?.w ?? DEFAULT_SLIDE_WIDTH;
    const slideHeight = document.slideSize?.h ?? DEFAULT_SLIDE_HEIGHT;

    // Hash before building. PPTX assembly + pptxgenjs serialization is
    // the dominant cost (50–500 ms); parse-time hashing is negligible.
    // When both the common-hash and every per-slide hash match the
    // previous successful render, the whole build is a no-op for the
    // webview.
    const commonPayload = {
      slideSize: document.slideSize ?? { w: slideWidth, h: slideHeight },
      masters: document.masters ?? null,
      masterContents: document.masterContents ?? null,
      defaultMaster: document.defaultMaster ?? null,
      defaultTextStyle: document.defaultTextStyle ?? null,
      slideCount: document.nodes.length,
    };
    const commonHash = hashNode(commonPayload);
    const slideHashes = document.nodes.map((node) => hashNode(node));

    if (
      !force &&
      previous &&
      previous.commonHash === commonHash &&
      previous.slideHashes.length === slideHashes.length &&
      previous.slideHashes.every((h, i) => h === slideHashes[i])
    ) {
      return { type: "noop" };
    }

    onPlan?.(
      previous &&
        previous.commonHash === commonHash &&
        previous.slideHashes.length === slideHashes.length
        ? changedByHash(previous, { slideHashes })
        : undefined,
    );

    // Reuse the layout of every slide whose content hash is unchanged.
    // Only valid when the deck-wide inputs (slide size, masters, default
    // text style, slide count) are identical too — they feed every
    // slide's boxes, and `commonHash` covers exactly that set.
    const reuseSlideLayout =
      previous?.positionedSlides &&
      previous.commonHash === commonHash &&
      previous.slideHashes.length === slideHashes.length
        ? slideHashes.map((hash, i) =>
            previous.slideHashes[i] === hash
              ? previous.positionedSlides?.[i]
              : undefined,
          )
        : undefined;

    const built = await buildPptx(
      content,
      { w: slideWidth, h: slideHeight },
      {
        textMeasurement: "auto",
        trackSourcePos: true,
        resolveImport: importResolver,
        sourcePath: documentPath,
        equalize: true,
        ...(reuseSlideLayout ? { reuseSlideLayout } : {}),
      },
    );
    const bytes = await built.pptx.write({ outputType: "uint8array" });
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("Unexpected output type from pptx.write");
    }
    return {
      type: "success",
      bytes,
      diagnostics: built.diagnostics,
      sourceMap: built.sourceMap,
      commonHash,
      slideHashes,
      slideNodeIds: document.nodes.map((node) => node.__nodeId),
      maxNodeId: maxNodeId(document.sourceMap),
      positionedSlides: built.positionedSlides,
    };
  } catch (err) {
    return toBuildError(err, documentPath);
  }
}

/**
 * Sorts a thrown value into a document problem the author can fix and a
 * failure of the tooling itself.
 *
 * `ParseXmlError` carries the individual validation errors; each one is
 * split back into its `file:line: ` prefix (added by the parser when
 * source positions are tracked) and the message, so the panel can offer
 * each as a jump into the file.
 */
function toBuildError(err: unknown, documentPath: string): BuildError {
  const message = err instanceof Error ? err.message : String(err);
  const errors =
    err instanceof Error && err.name === "ParseXmlError"
      ? ((err as Error & { errors?: unknown }).errors ?? [])
      : undefined;
  if (!Array.isArray(errors))
    return { type: "error", message, kind: "internal" };

  const issues = errors
    .filter((e): e is string => typeof e === "string")
    .map((raw) => parseIssue(raw, documentPath));
  return {
    type: "error",
    message,
    kind: "document",
    issues,
  };
}

/**
 * Splits `path:line: message` or `line N: message` off the front of a
 * validation error. Anything else comes back as text with no location —
 * the parser omits the prefix when it has no position for the element.
 */
function parseIssue(raw: string, documentPath: string): BuildIssue {
  const withFile = /^(.+?):(\d+): ([\s\S]*)$/.exec(raw);
  if (withFile && withFile[1] && withFile[2] && withFile[3] !== undefined) {
    return {
      text: withFile[3],
      file: withFile[1],
      line: Number.parseInt(withFile[2], 10),
    };
  }
  const bareLine = /^line (\d+): ([\s\S]*)$/.exec(raw);
  if (bareLine && bareLine[1] && bareLine[2] !== undefined) {
    return {
      text: bareLine[2],
      file: documentPath,
      line: Number.parseInt(bareLine[1], 10),
    };
  }
  return { text: raw };
}

/**
 * Parse `node#N` out of a `data-object-name` value. Returns the integer
 * `N` (matching `__nodeId` on BuilderNodes) or `undefined` when the value
 * does not follow the pom convention.
 */
function parsePomObjectName(objectName: string): number | undefined {
  const m = /^node#(\d+)$/.exec(objectName);
  if (!m) return undefined;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : undefined;
}

export class PreviewPanel {
  private static instance: PreviewPanel | undefined;
  private static diagnosticCollection: vscode.DiagnosticCollection | undefined;
  private static outputChannel: vscode.OutputChannel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private documentUri: vscode.Uri;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Serializes rebuilds. A build cannot be cancelled, so two overlapping
   * ones only slow each other down on the extension host's single thread
   * while at most one of the two decks is ever shown.
   */
  private readonly renders: CoalescingRunner<RenderRequest>;
  /** Latest slow-render notice, replayed once the webview reports ready. */
  private currentStatus: string | undefined;
  /** Clears the "Refreshed ..." confirmation once it has been read. */
  private refreshNoticeTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Monotonic counter the webview uses as a React `key` on the viewer
   * shell. Bumped only when the *deck identity* changes (new document
   * via `createOrShow`, or an explicit `forceRefresh`) — NOT on edit
   * cycles for the same document, which must remain incremental. The
   * webview remounts `<PptxPresentation>` whenever this value changes,
   * which clears the viewer's slide index, zoom, pan, search, and any
   * stale UI state from the previous deck.
   */
  private deckGeneration = 0;
  private webviewReady = false;
  private pendingPayload:
    | {
        bytes: Uint8Array;
        name: string;
        invalidatedSlides?: number[];
        deckGeneration: number;
      }
    | ErrorPayload
    | undefined;
  private sourceMap: BuilderSourceMap | undefined;
  /** Slide-root ids from the most recent successful build, deck order. */
  private slideNodeIds: (number | undefined)[] = [];
  private lastRender: RenderSnapshot | undefined;
  /** Absolute paths of every file the most recent build pulled in via
   *  `<Import>`. Used by `isTrackedImport` so the host re-renders the
   *  preview when an imported file (which is not the root document) is
   *  edited. Populated by the resolver during build. */
  private readonly importedPaths = new Set<string>();
  private disposed = false;

  static setDiagnosticCollection(c: vscode.DiagnosticCollection): void {
    PreviewPanel.diagnosticCollection = c;
  }

  static setOutputChannel(c: vscode.OutputChannel): void {
    PreviewPanel.outputChannel = c;
  }

  private static log(message: string): void {
    PreviewPanel.outputChannel?.appendLine(`[pom] ${message}`);
  }

  /**
   * Returns true when `uri` points at a file that the most recent
   * successful build pulled in via `<Import>`. The host listens to
   * text changes on every document and uses this predicate to decide
   * whether a non-slide-XML edit should still retrigger the preview.
   */
  static isTrackedImport(uri: vscode.Uri): boolean {
    const inst = PreviewPanel.instance;
    if (!inst || inst.disposed) return false;
    return inst.importedPaths.has(uri.fsPath);
  }

  /**
   * URI of the slide builder XML the preview panel is currently
   * showing. Used by the export command so a click on the preview
   * toolbar's Export button resolves the source even when the user's
   * focus is on the preview webview rather than a text editor.
   */
  static getDocumentUri(): vscode.Uri | undefined {
    const inst = PreviewPanel.instance;
    if (!inst || inst.disposed) return undefined;
    return inst.documentUri;
  }

  static forceRefresh(): void {
    const inst = PreviewPanel.instance;
    if (!inst || inst.disposed) return;
    if (inst.debounceTimer) clearTimeout(inst.debounceTimer);
    // Ask for a full (rather than incremental) reload — refresh exists
    // so the user can recover from a stale viewer state. Bump the deck
    // generation so the webview also remounts the viewer shell.
    inst.deckGeneration++;
    void inst.renderFromTargetUri({ full: true, refresh: true });
  }

  static createOrShow(
    extensionUri: vscode.Uri,
    document: vscode.TextDocument,
  ): void {
    if (PreviewPanel.instance) {
      const oldUri = PreviewPanel.instance.documentUri;
      const swapped = oldUri.toString() !== document.uri.toString();
      if (swapped) {
        PreviewPanel.diagnosticCollection?.delete(oldUri);
        // Different file → send a full reload, flushing the viewer's
        // slide cache. Bump the deck generation so the webview unmounts
        // the existing `<PptxPresentation>` and remounts a fresh one —
        // fully resets currentSlide / zoom / pan / search / dialog state
        // that would otherwise leak from the previous deck.
        PreviewPanel.instance.deckGeneration++;
      }
      PreviewPanel.instance.documentUri = document.uri;
      PreviewPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      PreviewPanel.instance.render(document.getText(), { full: swapped });
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "slideBuilderPreview",
      "SlideGlance Preview",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    PreviewPanel.instance = new PreviewPanel(panel, extensionUri, document);
  }

  static attach(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    document: vscode.TextDocument,
  ): void {
    if (PreviewPanel.instance && !PreviewPanel.instance.disposed) {
      PreviewPanel.instance.panel.dispose();
    }
    PreviewPanel.instance = new PreviewPanel(panel, extensionUri, document);
  }

  /**
   * Rebuild because a file changed on disk rather than in the editor.
   *
   * Reached from the file-system watcher, which is the only thing that
   * hears a build script rewriting a generated master or fragment. The
   * source is re-read from the target document rather than from `uri`,
   * because `uri` is usually an `<Import>` several files below the deck
   * root and the build always starts from the root.
   */
  static updateFromDisk(uri: vscode.Uri): void {
    const inst = PreviewPanel.instance;
    if (!inst || inst.disposed) return;
    // A file the editor has open and dirty is the editor's version, not
    // the disk's; the text listeners already carry those edits and the
    // resolver prefers the buffer. Rebuilding here would render the
    // saved bytes over the ones the author is looking at.
    const openDirty = vscode.workspace.textDocuments.some(
      (doc) => doc.uri.fsPath === uri.fsPath && doc.isDirty,
    );
    if (openDirty) return;
    if (inst.debounceTimer) clearTimeout(inst.debounceTimer);
    inst.debounceTimer = setTimeout(() => {
      void inst.renderFromTargetUri({});
    }, DEBOUNCE_MS);
  }

  static update(document: vscode.TextDocument): void {
    const inst = PreviewPanel.instance;
    if (!inst || inst.disposed) return;
    const isTarget = inst.documentUri.toString() === document.uri.toString();
    if (inst.debounceTimer) clearTimeout(inst.debounceTimer);
    inst.debounceTimer = setTimeout(() => {
      if (isTarget) inst.render(document.getText());
      else void inst.renderFromTargetUri({});
    }, DEBOUNCE_MS);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    document: vscode.TextDocument,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.documentUri = document.uri;
    this.renders = new CoalescingRunner<RenderRequest>(
      (request) => this.runBuild(request),
      (err) =>
        PreviewPanel.log(
          `render failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      // The newest content wins, but a superseded request's demands
      // survive it: an edit arriving right after the Refresh button must
      // still drop the snapshot and still confirm when it lands.
      (superseded, next) => ({
        ...next,
        full: superseded.full || next.full,
        refresh: superseded.refresh || next.refresh,
        force: superseded.force || next.force,
        // Union rather than newest-wins: a Render page request that a
        // keystroke overtakes still has to repaint the page it named.
        ...(superseded.invalidate || next.invalidate
          ? {
              invalidate: [
                ...new Set([
                  ...(superseded.invalidate ?? []),
                  ...(next.invalidate ?? []),
                ]),
              ],
            }
          : {}),
      }),
    );

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
    };
    panel.webview.html = buildWebviewHtml(this.extensionUri, panel.webview);

    panel.onDidDispose(() => {
      this.disposed = true;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      if (this.refreshNoticeTimer) clearTimeout(this.refreshNoticeTimer);
      PreviewPanel.diagnosticCollection?.delete(this.documentUri);
      PreviewPanel.instance = undefined;
    });

    panel.webview.onDidReceiveMessage((message: unknown) => {
      if (!message || typeof message !== "object") return;
      const m = message as {
        type?: string;
        objectName?: string;
        file?: string;
        line?: number;
        scope?: string;
        slide?: number;
        text?: string;
      };
      if (m.type === "ready") {
        this.webviewReady = true;
        this.flushPending();
        return;
      }
      if (m.type === "revealSource" && typeof m.objectName === "string") {
        this.revealFromObjectName(m.objectName);
        return;
      }
      if (m.type === "rerender") {
        this.handleRerender(
          m.scope === "all" ? "all" : "slide",
          typeof m.slide === "number" ? m.slide : 1,
        );
        return;
      }
      if (m.type === "copyText" && typeof m.text === "string") {
        void PreviewPanel.copyToClipboard(m.text, "Copied the shape's text.");
        return;
      }
      if (m.type === "copyPagePrompt") {
        this.handleCopyPagePrompt(typeof m.slide === "number" ? m.slide : 1);
        return;
      }
      if (m.type === "copyPrompt" && typeof m.objectName === "string") {
        this.handleCopyPrompt(
          m.objectName,
          typeof m.slide === "number" ? m.slide : 1,
          typeof m.text === "string" ? m.text : "",
        );
        return;
      }
      if (m.type === "revealAt" && typeof m.line === "number") {
        // A click on a validation error. `file` is absent when the
        // parser reported a line without a file, which means the root
        // document.
        this.revealAt(typeof m.file === "string" ? m.file : undefined, m.line);
        return;
      }
    });

    this.render(document.getText());
  }

  private async renderFromTargetUri(opts: RenderOptions = {}): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(this.documentUri);
      this.render(doc.getText(), opts);
    } catch (err) {
      PreviewPanel.log(
        `renderFromTargetUri failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Queue a rebuild for `content`. Returns at once — the build runs
   * behind `this.renders`, which holds one build in flight and collapses
   * everything queued behind it into the newest request.
   */
  private render(content: string, opts: RenderOptions = {}): void {
    this.renders.submit({
      content,
      uri: this.documentUri,
      full: opts.full ?? false,
      ...(opts.refresh ? { refresh: true } : {}),
      ...(opts.force ? { force: true } : {}),
      ...(opts.invalidate ? { invalidate: opts.invalidate } : {}),
    });
  }

  private async runBuild(request: RenderRequest): Promise<void> {
    // The panel can close while a build is in flight, leaving the next
    // request queued behind it. Building for a closed panel only burns
    // the extension host's thread.
    if (this.disposed) return;

    // Drop the snapshot here rather than where the refresh was asked
    // for. Builds are serialized, so nothing can write a fresh snapshot
    // between this line and the build below; clearing it at request
    // time would let a build already in flight put one back, and the
    // refresh would then come out as a no-op.
    if (request.full) this.lastRender = undefined;

    // The notice fires *beside* the build rather than racing it: a race
    // settles on whichever lands first, and when that is the notice the
    // finished deck is thrown away. Giving up buys nothing — the builder
    // has no cancellation, so the work runs to completion either way.
    const noticeMs = slowRenderNoticeMs();
    const noticeTimer =
      noticeMs > 0
        ? setTimeout(() => {
            if (this.disposed) return;
            PreviewPanel.log(`render still running after ${noticeMs} ms`);
            this.sendStatus(
              `Still rendering — this build has been running for over ${Math.round(
                noticeMs / 1000,
              )}s. The preview updates as soon as it finishes.`,
            );
          }, noticeMs)
        : undefined;

    let result: BuildSuccess | BuildError | BuildEmpty | BuildNoop;
    try {
      result = await buildPptxFromXml(
        request.content,
        request.uri.fsPath,
        this.lastRender,
        this.importedPaths,
        (changedSlides) => this.sendPending(changedSlides),
        request.force,
      );
    } finally {
      if (noticeTimer !== undefined) clearTimeout(noticeTimer);
      this.sendStatus(undefined);
      this.sendPending([]);
    }

    if (this.disposed) return;
    // A newer request arrived while this one built, so this deck is
    // stale before it can be shown. Return without recording a snapshot:
    // one the webview never received would make the next diff skip the
    // very slides the webview is missing.
    if (this.renders.hasPending) return;

    if (result.type === "noop") {
      // Hashes match the previous render — nothing to ship, which is
      // exactly when a refresh needs saying so.
      this.confirmRefresh(request);
      return;
    }
    if (result.type === "empty") {
      this.queueOrSend({
        error: "No slides to preview",
        kind: "document",
      });
      // `sourceMap` and `slideNodeIds` describe the deck on screen, and
      // that deck is still the last build that succeeded — clearing them
      // here would break source-reveal and the copy actions for pages
      // the reader can still see and click. `lastRender` is different:
      // it is the diff baseline, and the next successful build has to
      // ship in full rather than against a deck that never landed.
      this.lastRender = undefined;
      PreviewPanel.diagnosticCollection?.delete(request.uri);
      return;
    }
    if (result.type === "error") {
      PreviewPanel.log(`render error: ${result.message}`);
      this.queueOrSend({
        error: result.message,
        kind: result.kind,
        ...(result.issues ? { issues: result.issues } : {}),
      });
      // `sourceMap` and `slideNodeIds` describe the deck on screen, and
      // that deck is still the last build that succeeded — clearing them
      // here would break source-reveal and the copy actions for pages
      // the reader can still see and click. `lastRender` is different:
      // it is the diff baseline, and the next successful build has to
      // ship in full rather than against a deck that never landed.
      this.lastRender = undefined;
      PreviewPanel.diagnosticCollection?.delete(request.uri);
      return;
    }

    // Successful build. Compute which slides the viewer needs to
    // invalidate from its cache:
    //   - first render OR deck-wide structure changed → undefined
    //     (viewer falls back to flushing the whole cache).
    //   - subsequent same-shape render → array of 1-based indices
    //     whose source XML changed since `lastRender`.
    // A Render request names the pages it wants repainted; everything
    // else asks the diff which pages the edit touched.
    const diff = request.invalidate
      ? request.invalidate
      : this.lastRender
        ? diffSlides(this.lastRender, {
            commonHash: result.commonHash,
            slideHashes: result.slideHashes,
            slideNodeIds: result.slideNodeIds,
            maxNodeId: result.maxNodeId,
          })
        : undefined;

    this.lastRender = {
      commonHash: result.commonHash,
      slideHashes: result.slideHashes,
      slideNodeIds: result.slideNodeIds,
      maxNodeId: result.maxNodeId,
      ...(result.positionedSlides
        ? { positionedSlides: result.positionedSlides }
        : {}),
    };
    this.sourceMap = result.sourceMap;
    this.slideNodeIds = result.slideNodeIds;
    const fileName = path.basename(request.uri.fsPath);
    this.queueOrSend({
      bytes: result.bytes,
      name: fileName,
      deckGeneration: this.deckGeneration,
      ...(diff !== undefined ? { invalidatedSlides: diff } : {}),
    });

    if (result.diagnostics.length > 0) {
      PreviewPanel.diagnosticCollection?.set(
        request.uri,
        toVsDiagnostics(result.diagnostics),
      );
    } else {
      PreviewPanel.diagnosticCollection?.delete(request.uri);
    }

    this.confirmRefresh(request);
  }

  /**
   * Says a Refresh finished, stamped with the time it landed.
   *
   * A rebuild that produces the same deck leaves the screen untouched,
   * so the button is indistinguishable from a dead one. The timestamp
   * also separates two clicks in a row, which a fixed word would not.
   * Errors and the empty-deck case skip this — they put their own
   * message on screen.
   */
  private confirmRefresh(request: RenderRequest): void {
    if (!request.refresh || this.disposed) return;
    const at = new Date().toLocaleTimeString();
    this.sendStatus(`Refreshed ${at}`);
    if (this.refreshNoticeTimer) clearTimeout(this.refreshNoticeTimer);
    this.refreshNoticeTimer = setTimeout(() => {
      this.refreshNoticeTimer = undefined;
      if (this.disposed) return;
      // Leave a slow-render notice from a later build alone.
      if (this.currentStatus?.startsWith("Refreshed ")) {
        this.sendStatus(undefined);
      }
    }, REFRESH_NOTICE_MS);
  }

  private queueOrSend(
    payload:
      | {
          bytes: Uint8Array;
          name: string;
          invalidatedSlides?: number[];
          deckGeneration: number;
        }
      | ErrorPayload,
  ): void {
    if (!this.webviewReady) {
      this.pendingPayload = payload;
      return;
    }
    this.send(payload);
  }

  private flushPending(): void {
    // Replay the notice too. Until the first deck lands the webview shows
    // a bare spinner, which is exactly where a long build is hardest to
    // tell apart from a hang.
    if (this.currentStatus !== undefined) this.postStatus(this.currentStatus);
    if (!this.pendingPayload) return;
    const next = this.pendingPayload;
    this.pendingPayload = undefined;
    this.send(next);
  }

  /**
   * Report that a build is taking a while, or withdraw that report with
   * `undefined`. Deliberately non-destructive: the deck already on screen
   * and its diagnostics stay put while the build runs on.
   */
  private sendStatus(message: string | undefined): void {
    if (this.currentStatus === message) return;
    this.currentStatus = message;
    this.postStatus(message);
  }

  /**
   * Tells the webview which slides are being rebuilt so their thumbnails
   * can say so. `undefined` means every slide — a change to something
   * the whole deck depends on, or the first render. An empty array
   * clears the marks.
   */
  private sendPending(slides: number[] | undefined): void {
    if (this.disposed || !this.webviewReady) return;
    void this.panel.webview.postMessage({
      type: "pending",
      slides: slides ?? null,
    });
  }

  private postStatus(message: string | undefined): void {
    if (this.disposed || !this.webviewReady) return;
    void this.panel.webview.postMessage({
      type: "status",
      message: message ?? null,
    });
  }

  private send(
    payload:
      | {
          bytes: Uint8Array;
          name: string;
          invalidatedSlides?: number[];
          deckGeneration: number;
        }
      | ErrorPayload,
  ): void {
    if ("error" in payload) {
      void this.panel.webview.postMessage({
        type: "error",
        message: payload.error,
        kind: payload.kind,
        ...(payload.issues ? { issues: payload.issues } : {}),
      });
      return;
    }
    void this.panel.webview.postMessage({
      type: "pptx",
      bytes: payload.bytes,
      name: payload.name,
      deckGeneration: payload.deckGeneration,
      ...(payload.invalidatedSlides !== undefined
        ? { invalidatedSlides: payload.invalidatedSlides }
        : {}),
    });
  }

  /**
   * Rebuild on demand.
   *
   * `"all"` bumps the deck generation so the webview remounts the
   * viewer and every cached page goes — the reader keeps their place
   * because the viewer is told which page to open on. `"slide"` leaves
   * the deck mounted and names one page to repaint, which is the whole
   * point of the narrower button: a hundred-page deck should not
   * re-rasterise to refresh the one page on screen.
   *
   * Both carry `force`, so a build whose source is byte-identical to
   * the last one still ships. Someone who presses Render is saying the
   * screen and the source have drifted, and the hashes are exactly what
   * they are disputing.
   */
  private handleRerender(scope: "all" | "slide", slide: number): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (scope === "all") {
      this.deckGeneration++;
      void this.renderFromTargetUri({ full: true, refresh: true, force: true });
      return;
    }
    void this.renderFromTargetUri({
      force: true,
      refresh: true,
      invalidate: [Math.max(1, Math.trunc(slide))],
    });
  }

  /**
   * Copy a description of one shape precise enough for an LLM to edit
   * the right lines without opening the deck.
   *
   * What it has to carry, and why: the page, because a chapter file
   * holds several and the reader is looking at one; the file and line
   * range, because that is the edit target; the template chain, because
   * a shape drawn on page 7 can be defined in a template two files away
   * and the line under the cursor is the `<Use>` that called it, not
   * the markup that drew it.
   */
  /** `file:line` or `file:line-endLine` for one source position. */
  private formatSpan(
    file: string | undefined,
    line: number,
    endLine: number | undefined,
  ): string {
    const where = file ?? this.documentUri.fsPath;
    return endLine && endLine > line
      ? `${where}:${line}-${endLine}`
      : `${where}:${line}`;
  }

  /**
   * The lines every copied prompt opens with.
   *
   * An LLM reading this has to know it is looking at a SlideGlance
   * `.sgx` deck rather than loose XML, or it edits the markup by
   * guesswork instead of loading the grammar. Naming the product and
   * the skill up front is what makes the rest of the coordinates
   * usable.
   */
  private promptHeader(slide: number): string[] {
    const total = this.slideNodeIds.length;
    return [
      "SlideGlance deck (.sgx) — load the `slideglance-pptx` skill before editing.",
      "",
      `Deck: ${path.basename(this.documentUri.fsPath)} (${this.documentUri.fsPath})`,
      total > 0 ? `Page: ${slide} of ${total}` : `Page: ${slide}`,
    ];
  }

  /**
   * Render a template chain under whatever named the element.
   *
   * A shape drawn through a template has two edit targets and they are
   * not interchangeable: the `<Use>` carries the arguments, each
   * template below carries the markup that draws it. Naming only one
   * sends the reader to the wrong file half the time.
   */
  private templateChainLines(pos: BuilderSourcePos): string[] {
    const via = pos.via ?? [];
    if (via.length === 0) return [];
    return [
      ...via.map(
        (v) =>
          `  drawn by <Template name="${v.template}"> at ${this.formatSpan(
            v.file,
            v.line,
            v.endLine,
          )}`,
      ),
      "  (the first location is the <Use> call; the template lines are the markup)",
    ];
  }

  /**
   * Copy where one whole page is written.
   *
   * Reached from a right-click on a thumbnail, where the shape under
   * the cursor is incidental — the reader picked a page, so the answer
   * is the page's `<Slide>` and the chapter file holding it, not
   * whichever rectangle the pointer happened to be over.
   */
  private handleCopyPagePrompt(slide: number): void {
    const id = this.slideNodeIds[slide - 1];
    const pos = id === undefined ? undefined : this.sourceMap?.get(id);
    if (!pos) {
      void vscode.window.showWarningMessage(
        `No source position for page ${slide} — rebuild the preview and try again.`,
      );
      return;
    }
    const lines = [
      ...this.promptHeader(slide),
      `Slide: ${this.formatSpan(pos.file, pos.line, pos.endLine)}`,
      ...this.templateChainLines(pos),
    ];
    void PreviewPanel.copyToClipboard(
      lines.join("\n"),
      `Copied the source location of page ${slide}.`,
    );
  }

  private handleCopyPrompt(
    objectName: string,
    slide: number,
    text: string,
  ): void {
    const id = parsePomObjectName(objectName);
    const pos = id === undefined ? undefined : this.sourceMap?.get(id);
    if (!pos) {
      void vscode.window.showWarningMessage(
        "No source position for that shape — rebuild the preview and try again.",
      );
      return;
    }
    const lines = [
      ...this.promptHeader(slide),
      `Element: ${this.formatSpan(pos.file, pos.line, pos.endLine)}`,
      ...this.templateChainLines(pos),
    ];
    if (text) lines.push(`Text: ${JSON.stringify(text)}`);

    void PreviewPanel.copyToClipboard(
      lines.join("\n"),
      `Copied the source location of the shape on page ${slide}.`,
    );
  }

  private static async copyToClipboard(
    text: string,
    confirmation: string,
  ): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(text);
      void vscode.window.setStatusBarMessage(confirmation, 3000);
    } catch (err) {
      PreviewPanel.log(
        `clipboard write failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      void vscode.window.showErrorMessage("Could not write to the clipboard.");
    }
  }

  /**
   * Opens `file` (or the previewed document) with the cursor on `line`.
   * Used by the failure screen so a validation error is one click from
   * the text that caused it.
   */
  private revealAt(file: string | undefined, line: number): void {
    const targetUri = file ? vscode.Uri.file(file) : this.documentUri;
    void (async () => {
      try {
        const doc = await vscode.workspace.openTextDocument(targetUri);
        const zeroBased = Math.max(0, line - 1);
        const range = new vscode.Range(zeroBased, 0, zeroBased, 0);
        await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: false,
          selection: range,
        });
      } catch (err) {
        PreviewPanel.log(
          `revealAt failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
  }

  private revealFromObjectName(objectName: string): void {
    const id = parsePomObjectName(objectName);
    if (id === undefined) return;
    const pos = this.sourceMap?.get(id);
    if (!pos) return;
    const targetUri = pos.file ? vscode.Uri.file(pos.file) : this.documentUri;
    void (async () => {
      try {
        const doc = await vscode.workspace.openTextDocument(targetUri);
        const zeroBased = Math.max(0, pos.line - 1);
        const range = new vscode.Range(zeroBased, 0, zeroBased, 0);
        await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: false,
          selection: range,
        });
      } catch (err) {
        PreviewPanel.log(
          `revealSource failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
  }
}
