# @slideglance/web-playground

Drag-and-drop SPA for evaluating SlideGlance against arbitrary `.pptx` decks. Hosted at <https://slideglance.github.io/slideglance/playground/> via the Pages workflow.

Part of the [SlideGlance](https://github.com/SlideGlance/slideglance) project. Private / not published.

## What it does

- Exposes the same Rust + WebAssembly core (`@slideglance/core`) that the Chrome extension and desktop viewer use, in a drag-and-drop SPA.
- Runs entirely in the browser tab — no upload, no server, no account.
- Acts as a fidelity benchmark: drag any `.pptx` and compare the rendered SVG against PowerPoint / Keynote / Google Slides side-by-side.

## Develop

```sh
pnpm --filter @slideglance/web-playground dev
```

The `predev` hook runs `scripts/build-wasm.sh` so the wasm artefacts
under `packages/{core,measure}/dist/` are fresh before Vite starts.

## Build

```sh
pnpm --filter @slideglance/web-playground build
```

Outputs to `dist/`. The Pages workflow copies this into the deployed
site under `playground/`.

## License

MIT — see [LICENSE](./LICENSE).
