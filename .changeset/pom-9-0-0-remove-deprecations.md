---
"@slideglance/builder": major
---

feat!: remove all 8.0.0-era deprecated attributes and shorthands

The deprecation channel introduced in 8.0.0 (T20–T27) is fully retired.
Every legacy attribute now errors instead of emitting
`DEPRECATED_ATTRIBUTE`, and the diagnostic code itself plus the
`emitDeprecation` helper are deleted from the public surface.

### Removed legacy forms

| Element / attribute               | Before                          | After                          |
| --------------------------------- | ------------------------------- | ------------------------------ |
| `<Col width="...">`               | `width`                         | `w`                            |
| `<Tr height="...">`               | `height`                        | `h`                            |
| `<FlowNode width="..." height="...">` | `width`, `height`           | `w`, `h`                       |
| `<Icon bgColor="...">`            | `bgColor`                       | `backgroundColor`              |
| `<Shape shapeType="line"\|"lineInv">` | `line` / `lineInv` preset   | `<Line>` element               |
| `<Slide notes="...">`             | `notes` attribute               | `<Notes>` child                |

### Removed API

- `DiagnosticCode` no longer includes `"DEPRECATED_ATTRIBUTE"`.
- `emitDeprecation(diagnostics, attributeName, replacement, sourcePos?)`
  is deleted.

### Why this is a `major` bump

XML documents using any of the legacy forms above will now fail to
parse with `ParseXmlError` (`Unknown attribute "width"`, etc.) or fail
Zod schema validation. Code matching on
`diagnostic.code === "DEPRECATED_ATTRIBUTE"` will be a type error in
TypeScript and a no-op at runtime.

### Upgrade path

1. On 8.x, run your documents and surface every `DEPRECATED_ATTRIBUTE`
   diagnostic.
2. Apply the mechanical renames (table above).
3. Upgrade to 9.0.0.
