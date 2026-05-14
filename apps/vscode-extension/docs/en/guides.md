---
title: vscode-extension — Guides
lang: en
kind: guides
app: vscode-extension
last_verified_commit: 0000000000000000000000000000000000000000
source_files:
  - apps/vscode-extension/src/extension.ts
  - apps/vscode-extension/src/preview.ts
  - apps/vscode-extension/src/webview/
---

# vscode-extension — Guides

## Develop the extension locally

### Goal

Iterate with HMR for the webview and a quick reload cycle for the
extension host.

### Steps

1. `pnpm --filter slide-builder dev` — starts the Vite dev server
   for the webview React app.
2. Open `apps/vscode-extension/` in VS Code.
3. Press F5 to launch a new VS Code window with the extension
   loaded.
4. In the new window, open any `.sgx` or `.pptx` file. The
   "SlideGlance: Preview" command (Cmd-Shift-P) opens the preview
   pane.
5. Edits to webview source hot-reload immediately. Edits to
   extension source require restarting the debug session (Cmd-Shift-F5).

### Expected result

The preview pane mirrors the `.sgx` source as you type, with
sub-second turnaround. Diagnostic squiggles appear in the editor for
schema violations.

## Add a click-to-source mapping for a new node type

### Goal

Map a newly added builder node (e.g. `<callout/>`) so that clicking
its rendered representation jumps to the source range.

### Steps

1. Extend the source-map output in
   `packages/builder/src/parseXml/parseXml.ts` to cover the new
   node.
2. In the webview, update the click handler in
   `src/webview/preview-click.ts` to look up the source range by
   the node's data attribute.
3. Verify by editing a `.sgx` fixture under `examples/` and
   clicking the rendered element.

### Expected result

Clicking the rendered node in the preview moves the cursor to the
matching `<callout>` opening tag.

## Publish a new version to the Marketplace

### Goal

Ship a new build to the Visual Studio Marketplace.

### Steps

1. Bump `version` in `apps/vscode-extension/package.json`.
2. `pnpm --filter slide-builder build`.
3. `vsce package` (in `apps/vscode-extension/`) to produce the
   `.vsix`.
4. `vsce publish` with the publisher PAT in the environment.

### Expected result

The new version appears on the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=slideglance.slide-builder)
within a few minutes.
