# @slideglance/measure

Deterministic OpenType text-width / line-metrics measurement as a
WebAssembly module.

Part of the [SlideGlance](https://github.com/SlideGlance/slideglance)
project.

## Why a separate package from `@slideglance/core`

`@slideglance/core` ships the full PPTX → SVG / PNG pipeline (~5 MiB
compressed wasm). A consumer that only needs to measure text widths
— typically an upstream layout engine that wants to share metrics
with the SlideGlance renderer for pixel parity — does not need any
of that.

`@slideglance/measure` exports just the text-measurement entry point
of `slideglance-font`. The bundle is roughly 10× smaller than core,
and the two packages release on independent cadences.

## Install

```sh
pnpm add @slideglance/measure
```

## Quick start

```js
import { measureTextWidth } from "@slideglance/measure";

const widthPx = measureTextWidth({
  text: "Hello",
  fontFamily: "Inter",
  fontSize: 16,
  // Provide font bytes — measurement never reads system fonts.
  fontBytes: await fetch("/fonts/Inter-Regular.otf").then(r => r.arrayBuffer()),
});
```

Three target builds ship under `dist/{bundler,web,node}/`. Pick the
`exports` subpath that matches your bundler — see `package.json`
`exports` block.

## Status

Pre-release — APIs may change before 1.0.

## License

MIT — see [LICENSE](./LICENSE).
