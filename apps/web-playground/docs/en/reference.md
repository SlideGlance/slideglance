---
title: web-playground — Reference
lang: en
kind: reference
app: web-playground
last_verified_commit: 0000000000000000000000000000000000000000
source_files:
  - apps/web-playground/package.json
  - apps/web-playground/vite.config.ts
  - apps/web-playground/index.html
  - apps/web-playground/src/
---

# web-playground — Reference

## App layout

```
apps/web-playground/
├── package.json
├── vite.config.ts
├── index.html
├── public/                # static assets, favicons
├── src/
│   ├── main.tsx           # React entry
│   ├── App.tsx
│   └── …
├── dist/                  # Vite output
└── docs/en/{index,reference,guides}.md
```

## Build artefacts

`pnpm --filter @slideglance/web-playground build` emits a `dist/`
directory that is published to GitHub Pages alongside the landing
site, at the `/playground/` path.

## Commands

| Script | Purpose |
|---|---|
| `pnpm --filter @slideglance/web-playground dev` | Vite dev server (HMR) |
| `pnpm --filter @slideglance/web-playground build` | Production build → `dist/` |
| `pnpm --filter @slideglance/web-playground preview` | Preview built bundle |
| `pnpm --filter @slideglance/web-playground typecheck` | `tsc --noEmit` |

`predev` and `prebuild` run `scripts/run-build-wasm.mjs` so the
underlying `@slideglance/core` WASM is rebuilt before bundling.

## Hosted URL

<https://slideglance.github.io/slideglance/playground/>

Deployment is via the workspace's GitHub Pages workflow.
