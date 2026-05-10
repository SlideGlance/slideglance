---
"@slideglance/builder": patch
---

refactor: drive the runtime XML parser from the compiled registry SSoT

Internal restructure with no behavioral or API change. The XML parser was
previously split between `parseXml.ts` (2,326 lines) and a parallel
`coercionRules.ts` data file. Both have been replaced.

### What changed (internal)

- `parseXml/dispatcher.ts` reads `ALL_COMPILED_NODES` from
  `registry/compiled/index.ts` for tag lookup, attribute existence, and
  unknown-attribute suggestions.
- `parseXml/coerceByType.ts` is a self-contained coercion engine driven
  by the registry's `CoerceType` (`number`, `length`, `color`, `padding`,
  `border`, `fill`, `shadow`, `underline`, `imageSizing`, `lineArrow`,
  `iconColor`, ...). Replaces the legacy `coerceWithRule` /
  `CoercionRule` object model.
- `AttributeSpec.objectShape` (new optional field) carries the structured
  sub-field shape for the three `coerce: "json"` attributes that
  nonetheless support dot-notation: `backgroundImage`,
  `Tree.connectorStyle`, `Flow.connectorStyle`.
- `parseXml/childAttributeSpecs.ts` declares per-child-element specs
  (Master objects, table Cell/Tr/Td, list Li, inline format tags,
  timeline/matrix/flow/tree items) using the same `AttributeSpec`
  shape. A future cleanup may roll these into the compiled registry.
- `parseXml.ts` shrinks from 2,326 lines to 105: it now owns only the
  public types, the parse-context lifecycle, and the entry functions.
  Conversion logic lives in `dispatcher.ts`; document parsing
  (Presentation/Master/Slide flow) lives in `document.ts`.

### Removed

- `parseXml/coercionRules.ts` (778 lines) and its test file (534
  lines). All behavior is preserved through `coerceByType` and the
  existing integration tests in `parseXml.test.ts` plus a focused new
  `coerceByType.test.ts` (35 cases).

### Compatibility

- **No public API change.** `parsePomDocument`, `parseXml`, all
  diagnostic codes, error messages, and parse output remain identical.
- **No XML behavior change.** Existing documents parse to the same
  POMNode trees as before.
- The package's `dist-schema/` artifacts (`pom.xsd`, `pom.schema.json`,
  `reference.md`) are byte-identical to the previous release.
