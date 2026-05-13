# Discovered builder gaps and feature requests

A running log of features the `@slideglance/builder` schema currently
lacks but that upstream HTML deck systems use freely. Each entry has
the workaround the skill applies today plus a sketch of the proper
fix on the builder side.

When a fix lands upstream, move the entry to the "Resolved" section
with the builder commit / release.

## Open

_No open requests at this time. All items below were either resolved
in this cycle or are blocked upstream._

## Blocked upstream (pptxgenjs 4.0.1)

These items require pptxgenjs API surface that does not exist in the
shipped version. They remain pending an upstream change (PR to
pptxgenjs) or a substantial detour through raw PPTX XML rewriting.

### B-1. `<SlideNumber format>` (placeholder + prefix/suffix)

**Where it bites**: Conventional `"3 / 12"`, `"03 · 12"` page-number
formats.

**Upstream blocker**: `SlideNumberProps` emits a fixed
`<a:fld type="slidenum">` placeholder via the master XML path
(`pptxgen.cjs.js:5715` in 4.0.1) with no `format` / `text` /
`prefix` / `suffix` option. Wrapping the placeholder with author
text requires either an upstream pptxgenjs PR adding a `format`
property to `SlideNumberProps` or a post-write zip rewrite of
`slideMaster1.xml`'s slide-number paragraph — both out of scope.

**Today's workaround**: Position the SlideNumber box yourself + use
`<MasterText>` alongside it for any prefix / suffix decoration.
Cannot express "current / total" dynamically; the total has to be
hard-coded as static MasterText next to the placeholder.

**Note**: `textAlign` on `<SlideNumber>` landed in this cycle (maps
to pptxgenjs `slideNumber.align`). Only `format` remains.

### B-2. Text gradients

**Where it bites**: Editorial headlines with a multi-stop gradient
fill on the glyphs.

**Upstream blocker**: pptxgenjs 4.0.1's `ShapeFillProps` only
supports `type: 'none' | 'solid'` — no `gradient` / `gradFill`
option on text runs or shape fill. The PPTX file format itself
supports `<a:gradFill>` inside an `<a:rPr>` text run, but pptxgenjs
does not expose it through the public API.

**Today's workaround**: Render gradient text as `<Svg>` with a
`<linearGradient>` and `<text fill="url(#g)">`. Builder rasterises
to PNG and embeds. Loses copy-paste / searchability / accessibility.
SVG width is capped at 1024 by the schema.

**Proper fix**: Upstream PR to pptxgenjs adding `gradient` to
`ShapeFillProps` (and mirroring on text run options), then map a
new `color.gradient` dot-notation on `<Text>` to it.

### B-3. Variable-font axes beyond bold / italic

**Where it bites**: Modern editorial display faces (Inter Tight,
Newsreader, Cormorant Garamond) ship `wght`, `wdth`, optical-size
axes. Selecting an intermediate weight (e.g. `wght=550`) is not
expressible.

**Upstream blocker**: pptxgenjs 4.0.1's text run options expose
only `bold?: boolean` and no `fontWeight` / `fontStretch` /
variable-axis property. The PPTX file format supports `<a:rPr>`
attributes for these (notably `b="1"` / `i="1"` plus the
`<a:latin typeface="..."/>` family selection), but
pptxgenjs collapses to boolean bold.

**Today's workaround**: Pick the matching static instance of the
desired weight (e.g. `fontFamily="Inter Tight"` instead of
`fontFamily="Inter" wght="800"`). Static-instance availability
depends on the recipient's font installation.

**Proper fix**: Upstream PR to pptxgenjs forwarding `fontWeight` /
`fontStretch` to run properties, then expose them on the
slideglance `TEXT_STYLE_ATTRS` table.

## Out of scope (won't fix)

Items below are documented gaps the skill **does not plan to close**.
They conflict with the medium's positioning (static `.pptx`) or with
the parse-time grammar contract. Keep them visible here so authors
who hit the limitation get an explicit answer instead of an open
ticket.

### Slide transitions and entrance animations

**Where it bites**: Upstream HTML decks rely heavily on CSS keyframe
animations and canvas FX.

**Why won't fix**: The skill explicitly positions slideglance as a
**static `.pptx`** medium —
[`limitations.md`](./limitations.md) documents this. PPTX _does_
support transitions and entrance effects at the file format level,
and a future implementation could expose `<Slide transition="fade">`
/ `<Element entrance="fadeIn">` mapping to pptxgenjs's animation
output. But the value proposition (recipient-editable,
paste-into-existing-review-workflow, deterministic render) doesn't
depend on animation, and adding it would dilute the medium's
identity. Authors who need keyframe animations should use the
upstream HTML deck skill family instead.

### Conditional layout that depends on layout result

**Where it bites**: "If the title overflows, switch the layout to
two-column." The control-flow tags (`<If>`, `<Choose>`) run at parse
time and have no access to layout output.

**Why won't fix**: Pre-layout overflow detection is conceptually
layout-time, post-parse — it does not fit the parse-time grammar
contract. The single-pass
`parseXml → calcYogaLayout → toPositioned → renderPptx` pipeline
keeps the grammar deterministic and debuggable; threading layout
output back into the parse stage would require a second pass and
break that invariant. Autofit handles the simple shrink-to-fit
case; for branching layout decisions, author two slides and switch
by hand.

## Resolved

Resolved in the current cycle. Each entry names the attribute /
schema surface and the file(s) where the implementation lives, so
future readers can find the work without grepping commit history.

### R-1. `letterSpacing` on text (and `<MasterText>`)

