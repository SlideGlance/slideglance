---
title: vscode-extension — Guides
lang: en
kind: guides
app: vscode-extension
last_verified_commit: ffd91b05b9e540c1d1c4dd3b8533f3485bcf20da
source_files:
  - apps/vscode-extension/src/extension.ts
  - apps/vscode-extension/src/preview.ts
  - apps/vscode-extension/src/coalescingRunner.ts
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

## Keep working while a large deck renders

### Goal

Understand what the preview does when a build outruns the slow-render
notice, and tune when that notice appears.

### Steps

1. Open a deck large enough that a rebuild takes more than 15 seconds,
   or lower `slideglance.preview.slowRenderNoticeMs` in settings to see
   the notice sooner.
2. Edit the `.sgx` and wait. After the configured interval the preview
   shows a corner badge saying the build is still running; the deck
   already on screen stays interactive and its diagnostics stay put.
3. Keep editing while the badge is up. Edits that arrive during a build
   do not start a second one — they collapse into a single rebuild that
   starts when the current build ends, so only the newest source is
   ever built.
4. Set the value to `0` to hide the notice entirely.

### Expected result

The badge clears and the deck updates when the build finishes. A render
is never abandoned for taking too long: the builder has no cancellation,
so giving up would spend the same CPU and discard the finished deck.

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
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=slideglance.slide-builder)
within a few minutes.
