# API Reference

## buildPptx

The main function that takes an XML string and generates a PowerPoint presentation.

### Signature

```typescript
async function buildPptx(
  xml: string,
  slideSize: { w: number; h: number },
  options?: {
    master?: SlideMasterOptions;
    masters?: SlideMasterOptions[];
    defaultMaster?: string;
    masterPptx?: ArrayBuffer | Uint8Array;
    textMeasurement?: TextMeasurementMode;
    defaultTextStyle?: DefaultTextStyle;
    autoFit?: boolean;
    strict?: boolean;
    resolveImport?: ImportResolver;
    sourcePath?: string;
    trackSourcePos?: boolean;
    docProps?: {
      title?: string;
      author?: string;
      company?: string;
      subject?: string;
    };
    defaultLang?: string;
    allowedHrefSchemes?: string[];
    imageSrcGuard?: ImageSrcGuardOptions;
    masterPptxLimits?: MasterPptxLimits;
    maxTemplateNodes?: number;
  },
): Promise<BuildPptxResult>;
```

### Parameters

#### `xml` (required)

An XML string describing the presentation. The recommended form wraps slides in a `<SlideGlance>` root, which enables slide size, masters, styles, templates, and multi-file imports:

```typescript
const xml = `
<SlideGlance>
  <Document size="16:9" />
  <Slide>
    <VStack padding="40" gap="16">
      <Text fontSize="32" bold="true">Q4 Highlights</Text>
      <Text fontSize="18" color="666666">Revenue +12%</Text>
    </VStack>
  </Slide>
</SlideGlance>
`;
```

For quick prototyping or a single slide, you can also pass a serialized form where each root-level element represents one slide:

```typescript
const xml = `
<VStack w="100%" h="max" padding="48">
  <Text fontSize="32" bold="true">Slide 1</Text>
</VStack>
<VStack w="100%" h="max" padding="48">
  <Text fontSize="24">Slide 2</Text>
</VStack>
`;
```

> **Note**: For anything beyond a single slide, use `<SlideGlance>` — it enables slide size, masters, `<Styles>`, `<Templates>`, and `<Import>` for multi-file composition.

