import * as path from "path";
import * as vscode from "vscode";
import { PreviewPanel } from "./preview.js";
import { isSlideXmlDocument } from "./fileUtils.js";
import { registerNavigationProviders } from "./definitionProvider.js";
import { generatePptxBuffer } from "./exportPptx.js";
import { PptxViewerProvider } from "./pptxViewer.js";

const ACTIVE_CONTEXT = "slideBuilder.isActive";
const XML_EXTENSION_ID = "redhat.vscode-xml";
const XML_PROMPT_SHOWN_KEY = "slideBuilder.xmlExtensionPromptShown";

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

// `.sgx` schema validation and completion come from RedHat's vscode-xml,
// which this extension deliberately does NOT declare in
// `extensionDependencies`. VS Code activates every declared dependency to
// completion before activating the dependent one, and that extension's
// `activate` waits on a Java runtime probe and a LemMinX language-server
// boot — seconds during which none of this extension's commands,
// diagnostics, or navigation exist yet. Offering the install once keeps
// schema support one click away while everything else starts immediately.
async function offerXmlExtensionInstall(
  context: vscode.ExtensionContext,
): Promise<void> {
  if (context.globalState.get<boolean>(XML_PROMPT_SHOWN_KEY) === true) return;
  // Record before awaiting the dialog so a second window opening at the
  // same time does not raise a second prompt.
  await context.globalState.update(XML_PROMPT_SHOWN_KEY, true);
  const install = "Install";
  const choice = await vscode.window.showInformationMessage(
    "Install the RedHat XML extension for .sgx schema validation and autocomplete. Preview, export, and navigation work without it.",
    install,
  );
  if (choice !== install) return;
  await vscode.commands.executeCommand(
    "workbench.extensions.installExtension",
    XML_EXTENSION_ID,
  );
}

// Registers an OASIS XML catalog (written next to dist/extension.js by
// esbuild's xmlCatalogPlugin) so RedHat's vscode-xml resolves the
// `urn:slideglance:builder:v1` namespace and the unpkg schemaLocation
// URL to the bundled `builder.xsd`, even when @slideglance/builder is
// not yet published to npm.
async function registerXmlCatalog(
  context: vscode.ExtensionContext,
): Promise<void> {
  let xmlExtension = vscode.extensions.getExtension(XML_EXTENSION_ID);
  if (!xmlExtension) {
    await offerXmlExtensionInstall(context);
    xmlExtension = vscode.extensions.getExtension(XML_EXTENSION_ID);
    if (!xmlExtension) return;
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
  // Set the context key before anything that touches the file system or
  // another extension. It drives the editor/title menu visibility for
  // `.xml` documents that opt in through the slideglance namespace —
  // `.sgx` files get their buttons from `resourceExtname` in the manifest
  // and never wait for this — so every millisecond spent ahead of it is a
  // millisecond those buttons are missing.
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

  const outputChannel = vscode.window.createOutputChannel("SlideGlance");
  context.subscriptions.push(outputChannel);
  PreviewPanel.setOutputChannel(outputChannel);

  registerXmlCatalog(context).catch((err: unknown) => {
    outputChannel.appendLine(
      `[pom] XML catalog registration failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  });

  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("slidebuilder");
  context.subscriptions.push(diagnosticCollection);
  PreviewPanel.setDiagnosticCollection(diagnosticCollection);

  registerNavigationProviders(context);

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

  // Watch the disk as well as the editor.
  //
  // The two listeners above hear about documents VS Code has open. A
  // deck whose masters, figures or chapter fragments are written by a
  // build script produces none of those events — the file changes and
  // nothing in the editor's model moved — so the preview kept showing
  // the deck, or the failure, from before the script ran. That reads as
  // a preview that will not rebuild no matter what you fix, because
  // the file you fixed is the one nobody is listening to.
  //
  // An editor save fires both this and `onDidSaveTextDocument`; the
  // panel debounces and the content hashes make the second a no-op.
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.{sgx,xml}");
  const onDiskChange = (uri: vscode.Uri): void => {
    // Only the previewed deck and the files it actually pulls in. The
    // glob is workspace-wide, and every build starts from the deck
    // root, so an unrelated `.sgx` elsewhere would otherwise rebuild
    // this deck for no reason.
    const previewed = PreviewPanel.getDocumentUri();
    if (previewed?.fsPath === uri.fsPath || PreviewPanel.isTrackedImport(uri)) {
      PreviewPanel.updateFromDisk(uri);
    }
  };
  watcher.onDidChange(onDiskChange);
  watcher.onDidCreate(onDiskChange);
  watcher.onDidDelete(onDiskChange);
  context.subscriptions.push(watcher);
}

export function deactivate(): void {
  // nothing to clean up
}
