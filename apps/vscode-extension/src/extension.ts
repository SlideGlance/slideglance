import * as path from "path";
import * as vscode from "vscode";
import { PreviewPanel } from "./preview.js";
import { isSlideXmlDocument } from "./fileUtils.js";
import { registerNavigationProviders } from "./definitionProvider.js";
import { generatePptxBuffer } from "./exportPptx.js";
import { PptxViewerProvider } from "./pptxViewer.js";

const ACTIVE_CONTEXT = "slideBuilder.isActive";

function refreshActiveContext(editor: vscode.TextEditor | undefined): void {
  const active = editor ? isSlideXmlDocument(editor.document) : false;
  void vscode.commands.executeCommand("setContext", ACTIVE_CONTEXT, active);
}

// Public API surface of the RedHat vscode-xml extension. Only the
// catalog methods we use are typed here; the upstream interface has
// more.
interface XMLExtensionApi {
  addXMLCatalogs(catalogs: string[]): void;
  removeXMLCatalogs?(catalogs: string[]): void;
}

// Registers an OASIS XML catalog (written next to dist/extension.js by
// esbuild's xmlCatalogPlugin) so RedHat's vscode-xml resolves the
// `urn:slideglance:builder:v1` namespace and the unpkg schemaLocation
// URL to the bundled `builder.xsd`, even when @slideglance/builder is
// not yet published to npm.
async function registerXmlCatalog(
  context: vscode.ExtensionContext,
): Promise<void> {
  const xmlExtension = vscode.extensions.getExtension("redhat.vscode-xml");
  if (!xmlExtension) {
    // Listed in extensionDependencies, so absence is an environment
    // anomaly worth surfacing rather than failing silently.
    return;
  }
  const api = (await xmlExtension.activate()) as XMLExtensionApi | undefined;
  if (!api || typeof api.addXMLCatalogs !== "function") {
    return;
  }
  const catalogPath = path.join(
    context.extensionPath,
    "dist",
    "xml-catalog.xml",
  );
  api.addXMLCatalogs([catalogPath]);
  context.subscriptions.push({
    dispose: () => {
      if (typeof api.removeXMLCatalogs === "function") {
        api.removeXMLCatalogs([catalogPath]);
      }
    },
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("SlideGlance");
  context.subscriptions.push(outputChannel);
  PreviewPanel.setOutputChannel(outputChannel);

  void registerXmlCatalog(context);

  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("slidebuilder");
  context.subscriptions.push(diagnosticCollection);
  PreviewPanel.setDiagnosticCollection(diagnosticCollection);

  registerNavigationProviders(context);

  // Drive the editor/title menu visibility by whether the active document
  // declares the slideglance/builder namespace on its root element.
  refreshActiveContext(vscode.window.activeTextEditor);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      refreshActiveContext(editor);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const active = vscode.window.activeTextEditor;
      if (active && active.document === e.document) {
        refreshActiveContext(active);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("slideBuilder.openPreview", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showErrorMessage("No active editor");
        return;
      }
      if (!isSlideXmlDocument(editor.document)) {
        void vscode.window.showErrorMessage(
          'This command is only available for slide builder XML files (.sgx or .xml with xmlns="urn:slideglance:builder:v1")',
        );
        return;
      }
      PreviewPanel.createOrShow(context.extensionUri, editor.document);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("slideBuilder.refreshPreview", () => {
      PreviewPanel.forceRefresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("slideBuilder.exportPptx", async () => {
      // The export button surfaces in two places:
      //  - the preview webview's editor/title menu (no active text
      //    editor when focus is on the webview), and
      //  - the .sgx editor's title menu.
      // Prefer the active editor when it points at a slide XML so an
      // explicit click in the editor toolbar always exports that file;
      // otherwise fall back to the URI the preview panel is tracking.
      const editor = vscode.window.activeTextEditor;
      const sourceUri =
        editor && isSlideXmlDocument(editor.document)
          ? editor.document.uri
          : PreviewPanel.getDocumentUri();

      if (!sourceUri) {
        void vscode.window.showErrorMessage(
          "Open a slide builder XML file (.sgx) first.",
        );
        return;
      }

      let document: vscode.TextDocument;
      try {
        document = await vscode.workspace.openTextDocument(sourceUri);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(
          `Failed to read source document: ${message}`,
        );
        return;
      }

      const sourcePath = document.uri.fsPath;
      const ext = path.extname(sourcePath);
      const basename = path.basename(sourcePath, ext);
      const defaultUri = vscode.Uri.file(
        path.join(path.dirname(sourcePath), `${basename}.pptx`),
      );

      const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { PowerPoint: ["pptx"] },
      });
      if (!saveUri) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Exporting PPTX...",
          cancellable: false,
        },
        async () => {
          try {
            const buffer = await generatePptxBuffer(
              document.getText(),
              sourcePath,
            );
            await vscode.workspace.fs.writeFile(saveUri, buffer);
            void vscode.window.showInformationMessage(
              `Exported to ${path.basename(saveUri.fsPath)}`,
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            void vscode.window.showErrorMessage(`Export failed: ${message}`);
          }
        },
      );
    }),
  );

  context.subscriptions.push(PptxViewerProvider.register(context));

  // Re-attach webview panels that VS Code restores across window
  // reloads so live updates continue to drive them.
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("slideBuilderPreview", {
      deserializeWebviewPanel(panel) {
        const editor = vscode.window.activeTextEditor;
        const slideEditor =
          editor && isSlideXmlDocument(editor.document) ? editor : undefined;
        const slideDoc =
          slideEditor?.document ??
          vscode.workspace.textDocuments.find((d) => isSlideXmlDocument(d));

        if (!slideDoc) {
          panel.dispose();
          return Promise.resolve();
        }

        panel.webview.options = { enableScripts: true };
        PreviewPanel.attach(panel, context.extensionUri, slideDoc);
        return Promise.resolve();
      },
    }),
  );

  // Watch editor content + save events. Trigger a preview rebuild for
  // either (a) edits to the previewed slide XML itself, or (b) edits
  // to any file the most recent build pulled in via `<Import>`. The
  // import resolver prefers the in-memory buffer when present, so case
  // (b) reflects unsaved edits in imported files too.
  const shouldTriggerPreview = (doc: vscode.TextDocument): boolean =>
    isSlideXmlDocument(doc) || PreviewPanel.isTrackedImport(doc.uri);

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (shouldTriggerPreview(e.document)) PreviewPanel.update(e.document);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (shouldTriggerPreview(doc)) PreviewPanel.update(doc);
    }),
  );
}

export function deactivate(): void {
  // nothing to clean up
}
