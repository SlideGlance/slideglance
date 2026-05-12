# @slideglance/landing

Static landing page for SlideGlance, hosted at <https://slideglance.github.io/slideglance/>. Pure HTML + CSS + a small Node build script — no framework, no bundler.

Part of the [SlideGlance](https://github.com/SlideGlance/slideglance) project. Private / not published.

## What it does

Renders the project's marketing page with an embedded iframe overlay
that loads the production web playground. The page's only build
dependency is Node — output is pure static files that GitHub Pages
serves directly.

## Build

```sh
pnpm --filter @slideglance/landing build
```

`build.mjs` stages `index.html`, `styles.css`, the SlideGlance icon,
and the Chrome Web Store screenshots into `dist/`. The Pages workflow
(`pages.yml`) then mirrors the production playground build into
`dist/playground/` so the overlay iframe on the landing page has
something to load.

## Local preview

```sh
pnpm --filter @slideglance/landing preview
```

Builds and serves on a local port via `serve.mjs`.

> Before previewing locally, run
> `pnpm --filter @slideglance/builder run codegen` once so
> `dist/build/reference/` is populated with the generated XML reference
> pages. CI deployment runs codegen before this build, so production
> previews are always up-to-date.

## License

MIT — see [LICENSE](./LICENSE).
