---
"@slideglance/builder": minor
---

feat: publish XML Schema (XSD) and JSON Schema generated from a compiled registry SSoT

### Schema artifacts (new)

The package now ships generated schema artifacts in `dist-schema/`:

- **`pom.xsd`** — XML Schema with target namespace `urn:slideglance:builder:v1`. Validates POM XML documents and powers editor tooling (e.g. VS Code Red Hat XML extension) for autocomplete and on-save validation. Includes named simple types (`pom:Length`, `pom:Color`, `pom:Padding`, `pom:BorderStyle`, …), per-node complex types, inline format elements (`<B>`, `<I>`, `<U>`, `<S>`, `<Mark>`, `<A>`, `<Span>`), structured child elements (`<Li>`, `<Row>`, `<Cell>`, `<Series>`, …), and a permissive `<svg>` element accepting any inline SVG markup inside `<Svg>`.
- **`pom.schema.json`** — JSON Schema (Draft 2020-12) describing the post-coercion `POMNode` shape. Each leaf node type appears as a `$defs` entry referenced from a top-level `oneOf`. Useful for tools that consume `POMNode` trees as JSON (Monaco editor, structured-output AI tools).
- **`reference.md`** — Auto-generated machine reference for every node and meta element, including attribute tables, child element cardinality, and example XML where supplied. The hand-curated `docs/nodes.md` (with rich worked examples) remains the primary user-facing reference.

### Compiled registry (new)

A new compiled registry (`packages/builder/src/registry/compiled/index.ts`) declares every node and meta element through `defineNode` / `defineMeta`. It re-uses the existing Zod schemas from `types.ts` and stamps them with XML metadata (attribute coercion type, doc strings, dot-notation hints, child element cardinality, body-alias mapping). All 19 POM nodes, 3 document containers (`<Presentation>`, `<Slide>`, `<Fragment>`), and 7 meta elements (`<Templates>`, `<Template>`, `<Use>`, `<Slot>`, `<Import>`, `<Styles>`, `<Style>`) are covered.

### Tooling

- `pnpm run codegen` — regenerate the schema artifacts.
- `pnpm run codegen:check` — fail on drift; wired into `prepublishOnly`.

### Compatibility

- **No runtime behaviour change.** The XML parser and PPTX renderer are unchanged in this release. The compiled registry is read only by codegen.
- **No breaking changes.** Existing XML files without an `xmlns` declaration continue to parse normally. Declaring `xmlns="urn:slideglance:builder:v1"` is optional and only enables editor tooling.
- A future release will replace `parseXml.ts` and `coercionRules.ts` with a registry-driven dispatcher; this release lays the SSoT foundation.

### Recommended editor configuration

```jsonc
// .vscode/settings.json
{
  "xml.fileAssociations": [
    {
      "pattern": "**/*.pom.xml",
      "systemId": "./node_modules/@slideglance/builder/dist-schema/builder.xsd"
    }
  ]
}
```

Or annotate documents directly:

```xml
<Presentation
  xmlns="urn:slideglance:builder:v1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="urn:slideglance:builder:v1 https://unpkg.com/@slideglance/builder/dist-schema/builder.xsd">
  ...
</Presentation>
```
