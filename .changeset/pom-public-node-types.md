---
"@slideglance/builder": minor
---

feat: expose all node and style atom types from the package root

Every POM node type (`TextNode`, `ImageNode`, …, `LayerNode`), the
`POMNode` / `PositionedNode` / `PositionedLayerChild` unions, and the
shared style atoms (`Length`, `Padding`, `BorderStyle`, `FillStyle`,
`ShadowStyle`, `Underline`, `AlignItems`, `JustifyContent`, `FlexWrap`,
`PositionType`, `BulletNumberType`, `ShapeType`, `BackgroundImage`, …)
are now re-exported from the package entry point.

```ts
import type {
  POMNode,
  TextNode,
  TableNode,
  BorderStyle,
  ShadowStyle,
  // …
} from "@slideglance/builder";
```

Before this change, callers wanting typed POM trees had to deep-import
from `@slideglance/builder/dist/types.js`, which was unstable. The
re-exports give consumers a single supported import path.

### Internal restructure (no behavior change)

The atom Zod schemas (`length`, `padding`, `border`, `fill`/`shadow`,
the layout enums, `underline`, `defaultTextStyle`, `backgroundImage`,
the 180-entry `shapeType`) were extracted out of `src/types.ts` into a
focused `src/registry/shared/` module hierarchy. `types.ts` shrinks
from 1,126 lines to 851 by re-importing instead of redeclaring; node
schemas and the POMNode union remain there.
