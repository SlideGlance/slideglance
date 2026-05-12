---
title: web-playground
lang: en
kind: index
app: web-playground
last_verified_commit: 0000000000000000000000000000000000000000
source_files:
  - apps/web-playground/package.json
  - apps/web-playground/src/
---

# web-playground

> Part of the SlideGlance workspace.
> See also: [all apps](../../../../docs/en/apps.md).

## What it is

A drag-and-drop single-page app for evaluating SlideGlance against
arbitrary `.pptx` decks. Hosted at
<https://slideglance.github.io/slideglance/playground/>. Useful for
fidelity bug reports — drop the deck, screenshot the result, file
the issue.

## Run it

```sh
pnpm --filter @slideglance/web-playground dev      # local dev server
pnpm --filter @slideglance/web-playground build    # production build → dist/
```

## When to use this

- Evaluating a deck without installing anything.
- Diagnosing a fidelity issue (compare the screenshot to PowerPoint).
- Smoke-testing a new `@slideglance/core` build during development.

## Where to go next

- [Reference](./reference.md)
- [Guides](./guides.md)
- Source: [`apps/web-playground/`](../../)
