/**
 * `PreviewPanel` — extension-host side of the webview.
 *
 * Responsibilities
 * ----------------
 * 1. Spin up a VS Code webview panel that boots the slideglance/viewer
 *    React shell (Vite-bundled output under `dist/webview/`).
 * 2. Watch the active slide builder XML document (`.sgx` or `.xml` with
 *    the slideglance namespace) for changes, debounce, and rebuild a
 *    fresh PPTX via the builder on every settled edit.
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
import { createFsImportResolver } from "./importResolver.js";
import { buildWebviewHtml } from "./webviewHtml.js";

const DEBOUNCE_MS = 500;
const RENDER_TIMEOUT_MS = 15000;
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
  private renderGeneration = 0;
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
    // Drop the cached snapshot so the next render reports a full
    // (rather than incremental) reload — refresh exists so the user
    // can recover from a stale viewer state. Bump the deck generation
    // so the webview also remounts the viewer shell.
    inst.lastRender = undefined;
    inst.deckGeneration++;
    void inst.renderFromTargetUri();
  }

  static createOrShow(
    extensionUri: vscode.Uri,
    document: vscode.TextDocument,
  ): void {
    if (PreviewPanel.instance) {
      const oldUri = PreviewPanel.instance.documentUri;
      if (oldUri.toString() !== document.uri.toString()) {
        PreviewPanel.diagnosticCollection?.delete(oldUri);
        // Different file → drop the snapshot so the next render is
        // sent as a full reload, flushing the viewer's slide cache.
        // Bump the deck generation so the webview unmounts the existing
        // `<PptxPresentation>` and remounts a fresh one — fully resets
        // currentSlide / zoom / pan / search / dialog state that would
        // otherwise leak from the previous deck.
        PreviewPanel.instance.lastRender = undefined;
        PreviewPanel.instance.deckGeneration++;
      }
      PreviewPanel.instance.documentUri = document.uri;
      PreviewPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      void PreviewPanel.instance.render(document.getText());
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
      if (isTarget) void inst.render(document.getText());
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

    void this.render(document.getText());
  }

  private async renderFromTargetUri(): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(this.documentUri);
      await this.render(doc.getText());
    } catch (err) {
      PreviewPanel.log(
        `renderFromTargetUri failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async render(content: string): Promise<void> {
    const generation = ++this.renderGeneration;

    const buildPromise = buildPptxFromXml(
      content,
      this.documentUri.fsPath,
      this.lastRender,
      this.importedPaths,
    );
    const timeoutPromise = new Promise<BuildError>((resolve) => {
      setTimeout(
        () =>
          resolve({
            type: "error",
            message: `Preview render timed out after ${RENDER_TIMEOUT_MS}ms.`,
          }),
        RENDER_TIMEOUT_MS,
      );
    });
    const result = await Promise.race([buildPromise, timeoutPromise]);

    if (this.disposed || generation !== this.renderGeneration) return;

    if (result.type === "noop") {
      // Hashes match the previous render — nothing to ship.
      return;
    }
    if (result.type === "empty") {
      this.queueOrSend({ error: "No slides to preview" });
      this.sourceMap = undefined;
      this.lastRender = undefined;
      PreviewPanel.diagnosticCollection?.delete(this.documentUri);
      return;
    }
    if (result.type === "error") {
      PreviewPanel.log(`render error: ${result.message}`);
      this.queueOrSend({ error: result.message });
      this.sourceMap = undefined;
      this.lastRender = undefined;
      PreviewPanel.diagnosticCollection?.delete(this.documentUri);
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
    const fileName = path.basename(this.documentUri.fsPath);
    this.queueOrSend({
      bytes: result.bytes,
      name: fileName,
      deckGeneration: this.deckGeneration,
      ...(diff !== undefined ? { invalidatedSlides: diff } : {}),
    });

    if (result.diagnostics.length > 0) {
      PreviewPanel.diagnosticCollection?.set(
        this.documentUri,
        toVsDiagnostics(result.diagnostics),
      );
    } else {
      PreviewPanel.diagnosticCollection?.delete(this.documentUri);
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
    if (!this.pendingPayload) return;
    const next = this.pendingPayload;
    this.pendingPayload = undefined;
    this.send(next);
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
