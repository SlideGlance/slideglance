---
title: landing — Guides
lang: en
kind: guides
app: landing
last_verified_commit: 0000000000000000000000000000000000000000
source_files:
  - apps/landing/build.mjs
  - apps/landing/index.html
  - apps/landing/styles.css
---

# landing — Guides

## Edit a section of the home page

### Goal

Change the copy of an existing section without breaking the build.

### Steps

1. Edit the markup in `apps/landing/index.html` (or the relevant
   partial under `apps/landing/view/`).
2. Run `pnpm --filter @slideglance/landing preview` to start the
   local server.
3. Visit the displayed URL and verify the change.
4. Commit the edit.

### Expected result

The dev server reloads on edits; the build emits an updated
`dist/index.html` containing the new copy.

## Replace a screenshot

### Goal

Refresh one of the screenshots used on the page.

### Steps

1. Drop the new PNG into the matching `assets/` directory.
2. If `scripts/` includes an image-optimisation step, run the build
   — the script will compress and emit responsive variants.
3. Update the `<img srcset>` attribute in `index.html` to point at
   the new filename.

### Expected result

`pnpm --filter @slideglance/landing build` succeeds; the updated
image appears in `dist/` and is referenced by the built HTML.

## Publish a new release

### Goal

Deploy the current `main` to `slideglance.github.io`.

### Steps

1. Ensure CI is green on `main`.
2. Trigger the deploy workflow (or push to the `gh-pages` branch
   per the CI configuration).
3. Wait ~1 minute for GitHub Pages to pick up the new commit.
4. Verify <https://slideglance.github.io/>.

### Expected result

The marketing site reflects the new commit's content.
