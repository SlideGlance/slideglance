---
"@slideglance/builder": major
---

feat!: 8.0.0 — parser hardening, template/import composition, security controls, and schema additions

### Breaking Changes

- **`parsePomDocument` return type**: now returns `{ document, diagnostics }` instead of `ParsedPomDocument` directly. Update callers: `const { document, diagnostics } = parsePomDocument(...)`.
- **`Master.backgroundImage`** renamed to **`Master.backgroundPath`**. The old name is no longer accepted.
- **`fill.transparency` unit**: was silently treated as 0–100 by pptxgenjs but pom passed 0–1. Fixed — pom now converts correctly. Existing values in the 0–1 range will render as intended; values passed expecting 0–100 must be divided by 100.
- **Strict attribute validation**: unknown attributes on any node now produce a parse error (previously silently ignored on some nodes). Typos like `colo="..."` that passed before will now error.

### Deprecated (removed in 9.0.0)

The following attribute forms emit a `DEPRECATED_ATTRIBUTE` diagnostic but continue to work:

| Tag | Deprecated | Canonical |
|---|---|---|
| `<Col>` | `width` | `w` |
| `<Tr>` | `height` | `h` |
| `<FlowNode>` | `width`, `height` | `w`, `h` |
| `<Icon>` | `bgColor` | `backgroundColor` |
| `<Shape>` | `shapeType="line"`, `shapeType="lineInv"` | `<Line>` node |
| `<Slide>` | `notes="..."` attribute | `<Notes>` child element |

See [migration guide](./docs/migration.md) for upgrade examples.

### New Features

**Composition**
- `<Import src="..."/>` — inline external `.pom.xml` files at parse time. Supports nested imports (depth 16), cycle detection, and a caller-supplied `resolveImport` resolver.
- `<Fragment>` — generic wrapper for import-file content.
- `<Templates>` / `<Template>` / `<Use>` / `<Slot>` — parse-time macro expansion with `{param}` placeholder substitution and `<Slot>` content injection. Forward references and cross-file templates both work. Depth limit 32, node budget 100 000 (configurable via `maxTemplateNodes`).
- `<Span lang="...">` — BCP 47 language tag on inline text runs.

**Accessibility**
- `altText` attribute on `<Image>`, `<Icon>`, `<Svg>`, `<Chart>` — screen-reader description.
- `isDecorative` attribute on all nodes — marks element as decorative; sets `altText=""` in the PPTX output.

**Shape / Layout**
- `<Shape textVAlign>` — `"top"` / `"middle"` (default) / `"bottom"` vertical text alignment.
- `<Shape rotate>` and `<Image rotate>` — rotation in degrees.

**Chart**
- `showValue` — display data-point labels on bars/lines.
- `barGrouping` — `"clustered"` / `"stacked"` / `"percentStacked"`.
- `valAxisMinVal` / `valAxisMaxVal` — explicit value-axis range.

**Presentation**
- `<Presentation size>` accepts named aliases: `"A4"`, `"A3"`, `"Letter"` in addition to `"16:9"` and `"4:3"`.
- `buildPptx` `docProps` option — set PPTX document metadata (`title`, `author`, `company`, `subject`).

**Security**
- `allowedHrefSchemes` option — restrict URL schemes in `<A href>`. Default allowlist: `https:`, `http:`, `mailto:`, `tel:`. Disallowed schemes emit `INVALID_HREF_SCHEME` and the hyperlink is cleared. **Active by default.**
- `imageSrcGuard` option — opt-in path-traversal and scheme validation for `<Image src>` and `<Master backgroundPath>`. Off by default; enable explicitly.
- `masterPptxLimits` option — cap the imported master PPTX buffer: 50 MB total, 5 MB per embedded image (defaults).
- XML parser now sets `processEntities: true` explicitly — entity references (`&amp;`, `&lt;`, etc.) are decoded consistently across all parse paths.

**Diagnostics**
- `INVALID_NUMBER_TYPE` — emitted (non-fatal) when `<Ol numberType>` receives a value outside the 16-value enum. The invalid value is dropped and parsing continues.
- `TEMPLATE_EXPANSION_LIMIT` — emitted when `<Use>` expansion exceeds `maxTemplateNodes`.
- `TEMPLATES_NOT_AT_ROOT` — emitted when `<Templates>` appears inside a slide or container instead of at `<Presentation>` root.
- Coercion failures (invalid length/color values) and import errors are reported as fatal `ParseXmlError` rather than non-fatal `Diagnostic` codes. These may become non-fatal in a future minor release.

**Parser hardening (D0)**
- All node attributes validated through typed coercion rules; unknown attributes produce clear error messages with closest-match suggestions.
- `length` coercion supports `"max"` and integer `"\d+%"` in addition to numbers. Decimal or negative percent values are rejected as invalid.
- `color` coercion normalises `#`-prefix and validates 6-digit hex.
- `x` / `y` on all nodes now require numeric values (validated via `BASE_RULES`).