- `TEXT_STYLE_ATTRS` exposes `letterSpacing` (em units).
- `textNodeSchema`, `ulNodeSchema`, `olNodeSchema`,
  `shapeNodeSchema`, `tableCellSchema`, `liNodeSchema`,
  `masterTextObjectSchema` accept it.
- Render path: `renderPptx/textOptions.ts` and per-node renderers
  (`shape.ts`, `table.ts`, `list.ts`, `renderPptx.ts#convertMasterObject`)
  map to pptxgenjs `charSpacing` (1/100 em).
- **Trade-off**: the WASM text measurer ignores tracking, so
  autofit may underestimate wrap width by a small amount on lines
  with large absolute `letterSpacing`. Documented inline in
  `BASE_ATTRS.letterSpacing.doc`.

### R-2. Per-child `flexGrow` / `flexShrink` / `flexBasis`

- `BASE_ATTRS` exposes `flexGrow`, `flexShrink`, `flexBasis`.
- `baseNodeSchema` (so all node types inherit).
- `calcYogaLayout.ts` applies explicit overrides _after_ the
  context-aware defaults (HStack equal-distribution, growing-sibling
  pin, noWrap shrink-0), so an author-specified value always wins.
- `flexBasis="max"` maps to `setFlexBasisAuto()`; percentages map
  to `setFlexBasisPercent`.

### R-3. `<MasterLine>` endpoint-pair (x1 / y1 / x2 / y2)

- `MasterLine` child-attribute spec accepts both
  `(x, y, w, h)` and `(x1, y1, x2, y2)`.
- `parseXml/document.ts` folds the endpoint-pair into
  positioned-rect: `x = x1`, `y = y1`, `w = x2 - x1`,
  `h = y2 - y1`. pptxgenjs `line` shape accepts signed offsets,
  so diagonal lines work without explicit rotation.

### R-4. `<SlideNumber textAlign>`

- `slideNumberOptionsSchema` accepts
  `textAlign: "left" | "center" | "right"`.
- `renderPptx.ts` maps to pptxgenjs `slideNumber.align`.
- **`format` is not resolved** — see B-1.

### R-5. Per-side border (`borderTop`/`Right`/`Bottom`/`Left`)

- `baseNodeSchema` accepts each side as an independent
  `borderStyle` object (dot-notation).
- `BASE_ATTRS` registers each as `coerce: "border"` with
  `dotNotation: true`.
- `renderPptx/utils/backgroundBorder.ts` introduces
  `renderPerSideBorders`, which emits one `line` shape per
  configured side after the base shape. Composes additively with
  uniform `border`.

### R-6. `padding` / `margin` two- / three- / four-value shorthand

- `coerceByType.ts#coercePadding` accepts CSS-style multi-value
  shorthand (`"V H"`, `"T H B"`, `"T R B L"`) and decomposes to
  `{ top, right, bottom, left }`.

### R-7. `<MasterText>` `lineHeight`

- `masterTextObjectSchema` accepts `lineHeight: number`
  (unitless multiplier).
- `renderPptx.ts#convertMasterObject` maps to pptxgenjs
  `lineSpacingMultiple`.
- `letterSpacing` ships alongside (see R-1).

### R-8. `<MasterRect>` `borderRadius` / `opacity`

- `masterRectObjectSchema` accepts both.
- `renderPptx.ts#convertMasterObject case "rect"` maps
  `borderRadius` to pptxgenjs `rectRadius` (in inches) and
  `opacity` to `fill.transparency = (1 - opacity) * 100`.
  Explicit `fill.transparency` takes precedence when both are
  supplied.

### R-9. `<Td>` `padding`

- `tableCellSchema` accepts `padding` (dot-notation) alongside the
  pre-existing `margin`. The `Td` child-attribute spec mirrors.
- `renderPptx/nodes/table.ts` resolves `cell.padding ?? cell.margin`
  for the cell-margin pt tuple. The two are aliases for what
  PowerPoint internally calls "cell margin" — table cells have no
  outer spacing concept.

### R-10. `alignItems="baseline"` on `<HStack>` / `<VStack>`

- `alignItemsSchema` enum accepts `"baseline"`.
- `registry/definitions/stack.ts` maps to `yoga.ALIGN_BASELINE`.
- **Trade-off**: without a custom Yoga baseline function on text
  measure nodes, Yoga falls back to the bottom edge of each child's
  content box. For typical text rows at `lineHeight=1.0` that is
  close to the visual baseline. The pixel-perfect path for mixed-
  size editorial rows remains the
  `textVAlign="middle" lineHeight="1.0"` idiom documented in
  `grammar.md` §"Mixed-size text rows".

## How to add an entry

When you hit a builder limitation:

1. Confirm it's a real schema gap (grep
   `packages/builder/src/registry/compiled/index.ts` and
   `childAttributeSpecs.ts`).
2. Append an entry to "Open" above with the three sections:
   _Where it bites · Today's workaround · Proper fix_. If the gap is
   intentional and won't be closed, append it under
   "Out of scope (won't fix)" with a _Why won't fix_ section instead.
   If the gap exists upstream (pptxgenjs / similar) with no clean
   builder-side mitigation, append it under "Blocked upstream" with
   a _Where it bites · Upstream blocker · Today's workaround · Proper
   fix_ trio.
3. Also update [`schema-gotchas.md`](./schema-gotchas.md) so authors
   know about the limitation when they hit it.
4. If you implement the fix in the builder, move the entry to
   "Resolved" with the file/symbol where the implementation lives.
