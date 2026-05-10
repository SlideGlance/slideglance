# @slideglance/landing

Static landing page for SlideGlance, hosted at
<https://slideglance.github.io/slideglance/>. Pure HTML + CSS + a small
Node build script — no framework, no bundler.

Part of the [SlideGlance](https://github.com/SlideGlance/slideglance)
project. Private / not published.

## Build

```sh
pnpm --filter @slideglance/landing build
```

`build.mjs` stages `index.html`, `styles.css`, the SlideGlance icon, and
the Chrome Web Store screenshots into `dist/`. The Pages workflow
(`pages.yml`) then mirrors the production playground build into
`dist/playground/` so the overlay iframe on the landing page has
something to load.

## Local preview

```sh
pnpm --filter @slideglance/landing preview
```

Builds and serves on a local port via `serve.mjs`.

## License

MIT — see [LICENSE](./LICENSE).
