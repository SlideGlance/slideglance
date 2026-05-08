# @slideglance/core

Deterministic PPTX → SVG / PNG conversion as a WebAssembly module.
Backed by the [SlideGlance](https://github.com/SlideGlance/slideglance) Rust crate
ecosystem.

## Install

```sh
npm i @slideglance/core
# or
pnpm add @slideglance/core
```

## Quick start (Node)

```js
import { convertPptxToSvg } from "@slideglance/core/node";
import { readFileSync } from "node:fs";

const slides = convertPptxToSvg(readFileSync("deck.pptx"), [], []);
for (const s of slides) {
  console.log(`slide ${s.slide_number}: ${s.svg.length} bytes`);
}
```

## Quick start (browser, bundler)

```js
import { convertPptxToSvg } from "@slideglance/core/bundler";

const buf = await fetch("/deck.pptx").then((r) => r.arrayBuffer());
const slides = convertPptxToSvg(new Uint8Array(buf), [], []);
```

## Quick start (browser, no bundler)

```js
import init, { convertPptxToSvg } from "@slideglance/core/web";

await init(); // download + instantiate the wasm module
const slides = convertPptxToSvg(bytes, [], []);
```

## API

- `parsePptxData(bytes: Uint8Array) -> Presentation` — parse PPTX into
  a typed model.
- `convertPptxToSvg(bytes, slides, fonts) -> SlideSvg[]` — render every
  slide (or `slides` filter) to SVG. Pass `fonts` (`Uint8Array[]`) to
  enable path-mode glyph outlines.
- `convertPptxToPng(bytes, slides, width?, height?, fonts) -> SlideImage[]`
  — rasterize each slide to PNG bytes. `fonts` is required.
- `svgToPng(svg, width?, height?, fonts) -> Uint8Array` — rasterize a
  single SVG document.
- `emuToPixels(emu)` — utility helper.
- `version()` — wasm crate version.

Full type definitions ship with the package — your editor will pick
them up automatically.

## Determinism

Same PPTX bytes + same font buffers → bitwise-identical output. No
system fonts, no system clock, no randomness in the rendering path.
See the project README for details.

## License

MIT.
