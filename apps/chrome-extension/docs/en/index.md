---
title: chrome-extension
lang: en
kind: index
app: chrome-extension
last_verified_commit: 93952eafcabba0eb4e38b1d79738462835c3e5c3
source_files:
  - apps/chrome-extension/package.json
  - apps/chrome-extension/manifest.config.ts
  - apps/chrome-extension/src/
---

# chrome-extension

> Part of the SlideGlance workspace.
> See also: [all apps](../../../../docs/en/apps.md) ·
> [distribution](../../../../docs/en/distribution.md).

## What it is

A Manifest V3 Chrome extension that intercepts `.pptx` URLs and
opens them in a dedicated viewer tab powered by
[`@slideglance/viewer`](../../../../packages/viewer/docs/en/index.md).
Nothing leaves the browser — the parse + render runs entirely
client-side via `@slideglance/core` WASM.

## Run it

```sh
pnpm --filter @slideglance/chrome-extension build
# load apps/chrome-extension/dist as an unpacked extension in chrome://extensions
```

Development with hot reload:

```sh
pnpm --filter @slideglance/chrome-extension dev
```

## When to use this

- You want PowerPoint links in the browser to open without download.
- You need a privacy-preserving viewer (everything is local).

## Where to go next

- [Reference](./reference.md) — manifest, content scripts, build
  artefacts
- [Guides](./guides.md) — packaging, testing, store submission
- Source: [`apps/chrome-extension/`](../../)
- Privacy: [`PRIVACY.md`](../../PRIVACY.md)
