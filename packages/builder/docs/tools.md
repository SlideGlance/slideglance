# Tooling

## VS Code Extension (`slideglance.builder-vscode`)

The official **Slide Builder** VS Code extension provides a live preview pane for `.sgx` (and any XML opened with the language id `xml`) alongside the editor. It is the primary feedback loop while authoring slides — edits show up instantly without a manual build/export cycle.

### Features

- **Live preview** — Real-time slide preview as you edit. Each keystroke re-renders only the slides whose content actually changed; unchanged slides keep their existing DOM, so scroll position, zoom, and the thumbnail selection are preserved.
- **Selective invalidation** — Edits to `<Import>`'d files invalidate just the affected slides. Changes to `<Master>`, `<Styles>`, `<Templates>`, `defaultTextStyle`, slide size, or the `masterPptx` trigger a full rebuild automatically.
- **Click → reveal source** — Clicking any rendered element in the preview (text, shape, table, chart, icon, image, line) jumps the editor to the exact source line, including across `<Import>` boundaries. For slides authored with `<Templates>` / `<Use>`, the click reveals the `<Use>` call site.
- **PowerPoint-style zoom** — Zoom slider, ± / input controls, and a "fit to width" button. Zoom level is persisted per webview session.
- **Thumbnail rail** — Slide thumbnails on the bottom (landscape) or left (portrait). Click to scroll; the rail is drag-resizable, remembers its size, and a scroll-spy highlights the current slide.
- **PPTX export** — Export the deck via the `Slide Builder: Export PPTX` command.
- **Inline error diagnostics** — Catches parse / schema issues as you type.

### Installation

> Requires VS Code 1.85+.

Install from the VS Code Marketplace by searching for **Slide Builder**, or use the CLI:

```sh
code --install-extension slideglance.builder-vscode
```

### Usage

1. Open any XML file you author with the builder DSL (the `.sgx` extension is the convention used in samples).
2. Run **Slide Builder: Open Preview** from the Command Palette, or click the preview icon in the editor title bar.
3. Edit your file — the preview updates in real time.
4. Run **Slide Builder: Export PPTX** when you are ready to write the `.pptx` file.

`<Import src="..." />` resolves relative to the open file's directory. Multi-file decks therefore work without extra configuration.

### Available Commands

| Command                          | Default title                  | Effect                              |
| -------------------------------- | ------------------------------ | ----------------------------------- |
| `slideBuilder.openPreview`       | Slide Builder: Open Preview    | Open or focus the live preview pane |
| `slideBuilder.refreshPreview`    | Slide Builder: Refresh Preview | Force a full rebuild of the preview |
| `slideBuilder.exportPptx`        | Slide Builder: Export PPTX     | Write the current deck to `.pptx`   |

### Limitation

The extension bundles its own copy of `@slideglance/builder`. Projects that pin a different builder version at runtime may render slightly differently in the preview than in the final PPTX output. Keep the extension and library versions in sync for the most accurate preview.