> **Security**: When processing untrusted XML, validate the following attributes before generating XML — they can trigger arbitrary file reads, SSRF, or PPTX hyperlink injection when callers accept untrusted input:
>
> - **`<Image src>`** — see [Image](./nodes.md#4-image) for details (pptxgenjs reads paths via `fs.readFileSync` / `https.get`)
> - **`<Master backgroundPath>`** — see [Background Options](./master-slide.md#background-options); same risks as `<Image src>`
> - **`<A href>`** — see [Inline Formatting in Text](./nodes.md#1-text) for the `<A>` security note (PPTX hyperlinks with `javascript:` / `vbscript:` schemes)
> - **`<Import src>`** — see [Import](./nodes.md#import) for resolver path-traversal mitigation
>
> Each linked section contains the specific allowlist guidance and example code.

See [Nodes](./nodes.md) for available node types and [llm.txt](/llm.txt) for the complete XML reference.

#### `slideSize` (required)

The slide dimensions in pixels. Internally converted to inches at 96 DPI.

```typescript
// 16:9 (recommended)
{ w: 1280, h: 720 }

// 4:3
{ w: 960, h: 720 }
```

#### `options` (optional)

| Property                          | Type                                      | Default     | Description                                                                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `master`                          | `SlideMasterOptions`                      | `undefined` | Slide master settings                                                                                                                                                                                                                |
| `masters`                         | `SlideMasterOptions[]`                    | `undefined` | Multiple named slide masters. Each item should have a unique `title`                                                                                                                                                                 |
| `defaultMaster`                   | `string`                                  | `undefined` | Default master name when using `masters` or XML `<SlideGlance>                                                                                                                                                                       |
| <Document defaultMaster="..." />` |
| `masterPptx`                      | `ArrayBuffer \| Uint8Array`               | `undefined` | Existing PPTX file to use as master (extracts background). See [Master Slide](./master-slide.md).                                                                                                                                    |
| `textMeasurement`                 | `TextMeasurementMode`                     | `"auto"`    | Text width measurement method                                                                                                                                                                                                        |
| `defaultTextStyle`                | `DefaultTextStyle`                        | `undefined` | Default text attributes (fontSize / fontFamily / color / lineHeight) applied to all text nodes. Per-node attrs and `<SlideGlance>` `defaultTextStyle` still override                                                                 |
| `autoFit`                         | `boolean`                                 | `true`      | Auto-fit content when it overflows slides                                                                                                                                                                                            |
| `strict`                          | `boolean`                                 | `false`     | Throw `DiagnosticsError` if any diagnostics are collected                                                                                                                                                                            |
| `resolveImport`                   | `ImportResolver`                          | `undefined` | Synchronous loader called for every `<Import src="..." />`. Required when the XML uses `<Import>`. Signature: `(src, fromPath) => { content, path }`                                                                                 |
| `sourcePath`                      | `string`                                  | `undefined` | Absolute path of the root document. Passed as `fromPath` on the first `resolveImport` call so relative `<Import>` paths resolve correctly                                                                                            |
| `trackSourcePos`                  | `boolean`                                 | `false`     | When `true`, the returned `BuildPptxResult` carries a `sourceMap` and every rendered pptxgenjs object gets an `objectName="node#N"` encoding its origin node id                                                                      |
| `docProps`                        | `{ title?, author?, company?, subject? }` | `undefined` | Document metadata written to the PPTX file's core properties (docProps/core.xml). Presentation-level `lang` is not supported by pptxgenjs 4.0.1 — use `defaultLang` instead                                                          |
| `defaultLang`                     | `string`                                  | `undefined` | BCP 47 language tag applied as fallback to text runs without an explicit `lang` attribute (e.g. `"en-US"`, `"ja-JP"`). Currently applied to `<Text>` runs only — `<Shape>`, `<Ul>`, and `<Ol>` text uses pptxgenjs runtime defaults. |
| `allowedHrefSchemes`              | `string[]`                                | `undefined` | Additional URL schemes allowed in `<A href>` beyond the defaults (`https:`, `http:`, `mailto:`, `tel:`)                                                                                                                              |
| `imageSrcGuard`                   | `ImageSrcGuardOptions`                    | `undefined` | Opt-in validation for `<Image src>` and `<Master backgroundPath>`. When omitted, no validation is applied                                                                                                                            |
| `masterPptxLimits`                | `MasterPptxLimits`                        | `undefined` | Size caps for the `masterPptx` buffer (default: 50 MB total, 5 MB per image)                                                                                                                                                         |
| `maxTemplateNodes`                | `number`                                  | `100000`    | Maximum nodes produced by `<Use>` template expansion. Exceeding the limit emits a `TEMPLATE_EXPANSION_LIMIT` diagnostic                                                                                                              |

### Return Value

Returns a `BuildPptxResult` object:

| Field         | Type                            | Description                                                                                                                                                                                                      |
| ------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pptx`        | pptxgenjs                       | The generated presentation instance                                                                                                                                                                              |
| `diagnostics` | `Diagnostic[]`                  | Warnings collected during the build process                                                                                                                                                                      |
| `sourceMap`   | `BuilderSourceMap \| undefined` | Only present when `trackSourcePos: true`. Maps each rendered node's `__nodeId` → its origin `{ file, line }`. Useful for tools (e.g. the builder-vscode preview) that want click-to-reveal-source in the editor. |

```typescript
const { pptx, diagnostics } = await buildPptx(xml, { w: 1280, h: 720 });

// Save to file (Node.js)
await pptx.writeFile({ fileName: "output.pptx" });

// Check for warnings
if (diagnostics.length > 0) {
  console.warn("Build warnings:", diagnostics);
}
```

### Errors

- **`ParseXmlError`** — Thrown when the XML string is invalid or contains unknown tags/attributes.
- **`DiagnosticsError`** — Thrown when `strict: true` is set and diagnostics are collected during build.

> **Note**: Coercion failures (invalid length/color values) and import errors are reported as fatal `ParseXmlError` rather than non-fatal `Diagnostic` entries. They may move to the diagnostic stream in a future release.

> **Security**: `Diagnostic.message` may include user-supplied attribute values verbatim (e.g., `Cannot convert "secret-token" to number`). When logging or transmitting diagnostics in a server-side context that processes untrusted XML, mask sensitive values before persisting or forwarding.

```typescript
import {
  buildPptx,
  ParseXmlError,
  DiagnosticsError,
} from "@slideglance/builder";

try {
  const { pptx } = await buildPptx(xml, { w: 1280, h: 720 }, { strict: true });
} catch (e) {
  if (e instanceof ParseXmlError) {
    console.error("Invalid XML:", e.message);
  }
  if (e instanceof DiagnosticsError) {
    console.error("Build diagnostics:", e.diagnostics);
  }
}
```

### Diagnostic Codes

Each `Diagnostic` carries a stable `code` literal so callers can branch on the failure mode without parsing `message`. Optional `sourcePos` carries the `{ file, line }` of the offending element when the parser can attribute it.

| Code                       | Severity | Triggered by                                                                                                                                                       |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `IMAGE_MEASURE_FAILED`     | warning  | An `<Image>` source could not be measured during the prefetch pass; the layout falls back to declared `w`/`h` or zero size.                                        |
| `IMAGE_NOT_PREFETCHED`     | warning  | An `<Image>` was rendered without a measured size (the prefetch step did not run for it). The image still renders.                                                 |
| `AUTOFIT_OVERFLOW`         | warning  | Auto-fit ran every shrink strategy but content still overflowed the slide. Output may be truncated visually.                                                       |
| `SCALE_BELOW_THRESHOLD`    | warning  | Auto-fit's uniform-scale fallback would scale below the 0.5× safety threshold. Content is left at its overflowing size.                                            |
| `MASTER_PPTX_PARSE_FAILED` | warning  | The `masterPptx` buffer could not be parsed. The build proceeds without the extracted background.                                                                  |
| `MASTER_PPTX_SIZE_LIMIT`   | warning  | The `masterPptx` buffer or one of its embedded images exceeds `masterPptxLimits`. The buffer is rejected and the build proceeds.                                   |
| `INVALID_HREF_SCHEME`      | warning  | An `<A href>` value uses a scheme outside the allowlist (defaults: `https:` `http:` `mailto:` `tel:`, plus `allowedHrefSchemes`). The hyperlink is dropped.        |
| `INVALID_IMAGE_SRC`        | warning  | `imageSrcGuard` rejected an `<Image src>` or `<Master backgroundPath>` value (scheme not in `allowSchemes`, or path escapes `allowBaseDir`). The image is dropped. |
| `TEMPLATE_EXPANSION_LIMIT` | warning  | `<Use>` template expansion produced more than `maxTemplateNodes` nodes (default 100,000). Subsequent expansion is aborted.                                         |
| `TEMPLATES_NOT_AT_ROOT`    | warning  | A `<Templates>` block was found nested inside `<Slide>` / `<VStack>` / etc. instead of at `<SlideGlance>` or `<Fragment>` root. The block is ignored.              |
| `INVALID_NUMBER_TYPE`      | warning  | `<Ol numberType="...">` was set to a value outside the supported enum. The attribute is stripped.                                                                  |

When `strict: true`, any of the above also turns into a `DiagnosticsError`.

---

## Options

### master

Defines a slide master with static objects and page numbers applied to all slides. See [Master Slide](./master-slide.md) for full documentation.

```typescript
const { pptx } = await buildPptx(
  xml,
  { w: 1280, h: 720 },
  {
    master: {
      title: "MY_MASTER",
      background: { color: "F8FAFC" },
      objects: [
        {
          type: "text",
          text: "Header",
          x: 48,
          y: 12,
          w: 200,
          h: 28,
          fontSize: 14,
        },
      ],
      slideNumber: { x: 1100, y: 690, fontSize: 10 },
    },
  },
);
```

### textMeasurement

Controls how text width is measured for line breaking and layout. Accepts `"opentype"`, `"fallback"`, or `"auto"` (default). See [Text Measurement](./text-measurement.md) for details on each mode.

### autoFit

When enabled (default), content that exceeds the slide height is automatically adjusted to fit. Adjustments are applied in priority order:

1. Reduce table row heights
2. Reduce text font sizes
3. Reduce gap / padding
4. Uniform scaling (fallback)

```typescript
// Disable auto-fit
const { pptx } = await buildPptx(
  xml,
  { w: 1280, h: 720 },
  {
    autoFit: false,
  },
);
```

### defaultTextStyle

Default attributes applied to every text node. Per-node attributes and `<SlideGlance defaultTextStyle="...">` still take precedence over this option.

```typescript
const { pptx } = await buildPptx(
  xml,
  { w: 1280, h: 720 },
  {
    defaultTextStyle: {
      fontFamily: "Noto Sans",
      fontSize: 18,
      color: "0F172A",
      lineHeight: 1.35,
    },
  },
);
```

### resolveImport / sourcePath

Opt-in support for splitting a `.sgx` document across multiple files via `<Import src="..." />`. The resolver is called synchronously and must return both the imported file's `content` and the absolute `path` it resolved to (used for cycle detection).

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { buildPptx, type ImportResolver } from "@slideglance/builder";

const resolveImport: ImportResolver = (src, fromPath) => {
  const base = fromPath ? path.dirname(fromPath) : process.cwd();
  const resolved = path.resolve(base, src);
  return { content: fs.readFileSync(resolved, "utf8"), path: resolved };
};

const { pptx } = await buildPptx(
  fs.readFileSync("index.sgx", "utf8"),
  { w: 1280, h: 720 },
  {
    resolveImport,
    sourcePath: path.resolve("index.sgx"),
  },
);
```

`<Import>` may appear anywhere in the tree; imported files require a `<Fragment>` (or `<SlideGlance>`) root. Recursive imports are bounded at depth 16 and cycles are detected by absolute path. See [Nodes → Import](./nodes.md#import) for the full XML reference.

### trackSourcePos

When enabled, every BuilderNode is tagged with an internal `__nodeId` and the returned result carries a `sourceMap` that maps each id to its origin `{ file, line }`. Every rendered pptxgenjs object also gets an `objectName="node#N"` so downstream tools can look up the origin from a rendered PPTX.

This is what powers the builder-vscode preview's "click → reveal source" feature — your own tooling can use it the same way. It costs a small amount of additional bookkeeping during parse and render, so it is off by default.

```typescript
const { pptx, sourceMap } = await buildPptx(
  xml,
  { w: 1280, h: 720 },
  { trackSourcePos: true, resolveImport, sourcePath },
);

// sourceMap: Map<number, { file?: string; line: number }>
for (const [id, pos] of sourceMap!) {
  console.log(`node #${id} originated at ${pos.file ?? "(root)"}:${pos.line}`);
}
```

`file` is `undefined` for nodes that came from the root document when it was passed as a plain string without `sourcePath`. Otherwise it is the absolute path returned by the relevant `resolveImport` call.

### imageSrcGuard

Opt-in runtime validation for `<Image src>` and `<Master backgroundPath>`. When the option is `undefined`, no validation is applied. When supplied, every image source is checked against the configured allowlist; rejections emit `INVALID_IMAGE_SRC` (or `INVALID_HREF_SCHEME` for the URL-scheme branch) and the image is dropped from the slide.

```typescript
type ImageSrcGuardOptions = {
  /** URL schemes allowed for <Image src> and <Master backgroundPath>. */
  allowSchemes?: string[];
  /**
   * If set, file:// and relative paths must resolve under this directory.
   * Paths outside the base dir emit INVALID_IMAGE_SRC and are dropped.
   */
  allowBaseDir?: string;
};

const { pptx } = await buildPptx(
  xml,
  { w: 1280, h: 720 },
  {
    imageSrcGuard: {
      allowSchemes: ["https:", "data:"],
      allowBaseDir: path.resolve("./assets"),
    },
  },
);
```

### masterPptxLimits

Size caps for `masterPptx`. Buffers larger than `maxBytes` (default 50 MB) or with embedded images larger than `maxImageBytes` (default 5 MB) emit `MASTER_PPTX_SIZE_LIMIT` and are rejected.

```typescript
type MasterPptxLimits = {
  /** Maximum total size of the masterPptx buffer in bytes. Default 50 MB. */
  maxBytes?: number;
  /** Maximum size of a single extracted image in bytes. Default 5 MB. */
  maxImageBytes?: number;
};

const { pptx } = await buildPptx(
  xml,
  { w: 1280, h: 720 },
  {
    masterPptx: fs.readFileSync("template.pptx"),
    masterPptxLimits: {
      maxBytes: 25 * 1024 * 1024,
      maxImageBytes: 1 * 1024 * 1024,
    },
  },
);
```

### allowedHrefSchemes

Widen the default `<A href>` allowlist (`https:`, `http:`, `mailto:`, `tel:`). Hyperlinks with a scheme outside the combined list emit `INVALID_HREF_SCHEME` and the hyperlink is dropped (text content is preserved).

```typescript
const { pptx } = await buildPptx(
  xml,
  { w: 1280, h: 720 },
  {
    allowedHrefSchemes: ["ftp:", "sftp:"],
  },
);
```

### docProps

Document metadata written to the PPTX's `docProps/core.xml`. PowerPoint surfaces these in **File → Info → Properties** and Office search uses them as well. All fields are optional.

```typescript
const { pptx } = await buildPptx(
  xml,
  { w: 1280, h: 720 },
  {
    docProps: {
      title: "Q4 2026 Review",
      author: "Acme Corp.",
      company: "Acme Corp.",
      subject: "Quarterly business review",
    },
  },
);
```

### defaultLang

BCP 47 fallback language tag applied to `<Text>` runs that do not declare an explicit `lang` attribute. The `lang` attribute on individual runs always wins. Currently scoped to `<Text>` runs only (`<Shape>`, `<Ul>`, `<Ol>` text use pptxgenjs runtime defaults).

```typescript
const { pptx } = await buildPptx(
  xml,
  { w: 1280, h: 720 },
  {
    defaultLang: "ko-KR",
  },
);
```

### maxTemplateNodes

Hard ceiling on the number of nodes emitted by `<Use>` template expansion (default 100,000). Decks that exceed the cap emit `TEMPLATE_EXPANSION_LIMIT` and the surplus expansions are dropped.

---

## parseBuilderDocument

Parse a `.sgx` string into nodes plus presentation-level metadata, without building a PPTX. Useful for tools that want to analyze or transform documents (e.g. the builder-vscode preview).

```typescript
function parseBuilderDocument(
  xml: string,
  options?: {
    resolveImport?: ImportResolver;
    sourcePath?: string;
    trackSourcePos?: boolean;
    maxTemplateNodes?: number;
  },
): ParseResult;

interface ParseResult {
  document: ParsedBuilderDocument;
  diagnostics: Diagnostic[];
}

interface ParsedBuilderDocument {
  nodes: BuilderNode[];
  slideSize?: { w: number; h: number };
  masters?: SlideMasterOptions[];
  masterContents?: Record<string, BuilderNode[]>;
  defaultMaster?: string;
  defaultTextStyle?: DefaultTextStyle;
  sourceMap?: BuilderSourceMap;
}
```

Import and `<Templates>` expansion both run during `parseBuilderDocument`, so `nodes[i]` is the fully-materialized tree for slide `i` regardless of how it was composed across files.

---

## Exported Types

```typescript
import type {
  BuildPptxResult,
  BuildPptxOptions,
  TextMeasurementMode,
  ImageSrcGuardOptions,
  MasterPptxLimits,
  Diagnostic,
  DiagnosticCode,
  ParseResult,
  ParsedBuilderDocument,
  ParseBuilderDocumentOptions,
  ImportResolver,
  BuilderSourceMap,
  BuilderSourcePos,
  DefaultTextStyle,
  SlideMasterOptions,
  SlideMasterBackground,
  SlideMasterMargin,
  MasterObject,
  MasterTextObject,
  MasterImageObject,
  MasterRectObject,
  MasterLineObject,
  SlideNumberOptions,
} from "@slideglance/builder";
```
