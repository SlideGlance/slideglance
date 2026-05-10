<h1 align="center">@slideglance/builder</h1>
<p align="center">
  AI-friendly PowerPoint generation with a Flexbox layout engine.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@slideglance/builder"><img src="https://img.shields.io/npm/v/@slideglance/builder.svg" alt="npm version"></a>
  <a href="https://github.com/slideglance/builder/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@slideglance/builder.svg" alt="License"></a>
</p>

<p align="center">
  Slide Builder — TypeScript library that compiles an XML DSL into editable PowerPoint files (.pptx).
</p>

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Available Nodes](#available-nodes)
- [Node Examples](#node-examples)
- [Documentation](#documentation)
- [License](#license)

## Features

- **AI Friendly** — Simple XML structure designed for LLM code generation.
- **Declarative** — Describe slides as XML. No imperative API calls needed — just data in, PPTX out.
- **Flexible Layout** — Flexbox-style layout with VStack / HStack, powered by yoga-layout.
- **Shorthand + Dot Notation** — Layout/style attributes (e.g. `padding`, `margin`, `border`, `fill`, `shadow`) can mix shorthand and dot notation on the same node. Shorthand sets defaults and dot notation overrides specific keys.
- **Rich Nodes** — 19 built-in node types: charts, flowcharts, tables, timelines, org trees, and more.
- **Schema-validated** — XML input is validated with Zod schemas at runtime with clear error messages.
- **PowerPoint Native** — Generates real editable PowerPoint shapes — not images. Recipients can modify everything.
- **Pixel Units** — Intuitive pixel-based sizing (internally converted to inches at 96 DPI).
- **Master Slide** — Define headers, footers, and page numbers once — applied to all slides automatically.
- **Templates** — Define reusable XML fragments parameterized by `{name}` placeholders and instantiate them with `<Use template="...">`. Slots support multi-element content. See [Templates](./docs/nodes.md#templates).
- **Conditionals & Iteration** — MyBatis-style `<If test="...">`, `<Choose>`/`<When>`/`<Otherwise>`, and `<Foreach items="..." as="m">` run in the same parse-time pass as templates. A small expression language (`==`, `&&`, dotted paths, `empty()`/`length()`) drives the branches. See [Conditionals & Iteration](./docs/nodes.md#conditionals--iteration-if-choose-foreach) in `docs/nodes.md`.
- **Import** — Split a document across multiple files with `<Import src="..." />`. Works anywhere in the tree — at the Presentation root, inside Slides, or inside any container — letting you pull out styles, templates, slides, or content fragments. See [Import](./docs/nodes.md#import).
- **XML Document Mode** — Use a `<SlideGlance>` root to declare slide size, multiple masters, and per-page master assignment inside the XML itself.
- **Accurate Text Measurement** — Text width measured with opentype.js and bundled Noto Sans JP fonts for consistent layout.

## Quick Start

> Requires Node.js 18+

```bash
npm install @slideglance/builder
```

```typescript
import { buildPptx } from "@slideglance/builder";

const xml = `
<VStack w="100%" h="max" padding="48" gap="24" alignItems="start">
  <Text fontSize="48" bold="true">Presentation Title</Text>
  <Text fontSize="24" color="666666">Subtitle</Text>
</VStack>
`;

const { pptx } = await buildPptx(xml, { w: 1280, h: 720 });
await pptx.writeFile({ fileName: "presentation.pptx" });
```

## Available Nodes

| Node   | Description                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------- |
| Text   | Text with font styling, decoration, inline bold/italic/underline/strike/highlight/color, and hyperlinks |
| Ul     | Unordered (bullet) list with Li items                                                                   |
| Ol     | Ordered (numbered) list with Li items                                                                   |
| Image  | Images from file path, URL, or base64                                                                   |
| Table  | Tables with customizable columns and rows                                                               |
| Shape  | PowerPoint shapes (roundRect, ellipse, etc.)                                                            |
| Chart  | Charts (bar, line, pie, area, doughnut, radar)                                                          |
| Line   | Horizontal / vertical lines                                                                             |
| Layer  | Absolute-positioned overlay container                                                                   |
| VStack | Vertical stack layout                                                                                   |
| HStack | Horizontal stack layout                                                                                 |
| Icon   | Lucide icons                                                                                            |
| Svg    | Inline SVG graphics                                                                                     |

For detailed node documentation, see [Nodes](./docs/nodes.md).

## Node Examples

### Chart

```xml
<Chart chartType="bar" w="350" h="250" showTitle="true" title="Bar Chart" showLegend="true">
  <ChartSeries name="Q1">
    <ChartDataPoint label="Jan" value="30" />
    <ChartDataPoint label="Feb" value="45" />
  </ChartSeries>
</Chart>
```

<img src="./docs/images/chart.png" alt="Chart example" width="600">

### Table

```xml
<Table defaultRowHeight="36" cellBorder='{"color":"CBD5E1","width":1}'>
  <Col w="80" />
  <Col w="200" />
  <Tr>
    <Td bold="true" backgroundColor="0F172A" color="FFFFFF">ID</Td>
    <Td bold="true" backgroundColor="0F172A" color="FFFFFF">Name</Td>
  </Tr>
  <Tr>
    <Td>001</Td>
    <Td>Project Alpha</Td>
  </Tr>
</Table>
```

<img src="./docs/images/table.png" alt="Table example" width="600">

## Auto-Fit

When content exceeds the slide height, pom automatically adjusts it to fit within the slide. This is enabled by default.

Adjustments are applied in the following priority order:

1. Reduce table row heights
2. Reduce text font sizes
3. Reduce gap / padding
4. Uniform scaling (fallback)

To disable:

```typescript
const { pptx } = await buildPptx(xml, { w: 1280, h: 720 }, { autoFit: false });
```

## Documentation

| Document                                       | Description                           |
| ---------------------------------------------- | ------------------------------------- |
| [API Reference](./docs/api-reference.md)       | `buildPptx()` function and options    |
| [Nodes](./docs/nodes.md)                       | Complete reference for all node types |
| [Master Slide](./docs/master-slide.md)         | Headers, footers, and page numbers    |
| [Text Measurement](./docs/text-measurement.md) | Text measurement options and settings |

## XML Schema (XSD / JSON Schema)

The package ships an XML Schema (`dist-schema/builder.xsd`, target namespace `urn:slideglance:builder:v1`) and a JSON Schema (`dist-schema/builder.schema.json`) generated from the same compiled registry. Editor tooling can use them for autocomplete and validation.

**VS Code (Red Hat XML extension):**

```jsonc
// .vscode/settings.json
{
  "xml.fileAssociations": [
    {
      "pattern": "**/*.sgx",
      "systemId": "./node_modules/@slideglance/builder/dist-schema/builder.xsd",
    },
  ],
}
```

Or annotate documents directly:

```xml
<Presentation
  xmlns="urn:slideglance:builder:v1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="urn:slideglance:builder:v1 https://unpkg.com/@slideglance/builder/dist-schema/builder.xsd">
  <Slide><Text>Hello</Text></Slide>
</SlideGlance>
```

The runtime parser does not currently require the namespace — XML files without `xmlns` continue to work. Declaring the namespace only enables editor tooling.

## License

MIT
