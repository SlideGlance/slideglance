# Slide Builder (VS Code extension)

VS Code extension `slideglance.slide-builder` — live preview for `@slideglance/builder` XML decks (`.sgx`) and a custom editor for `.pptx` files, both backed by [`@slideglance/viewer`](../../packages/viewer).

Part of the [SlideGlance](https://github.com/SlideGlance/slideglance) project — published to the VS Code Marketplace.

## What it does

- **Live preview** — opens any `.sgx` (SlideGlance XML) file in a webview that re-renders on save (and incrementally on keystroke for unchanged-slide-preserving updates).
- **Click → reveal source** — clicking any rendered element jumps the editor to the originating XML, including across `<Import>` boundaries.
- **PPTX export** — one command (`Slide Builder: Export PPTX`) writes the current deck to `.pptx`.
- **PPTX viewer** — `.pptx` files open in the same webview through a custom editor (priority: `option`; opt in via "Open With…").
- **Schema-aware editing** — the bundled XSD (`packages/builder/builder.xsd`, namespace `urn:slideglance:builder:v1`) drives the [Red Hat XML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-xml) for autocomplete + on-save validation.
- **Inline diagnostics** — parse / schema errors appear in the editor as you type.

For full feature documentation see [`packages/builder/docs/vscode-extension.md`](../../packages/builder/docs/vscode-extension.md).

## Install

> Requires VS Code 1.85+.

From the Marketplace UI: search **Slide Builder** by **slideglance**.

From the CLI:

```sh
code --install-extension slideglance.slide-builder
```

## Commands

| Command                       | Title                          | Effect                              |
| ----------------------------- | ------------------------------ | ----------------------------------- |
| `slideBuilder.openPreview`    | Slide Builder: Open Preview    | Open or focus the live preview pane |
| `slideBuilder.refreshPreview` | Slide Builder: Refresh Preview | Force a full rebuild                |
| `slideBuilder.exportPptx`     | Slide Builder: Export PPTX     | Write the current deck to `.pptx`   |

## Develop

```sh
pnpm install
pnpm --filter slide-builder build
```

Open `apps/vscode-extension/` in VS Code and press F5 to launch an
Extension Development Host with the extension loaded.

The build produces:

- `dist/extension.js` — extension host runtime (esbuild).
- `dist/webview/` — preview UI bundle (Vite).

Two pipelines coexist because the viewer's worker resolves
`@slideglance/core`'s WASM via dynamic import + top-level await —
Vite's `vite-plugin-wasm` + `vite-plugin-top-level-await` handle that;
esbuild does not. Host code (extension entry, preview controller,
export command, custom editor, webview HTML) is plain Node and bundles
fine through esbuild.

## License

MIT — see [LICENSE](./LICENSE).
