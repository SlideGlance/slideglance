# slideglance-png

SVG → PNG rasterization for SlideGlance — `resvg`-backed, deterministic.

Part of the [SlideGlance](https://github.com/SlideGlance/slideglance)
Rust crate ecosystem.

## Role

Wraps `resvg` / `usvg` / `tiny_skia` with a deterministic configuration
suitable for PPTX rendering. Project-wide pixel-equivalence settings
(see plan.md "픽셀 동등성 보장 설정"):

- `usvg::TextRendering::GeometricPrecision`
- `usvg::ShapeRendering::GeometricPrecision`
- `usvg::ImageRendering::OptimizeQuality`
- `Database::load_system_fonts` is **never** called — `fontdb` is
  populated only from font byte buffers handed in by the caller, so
  output never depends on the host machine's installed faces. This is
  what guarantees Rust-native ↔ WASM bit-equality.

Same input + same options + same fonts → bitwise-identical PNG bytes.

## Status

Pre-release — APIs may change before 1.0.

## License

MIT — see [LICENSE](./LICENSE).
