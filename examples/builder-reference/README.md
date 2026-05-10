# @slideglance/builder-reference-example

XML reference deck generated with [`@slideglance/builder`](../../packages/builder).
End-user-facing showcase + smoke test for the public builder API.

Part of the [SlideGlance](https://github.com/SlideGlance/slideglance)
project. Private / not published.

## What it does

Compiles `main.sgx` (a multi-chapter `.pptx`-equivalent XML document)
through `buildPptx` and writes the result to `output/`. The deck
exercises every node type the builder supports — text, lists, images,
tables, shapes, charts, layout primitives — so a regression in any
one surface lands as a visible diff in the rendered slides.

## Build

```sh
pnpm --filter @slideglance/builder-reference-example build
```

Reads `main.sgx`, resolves `<Import>` and `<Use>` references against
`templates/` / `chapters/` / `styles/`, and emits the compiled `.pptx`.

## License

MIT — see [LICENSE](./LICENSE).
