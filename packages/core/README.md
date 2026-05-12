# @slideglance/core

Deterministic PPTX → SVG / PNG conversion as a WebAssembly module. Backed by the SlideGlance Rust crate ecosystem.

Part of the [SlideGlance](https://github.com/SlideGlance/slideglance) project — published to npm.

## What it does

The full PPTX pipeline (parser + renderer + rasterizer) compiled to
WebAssembly with three flavored builds for different bundler stories:

| Subpath               | When to use                                                  |
| --------------------- | ------------------------------------------------------------ |
| `@slideglance/core/bundler` | Modern bundlers (Vite, Webpack 5+, esbuild). The wasm is imported as an asset and resolved at bundle time. |
| `@slideglance/core/web`     | Browsers without a bundler — call `init()` once to download and instantiate the wasm module. |
| `@slideglance/core/node`    | Node.js / Deno / Bun — sync wasm load via `fs.readFile`.    |

Same PPTX bytes + same font buffers → bitwise-identical output. No
system fonts, no system clock, no randomness in the rendering path.

## Install

```sh
pnpm add @slideglance/core
# or
npm i @slideglance/core
```

## Quick start (Node)

```ts
import { convertPptxToSvg } from "@slideglance/core/node";
import { readFileSync } from "node:fs";

const slides = convertPptxToSvg(readFileSync("deck.pptx"), [], []);
for (const s of slides) {
  console.log(`slide ${s.slide_number}: ${s.svg.length} bytes`);
}
```

## Quick start (browser, bundler)

```ts
import { convertPptxToSvg } from "@slideglance/core/bundler";

const buf = await fetch("/deck.pptx").then((r) => r.arrayBuffer());
const slides = convertPptxToSvg(new Uint8Array(buf), [], []);
```

## Quick start (browser, no bundler)

```ts
import init, { convertPptxToSvg } from "@slideglance/core/web";

await init();   // download + instantiate the wasm module
const slides = convertPptxToSvg(bytes, [], []);
```

## API

| Function                                                              | Returns                            |
| --------------------------------------------------------------------- | ---------------------------------- |
| `parsePptxData(bytes)`                                                | `Presentation`                     |
| `convertPptxToSvg(bytes, slides, fonts)`                              | `SlideSvg[]`                       |
| `convertPptxToPng(bytes, slides, width?, height?, fonts)`             | `SlideImage[]` — `fonts` required. |
| `svgToPng(svg, width?, height?, fonts)`                               | `Uint8Array`                       |
| `emuToPixels(emu)`                                                    | `number`                           |
| `version()`                                                           | `string` (wasm crate version)      |

Pass `fonts` (`Uint8Array[]`) to enable path-mode glyph outlines —
required for PNG conversion, optional for SVG (text-mode is the
default).

Full type definitions ship with the package — your editor will pick
them up automatically.

## Status

Pre-release — APIs may change before 1.0.

## License

MIT — see [LICENSE](./LICENSE).
