---
title: landing — Reference
lang: en
kind: reference
app: landing
last_verified_commit: 0000000000000000000000000000000000000000
source_files:
  - apps/landing/package.json
  - apps/landing/build.mjs
  - apps/landing/serve.mjs
  - apps/landing/index.html
  - apps/landing/styles.css
  - apps/landing/view/
---

# landing — Reference

## App layout

```
apps/landing/
├── package.json
├── build.mjs              # static-site builder
├── serve.mjs              # local preview server
├── index.html             # entry HTML
├── styles.css             # global CSS
├── scripts/               # asset processors (image optimise, etc.)
├── view/                  # additional pages / partials
├── build/                 # intermediate build artefacts
├── dist/                  # deployable bundle
└── docs/en/{index,reference,guides}.md
```

## Build script (`build.mjs`)

- Reads `index.html` and any partials under `view/`.
- Inlines small CSS / SVG where possible.
- Copies static assets into `dist/`.
- Outputs to `dist/`.

No bundler dependency. The script is plain Node and runs against the
workspace `pnpm` install.

## Deployment target

GitHub Pages — repo `slideglance/slideglance`, branch `gh-pages`,
hosted at `https://slideglance.github.io/`. Deployment is via the
CI workflow `.github/workflows/ci-landing.yml` (when present) or a
manual push to the `gh-pages` branch.

## Commands

| Script | Purpose |
|---|---|
| `pnpm --filter @slideglance/landing build` | Build → `dist/` |
| `pnpm --filter @slideglance/landing preview` | Build + serve on a local port |
| `pnpm --filter @slideglance/landing fmt` | Prettier format |
| `pnpm --filter @slideglance/landing fmt:check` | Prettier check |
