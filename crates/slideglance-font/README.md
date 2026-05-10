# slideglance-font

Font mapping, measurement, and shaping for SlideGlance — OOXML font
scheme + system / Google Fonts fallback chain.

Part of the [SlideGlance](https://github.com/SlideGlance/slideglance)
Rust crate ecosystem.

## Role

Owns everything between an OOXML font reference (theme tokens or
text-run `typeface` strings) and a renderable glyph: chain resolution,
metrics, fallback selection, shaping. Modules:

- `mapping` — `DEFAULT_FONT_MAPPING` table + case-insensitive +
  full-width-normalized lookup.
- `cjk_fallback` — per-OS preinstalled CJK fallback chains for
  Japanese / Korean / Chinese (Simplified + Traditional). All four
  CJK scripts are treated equally per the project's CJK Script
  Equality rule (see root `CLAUDE.md`).
- `system_fonts` (gated behind the `system-fonts` feature) — Node-only
  scanner for installed faces; opt-in to keep the WASM bundle small.
- `metric_match` (gated behind `metric-match`) — OSS metric-compatible
  fallback chooser, depends on `font-kit`.

Consumed by `slideglance-renderer` (text path), the standalone
`slideglance-measure-wasm` (text-only WASM measurement), and the
JS-side `@slideglance/measure` package.

## Status

Pre-release — APIs may change before 1.0.

## License

MIT — see [LICENSE](./LICENSE).
