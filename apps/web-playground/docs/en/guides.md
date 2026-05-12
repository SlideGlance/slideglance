---
title: web-playground — Guides
lang: en
kind: guides
app: web-playground
last_verified_commit: 0000000000000000000000000000000000000000
source_files:
  - apps/web-playground/src/
---

# web-playground — Guides

## Run the playground against a local `@slideglance/core` build

### Goal

You are iterating on the WASM core and want the playground to pick
up local changes immediately.

### Steps

```sh
pnpm install
pnpm --filter @slideglance/web-playground dev
```

### Expected result

The `predev` step rebuilds `@slideglance/core` from the current Rust
sources. The Vite dev server serves the playground at the printed
URL. Edits to either the React source or the Rust source trigger
a rebuild.

## Reproduce a fidelity bug

### Goal

Confirm a fidelity issue someone reported, in a controlled
environment.

### Steps

1. Open the playground (locally or hosted).
2. Drag the reported `.pptx` onto the page.
3. Take a screenshot.
4. Compare against PowerPoint / Keynote / LibreOffice.
5. Open an issue with both screenshots and the `.pptx` (if
   shareable).

### Expected result

The issue contains the deck, both screenshots, and the
`navigator.userAgent` string from the playground UI.
