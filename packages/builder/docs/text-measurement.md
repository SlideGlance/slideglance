# Text Measurement

The builder uses [`@slideglance/measure`](https://github.com/SlideGlance/slideglance)'s WebAssembly text measurer, populated with bundled `Noto Sans JP` and `Pretendard` font buffers, to measure text width and determine line break positions. This approach works consistently across all Node.js environments, including serverless platforms like Vercel or AWS Lambda.

## textMeasurement Option

You can specify the text measurement method using the `textMeasurement` option if needed:

```typescript
const { pptx } = await buildPptx(
  xml,
  { w: 1280, h: 720 },
  {
    textMeasurement: "auto", // "opentype" | "fallback" | "auto"
  },
);
```

| Value        | Description                                                                            |
| ------------ | -------------------------------------------------------------------------------------- |
| `"opentype"` | Always use the slideglance OpenType measurer for text width (default)                  |
| `"fallback"` | Always use fallback calculation (CJK characters = 1em, alphanumeric = 0.5em estimated) |
| `"auto"`     | Use the slideglance measurer (same as "opentype", default)                             |

## Font Resolution Rules

The builder resolves the measurement method based on the `fontFamily` specified on each node:

1. **Bundled font (`Noto Sans JP`, `Pretendard`)**: Uses the slideglance OpenType measurer for accurate glyph-level measurement. `Noto Sans JP` is the fallback default when no `fontFamily` is specified.
2. **Non-bundled fonts** (e.g., `Arial`, `Meiryo`): Automatically falls back to heuristic estimation (CJK characters = 1em, alphanumeric = 0.5em). This ensures layout does not use mismatched font metrics.
3. **`textMeasurement: "fallback"`**: Forces heuristic estimation regardless of font family.

### Why this matters

Previously, layout measurement always used Noto Sans JP metrics even when a different `fontFamily` was specified for rendering. This caused layout misalignment because the measured widths did not match the rendered widths. Now, bundled fonts such as `Pretendard` use their own metrics, and non-bundled fonts use a font-independent heuristic instead.

> **Limitation**: The non-bundled-font fallback heuristic (CJK = 1em, alphanumeric = 0.5em) is approximate. Scripts with combining marks (Thai vowels, Devanagari matras), ligatures (Arabic), or non-monospace alphabets can produce significantly inaccurate width estimates. For these scripts, prefer specifying explicit width (`w="..."`) on the containing element, or include the relevant font (e.g., a Noto Sans variant for the script in question) as a bundled or system font for more accurate measurement.

### Supported nodes

Font resolution applies consistently to all text-bearing nodes: `Text`, `Ul`, `Ol`, and `Shape`.

## Recommended Settings

- **All environments**: Default (`"auto"`) works fine - bundled fonts ensure consistent results
- **Reduced bundle size**: Use `"fallback"` if you want to avoid loading bundled fonts (less accurate but smaller bundle)
- **Bundled Korean/Japanese fonts**: Use `Pretendard` or `Noto Sans JP` for accurate built-in measurement
- **Other custom fonts**: When using `fontFamily` other than the bundled fonts, the builder automatically uses fallback measurement to avoid metric mismatch
