---
title: landing
lang: en
kind: index
app: landing
last_verified_commit: 0000000000000000000000000000000000000000
source_files:
  - apps/landing/package.json
  - apps/landing/build.mjs
  - apps/landing/index.html
---

# landing

> Part of the SlideGlance workspace.
> See also: [all apps](../../../../docs/en/apps.md).

## What it is

The static marketing site at `slideglance.github.io`. Plain HTML +
CSS — no React, no bundler. Built by a small Node script
(`build.mjs`) into `dist/`.

## Run it

```sh
pnpm --filter @slideglance/landing build       # build → dist/
pnpm --filter @slideglance/landing preview     # build + local server
```

## When to use this

- Editing public-facing copy on the marketing site.
- Releasing a new design across the home page.

## Where to go next

- [Reference](./reference.md) — file layout, build script,
  deployment target
- [Guides](./guides.md) — editing copy, swapping screenshots,
  publishing
- Source: [`apps/landing/`](../../)
