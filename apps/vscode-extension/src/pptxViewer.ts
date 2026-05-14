/**
 * `PptxViewerProvider` — VS Code custom (read-only) editor for `.pptx`
 * files. Mounts the same slideglance/viewer React shell the .sgx live
 * preview uses, but the byte source is the file on disk rather than a
 * builder-driven re-render.
 *
 * Registered with `priority: "option"` (see package.json) so the user
 * opts in via "Open With… → SlideGlance PPTX Viewer" rather than
 * having the default double-click behaviour silently replaced.
 *
 * The webview ⇄ host protocol matches `PreviewPanel`:
 *   - host → webview  `{ type: 'pptx', bytes, name }`
 *   - host → webview  `{ type: 'error', message }`
 *   - webview → host  `{ type: 'ready' }`
 *   - webview → host  `{ type: 'revealSource', objectName }` (ignored
 *     here — there is no source XML to reveal for a .pptx file).
 */

import * as path from "path";
import * as vscode from "vscode";
import { buildWebviewHtml } from "./webviewHtml.js";

const VIEW_TYPE = "slideBuilder.pptxViewer";

interface PptxDocument extends vscode.CustomDocument {
  readonly uri: vscode.Uri;
}

export class PptxViewerProvider implements vscode.CustomReadonlyEditorProvider<PptxDocument> {
  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new PptxViewerProvider(context);
    return vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      // The viewer streams the entire file into the worker on open;
      // there is no per-keystroke state to preserve, so retaining
      // context only matters when the panel is briefly hidden (split
      // view, tab switch). Keeping it on avoids a wasm reboot every
      // time focus moves away.
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri): PptxDocument {
    return {
      uri,
      dispose: () => {
        // No per-document resources to release — bytes are read fresh
        // each resolveCustomEditor and live in the webview.
      },
    };
  }

  async resolveCustomEditor(
    document: PptxDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
      ],
    };
    panel.webview.html = buildWebviewHtml(
      this.context.extensionUri,
      panel.webview,
    );

    let webviewReady = false;
    let pending:
      | { bytes: Uint8Array; name: string }
      | { error: string }
      | undefined;

    const send = (
      payload: { bytes: Uint8Array; name: string } | { error: string },
    ): void => {
      if ("error" in payload) {
        void panel.webview.postMessage({
          type: "error",
          message: payload.error,
        });
        return;
      }
      void panel.webview.postMessage({
        type: "pptx",
        bytes: payload.bytes,
        name: payload.name,
      });
    };

    const queueOrSend = (
      payload: { bytes: Uint8Array; name: string } | { error: string },
    ): void => {
      if (!webviewReady) {
        pending = payload;
        return;
      }
      send(payload);
    };

    const messageSubscription = panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        if (!message || typeof message !== "object") return;
        const m = message as { type?: string };
        if (m.type === "ready") {
          webviewReady = true;
          if (pending) {
            const next = pending;
            pending = undefined;
            send(next);
          }
        }
        // `revealSource` clicks are no-ops for PPTX files — no source
        // XML exists to reveal. Ignored silently.
      },
    );

    const reload = async (): Promise<void> => {
      try {
        const bytes = await vscode.workspace.fs.readFile(document.uri);
        queueOrSend({
          bytes: new Uint8Array(bytes),
          name: path.basename(document.uri.fsPath),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        queueOrSend({ error: `Failed to read PPTX: ${message}` });
      }
    };

    // External edits to the on-disk file (e.g. the user re-saves the
    // PPTX from PowerPoint) should refresh the open viewer. The
    // FileSystemWatcher is scoped to this single URI so unrelated
    // workspace activity does not trigger reloads.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
        path.basename(document.uri.fsPath),
      ),
    );
    const onChange = watcher.onDidChange(() => {
      void reload();
    });
    const onDelete = watcher.onDidDelete(() => {
      queueOrSend({ error: "The PPTX file was deleted." });
    });

    panel.onDidDispose(() => {
      messageSubscription.dispose();
      onChange.dispose();
      onDelete.dispose();
      watcher.dispose();
    });

    await reload();
  }
}
