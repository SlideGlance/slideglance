---
title: vscode-extension — Guides
lang: en
kind: guides
app: vscode-extension
last_verified_commit: 93952eafcabba0eb4e38b1d79738462835c3e5c3
source_files:
  - apps/vscode-extension/src/extension.ts
  - apps/vscode-extension/src/preview.ts
  - apps/vscode-extension/src/webview/
---

# vscode-extension — Guides

## Develop the extension locally

### Goal

Iterate on the extension host and webview with a quick reload cycle.

### Steps

1. `pnpm --filter slide-builder build` — build the webview and the
   extension host once.
2. Open `apps/vscode-extension/` in VS Code.
3. Press F5 to launch a new VS Code window (Extension Development Host)
   with the extension loaded.
4. In the new window, open any `.sgx` or `.pptx` file. Run
   **SlideGlance: Open Preview** (Cmd/Ctrl-Shift-P) to open the preview
   pane.
5. While iterating on the extension host, run
   `pnpm --filter slide-builder watch:host` and restart the debug
   session (Cmd-Shift-F5) to pick up host changes. Webview source
   changes require re-running `pnpm --filter slide-builder build:webview`
   and reopening the preview.

### Expected result

The `.sgx` preview pane re-renders as you edit and save, with
incremental keystroke updates that preserve unchanged slides.
Diagnostic squiggles appear in the editor for schema violations.

## Add a click-to-source mapping for a new node type

### Goal

Map a newly added builder node (e.g. `<Callout/>`) so that clicking its
rendered representation jumps to the source range.

### Steps

1. Extend the source-map output in
   `packages/builder/src/parseXml/parseXml.ts` so the new node emits a
   `data-object-name` marker into the rendered SVG.
2. In the webview, update the click handler in
   `src/webview/main.tsx` to resolve the clicked element's
   `data-object-name` back to a source range via the document's
   `BuilderSourceMap`.
3. Verify by editing a `.sgx` file and clicking the rendered element.

### Expected result

Clicking the rendered node in the preview moves the cursor to the
matching `<Callout>` opening tag, including across `<Import>`
boundaries.

## Publish a new version to the Marketplace

### Goal

Ship a new build to the Visual Studio Marketplace.

### Steps

1. Bump `version` in `apps/vscode-extension/package.json`.
2. `pnpm --filter slide-builder package` — runs the `vscode:prepublish`
   build and produces the `.vsix` (`vsce package --no-dependencies`).
3. `pnpm --filter slide-builder publish` with the publisher PAT in the
   environment (`vsce publish --no-dependencies`).

### Expected result

The new version appears on the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=simplecore.slide-builder)
within a few minutes.
