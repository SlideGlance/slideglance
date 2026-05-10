# slideglance

End-to-end PPTX → SVG / PNG conversion: parser + renderer + rasterizer +
CLI. The native top-level entry point of the SlideGlance Rust workspace.

Part of the [SlideGlance](https://github.com/SlideGlance/slideglance)
Rust crate ecosystem.

## Role

Composes the lower-level crates into a single orchestrator:

```
PPTX bytes
  → slideglance-parser     (ZIP + XML)
  → slideglance-model      (typed data)
  → slideglance-renderer   (SVG)
  → slideglance-png        (PNG)
```

The library entry point `parse_pptx` mirrors the TypeScript reference's
`parsePptxData` + `parseSlideWithLayout` — it returns a fully resolved
`Presentation` with every slide already merged with its layout / master
inheritance and text-style chain.

A CLI binary is shipped under the same crate name for batch conversion
and ad-hoc inspection.

## Status

Pre-release — APIs may change before 1.0.

## License

MIT — see [LICENSE](./LICENSE).
