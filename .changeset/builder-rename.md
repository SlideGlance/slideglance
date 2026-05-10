---
"@slideglance/builder": major
---

chore!: rename package to @slideglance/builder

Forked from `@hirokisakabe/pom`. The package is now published under the
`slideglance` npm scope as `@slideglance/builder` and its repository
moves to `github.com/slideglance/builder`.

### What changes for consumers

- **Install**: `npm install @slideglance/builder` (was
  `@hirokisakabe/pom`).
- **Imports**: `import { buildPptx } from "@slideglance/builder"`.
- **XML namespace**: `urn:slideglance:builder:v1` (was `urn:pom:v1`).
  Existing documents without an `xmlns` declaration continue to parse
  unchanged; only documents that declared the old namespace need to
  update.
- **Schema artifacts**: `dist-schema/builder.xsd` and
  `dist-schema/builder.schema.json` (were `pom.xsd`,
  `pom.schema.json`). The XSD short prefix changes from `pom:` to
  `b:`; the historical `Pom*` named simple types are now `b:Length`,
  `b:Color`, etc.
- **VS Code editor settings** that referenced the schema by file name
  must point at the new file:

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

### What stays

- All public API identifiers (`buildPptx`, `parsePomDocument`,
  `parseXml`, `POMNode`, `PositionedNode`, `ParseXmlError`, …) are
  unchanged. The `POM*` names are kept for continuity with the
  upstream project; the package name and the XML namespace move, but
  the runtime surface does not.
- License remains MIT. Original copyright is preserved on every file
  that survived from the upstream codebase via a header comment.
