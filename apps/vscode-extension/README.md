# @slideglance/vscode-extension

VS Code extension that provides live preview for `@slideglance/builder`
XML decks (`.sgx`) and `.pptx` viewer integration, backed by
`@slideglance/viewer`.

Part of the [SlideGlance](https://github.com/SlideGlance/slideglance)
project. Published to the VS Code Marketplace.

## Capabilities

- **Live preview** — opens any `.sgx` (SlideGlance XML) file in a
  webview that re-renders on save via `@slideglance/builder`.
- **PPTX viewer** — `.pptx` files open in the same webview through
  `@slideglance/viewer`.
- **Schema-aware editing** — the bundled XSD
  (`packages/builder/dist-schema/builder.xsd`) drives the Red Hat
  XML extension for autocomplete + on-save validation when paired
  with the suggested `.vscode/settings.json` snippet in the builder
  package.

## Develop locally

Open `apps/vscode-extension/` in VS Code and press F5 to launch an
Extension Development Host with the extension loaded.

## Build

```sh
pnpm --filter @slideglance/vscode-extension build
```

Produces:

- `out/extension.js` (host runtime, esbuild)
- `dist/webview/` (preview UI, vite)

## License

MIT — see [LICENSE](./LICENSE).
