---
"@slideglance/builder": minor
---

feat(builder): MyBatis-style control-flow tags `<If>`, `<Choose>`/`<When>`/`<Otherwise>`, and `<Foreach>`

Adds parse-time conditional inclusion and iteration to the template
expansion pass. The new tags share the `<Use>`/`<Slot>` substitution scope
and a small dedicated expression language, so they compose naturally with
existing templates and imports.

### New tags

- `<If test="expr">…</If>` — emits its body when `expr` is truthy.
- `<Choose>` / `<When test="expr">` / `<Otherwise>` — first-match branch.
  The body of the first `<When>` whose `test` is truthy is emitted; an
  optional `<Otherwise>` provides the default. At most one `<Otherwise>`
  per `<Choose>`.
- `<Foreach items="…" as="m" indexAs="i" firstAs="isFirst" lastAs="isLast">…</Foreach>`
  — repeats its body once per element of `items` (a JSON array, either
  inline or `"{ref}"` to a parent attribute). Each iteration produces an
  independent subtree; attribute mutations never leak between rows.

### Expression language

Both `test=` and `items=` (after placeholder substitution) accept the same
small grammar:

- Identifiers and dotted paths: `m`, `m.tone.shade`
- Literals: `"text"`, `'text'`, `42`, `3.14`, `true`, `false`, `null`
- Comparisons: `==`, `!=`, `<`, `<=`, `>`, `>=` (with `string ↔ number`
  coercion across `==`/`!=` so `m.size == 40` works whether `size` is a
  JSON number or a substituted string)
- Logical: `&&`, `||`, `!` (short-circuiting)
- Helpers: `empty(x)`, `not(x)`, `length(x)`
- Parens: `(expr)`

Intentionally absent: arithmetic, regex, indexing, string concat,
ternary. If a document needs that level of computation, it belongs in
build-time TypeScript that emits the XML, not in the markup.

### Composition

- Directives nest: `<If>` inside `<Foreach>`, `<Foreach>` inside `<Use>`,
  etc.
- Top-level `<Foreach>` with inline JSON works without a surrounding
  template.
- Imports run before template/control-flow expansion, so `<Foreach>` /
  `<If>` inside an imported `<Fragment>` work as well.
- The `MAX_TEMPLATE_NODES` budget (default 100,000) caps total expanded
  output; runaway iteration aborts cleanly with a
  `TEMPLATE_EXPANSION_LIMIT` diagnostic.

### Compatibility

No breaking change. Documents that don't use the new tags parse
identically. The five new tags appear in the generated XSD / JSON Schema
/ `reference.md` artefacts.
