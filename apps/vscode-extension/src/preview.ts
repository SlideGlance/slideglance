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
} from "@slideglance/builder";
import { CoalescingRunner } from "./coalescingRunner.js";
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
}

interface BuildError {
  type: "error";
  message: string;
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
}

/** One queued rebuild. */
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
      previous &&
      previous.commonHash === commonHash &&
      previous.slideHashes.length === slideHashes.length &&
      previous.slideHashes.every((h, i) => h === slideHashes[i])
    ) {
      return { type: "noop" };
    }

    const built = await buildPptx(
      content,
      { w: slideWidth, h: slideHeight },
      {
        textMeasurement: "auto",
        trackSourcePos: true,
        resolveImport: importResolver,
        sourcePath: documentPath,
        equalize: true,
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
    };
  } catch (err) {
    return {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Compute the slide indices whose source XML changed between two
 * successful renders. Returns:
 *
 *  - `undefined`: deck-wide structure changed (slide count differed,
 *    masters changed, etc.) — caller sends a full reload, viewer
 *    flushes the entire cache.
 *  - `[]`: nothing changed (caller should not happen here — that case
 *    is `BuildNoop`, not a successful build with diff `[]`).
 *  - `[i, j, …]`: 1-based indices whose content hash differs. Caller
 *    forwards exactly these to the viewer for selective cache
 *    invalidation.
 */
function diffSlides(
  prev: RenderSnapshot,
  next: { commonHash: string; slideHashes: string[] },
): number[] | undefined {
  if (
    prev.commonHash !== next.commonHash ||
    prev.slideHashes.length !== next.slideHashes.length
  ) {
    return undefined;
  }
  const out: number[] = [];
  for (let i = 0; i < next.slideHashes.length; i++) {
    if (prev.slideHashes[i] !== next.slideHashes[i]) out.push(i + 1);
  }
  return out;
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
    | { error: string }
    | undefined;
  private sourceMap: BuilderSourceMap | undefined;
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
    void inst.renderFromTargetUri(true);
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
      PreviewPanel.instance.render(document.getText(), swapped);
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

  static update(document: vscode.TextDocument): void {
    const inst = PreviewPanel.instance;
    if (!inst || inst.disposed) return;
    const isTarget = inst.documentUri.toString() === document.uri.toString();
    if (inst.debounceTimer) clearTimeout(inst.debounceTimer);
    inst.debounceTimer = setTimeout(() => {
      if (isTarget) inst.render(document.getText());
      else void inst.renderFromTargetUri();
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
    );

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
    };
    panel.webview.html = buildWebviewHtml(this.extensionUri, panel.webview);

    panel.onDidDispose(() => {
      this.disposed = true;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      PreviewPanel.diagnosticCollection?.delete(this.documentUri);
      PreviewPanel.instance = undefined;
    });

    panel.webview.onDidReceiveMessage((message: unknown) => {
      if (!message || typeof message !== "object") return;
      const m = message as { type?: string; objectName?: string };
      if (m.type === "ready") {
        this.webviewReady = true;
        this.flushPending();
        return;
      }
      if (m.type === "revealSource" && typeof m.objectName === "string") {
        this.revealFromObjectName(m.objectName);
        return;
      }
    });

    this.render(document.getText());
  }

  private async renderFromTargetUri(full = false): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(this.documentUri);
      this.render(doc.getText(), full);
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
  private render(content: string, full = false): void {
    this.renders.submit({ content, uri: this.documentUri, full });
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
      );
    } finally {
      if (noticeTimer !== undefined) clearTimeout(noticeTimer);
      this.sendStatus(undefined);
    }

    if (this.disposed) return;
    // A newer request arrived while this one built, so this deck is
    // stale before it can be shown. Return without recording a snapshot:
    // one the webview never received would make the next diff skip the
    // very slides the webview is missing.
    if (this.renders.hasPending) return;

    if (result.type === "noop") {
      // Hashes match the previous render — nothing to ship.
      return;
    }
    if (result.type === "empty") {
      this.queueOrSend({ error: "No slides to preview" });
      this.sourceMap = undefined;
      this.lastRender = undefined;
      PreviewPanel.diagnosticCollection?.delete(request.uri);
      return;
    }
    if (result.type === "error") {
      PreviewPanel.log(`render error: ${result.message}`);
      this.queueOrSend({ error: result.message });
      this.sourceMap = undefined;
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
    const diff = this.lastRender
      ? diffSlides(this.lastRender, {
          commonHash: result.commonHash,
          slideHashes: result.slideHashes,
        })
      : undefined;

    this.lastRender = {
      commonHash: result.commonHash,
      slideHashes: result.slideHashes,
    };
    this.sourceMap = result.sourceMap;
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
  }

  private queueOrSend(
    payload:
      | {
          bytes: Uint8Array;
          name: string;
          invalidatedSlides?: number[];
          deckGeneration: number;
        }
      | { error: string },
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
      | { error: string },
  ): void {
    if ("error" in payload) {
      void this.panel.webview.postMessage({
        type: "error",
        message: payload.error,
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
