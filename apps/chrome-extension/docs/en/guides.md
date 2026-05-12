---
title: chrome-extension — Guides
lang: en
kind: guides
app: chrome-extension
last_verified_commit: 0000000000000000000000000000000000000000
source_files:
  - apps/chrome-extension/package.json
  - apps/chrome-extension/scripts/
---

# chrome-extension — Guides

## Load the extension during development

### Goal

Iterate on the viewer with hot reload.

### Steps

1. `pnpm --filter @slideglance/chrome-extension dev`
2. Open `chrome://extensions` in a Chromium browser.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select `apps/chrome-extension/dist`.
5. Pin the extension via the puzzle-piece menu so the toolbar icon
   stays visible.

### Expected result

The Vite dev server reloads the viewer on every source edit. The
service worker reloads on every manifest edit (chrome may need a
manual reload click).

## Build and package for the Chrome Web Store

### Goal

Produce the zip required for store submission.

### Steps

```sh
pnpm --filter @slideglance/chrome-extension package
# → apps/chrome-extension/slideglance-<version>.zip
```

### Expected result

Upload the zip via the Chrome Web Store dashboard. Privacy
practices declaration on the listing must reference the in-repo
`PRIVACY.md`.

## Update the icon assets

### Goal

Replace the rendered icon set after editing the master SVG.

### Steps

1. Edit `public/icon.svg`.
2. `pnpm --filter @slideglance/chrome-extension build` — the
   `render-icons.mjs` step rasterises the SVG into the various PNG
   sizes Chrome requires (16, 32, 48, 128).

### Expected result

`dist/icons/*.png` is regenerated; the loaded extension's toolbar
icon updates after a manual reload.
