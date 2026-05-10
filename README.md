<p align="center">
  <img src="assets/og-image.png" alt="SlideGlance — open .pptx files right in your browser" />
</p>

<h1 align="center">SlideGlance</h1>

Open and view PowerPoint `.pptx` files in your browser — no upload, no server, no Microsoft Office required.

> ### ⚠ Pre-release / development status. 
> SlideGlance is **not yet published** to the Chrome Web Store, npm, or crates.io. 
> 
> The repository currently only supports building from source. Every "Install" step
> in the table below that mentions a registry name is a placeholder
> for the eventual published artifact — for now, follow the
> [build-from-source](#build-from-source) path or the
> [Chrome extension build / install / run](#chrome-extension-build--install--run)
> walkthrough.

> ### ▶ Try it now in your browser
> the hosted web playground is live at **<https://slideglance.github.io/slideglance/>**.
>
> Drag any `.pptx` onto the page and it renders entirely in your tab;
> nothing uploads, no account, no install. The same Rust + WebAssembly
> core the desktop / Chrome / embedded surfaces use, exposed as a
> drag-and-drop SPA so you can evaluate fidelity against your own
> decks before committing to the build-from-source path.

SlideGlance converts PPTX decks to SVG / PNG with a Rust + WebAssembly
core and ships across four user-facing surfaces: a Chrome extension, a
hosted web playground, a desktop application, and an embeddable
JavaScript viewer.

| Surface                  | What you get                                                                | Install                                                                                              |
| ------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Chrome extension**     | Right-click a `.pptx` link → opens in a tab. No upload.                     | Build `apps/chrome-extension` and load unpacked, or install from the Chrome Web Store *(once published)*. |
| **Web playground**       | Drag-and-drop a `.pptx` into a browser tab. Useful for one-off viewing.     | Open <https://slideglance.github.io/slideglance/playground/> — no install required. Run locally with `pnpm --filter @slideglance/web-playground dev`. |
| **Desktop viewer**       | Native Tauri 2 app with menubar, drag-drop, recent files, element select.   | Run `pnpm tauri:dev` (development) or `pnpm tauri:build` (per-OS installer).                         |
| **Embeddable viewer**    | React component / `<pptx-viewer>` Web Component for your own app.           | `npm i @slideglance/viewer @slideglance/core`                                                        |
| **Native CLI**           | `slideglance convert / render / inspect` — batch SVG / PNG conversion.      | `cargo install slideglance` *(once published)* or build from source.                                 |
| **Rust library**         | `slideglance::convert_to_svg / convert_to_png` for Rust pipelines.          | `slideglance = "..."` once on crates.io, or path-dep on the workspace.                               |

---

## Screenshots

Captures from the Chrome extension surface — the React viewer
underneath is the same one the desktop app, web playground, and
embeddable component use.

| | |
| :---: | :---: |
| [![Empty state](apps/chrome-extension/store-assets/screenshots/01-empty-state.png)](apps/chrome-extension/store-assets/screenshots/01-empty-state.png) | [![Presentation viewer](apps/chrome-extension/store-assets/screenshots/04-presentation-viewer.png)](apps/chrome-extension/store-assets/screenshots/04-presentation-viewer.png) |
| **Empty state** — drag a `.pptx` or click *Open file*. Nothing leaves the tab. | **Presentation viewer** — thumbnails, ruler, slideshow, print, PDF export. |
| [![Grid view](apps/chrome-extension/store-assets/screenshots/06-grid-view.png)](apps/chrome-extension/store-assets/screenshots/06-grid-view.png) | [![Font mapping popover](apps/chrome-extension/store-assets/screenshots/05-font-mapping-popover.png)](apps/chrome-extension/store-assets/screenshots/05-font-mapping-popover.png) |
| **Grid view** for scanning large decks. | **Font mapping** popover surfaces every authored-font → installed-font substitution. |
| [![Settings — appearance and language](apps/chrome-extension/store-assets/screenshots/02-settings-appearance.png)](apps/chrome-extension/store-assets/screenshots/02-settings-appearance.png) | [![Settings — about](apps/chrome-extension/store-assets/screenshots/03-settings-about.png)](apps/chrome-extension/store-assets/screenshots/03-settings-about.png) |
| **Settings** — theme + 8 interface languages, ruler/units. | **About** — browser-only WebAssembly engine, offline-capable, MIT. |

> Sample deck used for the screenshots: [*Business Infographic
> Presentation*](https://www.slidescarnival.com/template/business-infographic-presentation/19319)
> by SlidesCarnival.

---

## Why use it

```mermaid
graph LR
    A[.pptx file] --> B(SlideGlance core)
    B --> C[SVG]
    B --> D[PNG]
    C --> E((Browser))
    C --> F((PDF / print))
    D --> G((Thumbnail))
    D --> H((Image pipeline))
    style B fill:#c43e1c,color:#fff,stroke:#a32d10
```

- **Local-first** — every file is parsed and rendered in your tab,
  process, or worker. No upload, no server roundtrip.
- **Deterministic** — same input + same fonts produces byte-identical
  SVG and pixel-identical PNG across machines.
- **Offline-capable** — once the WebAssembly bundle is loaded, the
  viewer needs zero network access.
- **Selectable text** by default — text-mode SVG keeps copy / search /
  accessibility; path-mode glyphs are available when you need
  resvg-rasterized PNG.
- **Wide PowerPoint coverage** — text wrap, theme inheritance, tables,
  charts, gradients, EMF-wrapped bitmaps, WordArt warps, transitions,
  notes, sections, and embedded fonts.

---

## Pick your path

### ▶ End user — open a `.pptx`

- **Chrome extension** is the fastest. Once installed, every direct
  `.pptx` URL opens in a SlideGlance tab; right-click any `.pptx` link
  to send it through the viewer. Authenticated sites work because
  cookies are forwarded.
- **Drag-and-drop** a local file onto the web playground or the
  desktop app's window — no upload happens, the file is read by the
  browser / app process directly.

### ▶ Integrator — embed the viewer in your app

```bash
npm i @slideglance/viewer @slideglance/core react react-dom
```

```tsx
import { PptxPresentation, createWorkerController } from "@slideglance/viewer";
import { useEffect, useState } from "react";

function App({ src }: { src: Uint8Array }) {
  const [controller, setController] = useState(null);
  useEffect(() => {
    void createWorkerController().then(setController);
  }, []);
  return <PptxPresentation controller={controller} src={src} />;
}
```

The viewer ships toolbar + thumbnails + notes + sections + search +
theme + print + PDF export. It off-loads parsing and rendering to a
Web Worker, so the main thread stays responsive on multi-hundred-slide
decks. See `packages/viewer/README.md` for full props.

`@slideglance/viewer` is a React component, but the bundle also
registers a `<pptx-viewer>` Web Component for vanilla / non-React
hosts.

### ▶ Backend developer — server-side conversion

```bash
npm i @slideglance/core    # Node.js / Deno / Bun (via WASM)
```

```ts
import init, { convertPptxToSvg } from "@slideglance/core/node";
const wasmBuffer = await init();   // one-shot
const svgs = await convertPptxToSvg(pptxBytes, /* options */);
```

For Rust pipelines:

```toml
[dependencies]
slideglance = "..."   # once published
```

```rust
use slideglance::{convert_to_svg, ConvertOptions};

let bytes = std::fs::read("deck.pptx")?;
let svgs = convert_to_svg(bytes, &ConvertOptions::default())?;
for (i, svg) in svgs.iter().enumerate() {
    std::fs::write(format!("slide-{i}.svg"), svg)?;
}
```

PNG conversion (`convert_to_png`) needs a `FontResolver`; see
[`docs/fonts.md`](docs/fonts.md) for guidance.

### ▶ CLI user — batch conversion from the shell

```bash
# Every slide → SVG
slideglance convert deck.pptx --output out/

# Slide range → PNG at 1600 px wide, with explicit font set
slideglance convert deck.pptx --output out/ --format png --width 1600 --range 1-10 \
    --font /System/Library/Fonts/AppleSDGothicNeo.ttc \
    --font ~/Library/Fonts/Pretendard-Regular.otf

# One slide
slideglance render deck.pptx --slide 3 --output slide-3.png --width 1920

# Inspect deck metadata
slideglance inspect deck.pptx
```

`slideglance --help` lists every subcommand and option. For decks
containing Korean / CJK text, pass the relevant TTF / OTF / TTC files
via `--font` (repeatable) so glyph rasterization is reproducible.

---

## Chrome extension build / install / run

The Chrome extension is the path most users actually want. Until the
Web Store listing goes live, you build it locally and load it as an
unpacked extension. Steps:

```bash
# 1. Install workspace dependencies (Node ≥ 18, pnpm ≥ 8)
corepack enable && pnpm install

# 2. Build the extension (compiles slideglance-wasm, then bundles
#    everything into apps/chrome-extension/dist/)
pnpm -F @slideglance/chrome-extension build
```

Then in your Chromium-based browser (Chrome / Edge / Brave / Arc):

1. Open `chrome://extensions`.
2. Toggle **Developer mode** in the top-right.
3. Click **Load unpacked** → select
   `apps/chrome-extension/dist/`.
4. Pin the SlideGlance icon in the toolbar (puzzle-piece menu).

To verify the install:

- Click the toolbar icon — an empty viewer tab opens. Drop a local
  `.pptx` or click *Open file* and pick one.
- Right-click any `.pptx` link on the web → **Open with
  SlideGlance** opens it in the same viewer tab.
- Visit any direct `.pptx` URL (e.g. open conference / course
  pages) — the extension auto-redirects the navigation to a viewer
  tab with the original URL preserved in the location hash.

For live-development reload (HMR-style watching):

```bash
pnpm -F @slideglance/chrome-extension dev
```

After code edits, click the reload icon on the extension card in
`chrome://extensions`. Service-worker / manifest changes occasionally
need a full extension toggle off-and-on.

For full per-flag detail and the Chrome Web Store packaging path
(`pnpm -F @slideglance/chrome-extension package`), see
[`apps/chrome-extension/README.md`](apps/chrome-extension/README.md).

---

## Architecture

```mermaid
graph TB
    subgraph User-facing surfaces
        CRX[Chrome extension]
        PG[Web playground]
        DV[Desktop viewer]
        EMB["Embed: React / Vue / Web Component"]
        CLI["Native CLI"]
    end

    subgraph JavaScript / npm
        VW["@slideglance/viewer"]
        CR["@slideglance/core"]
    end

    subgraph Rust workspace
        WASM[slideglance-wasm]
        UMB[slideglance]
        REND[slideglance-renderer]
        PNG[slideglance-png]
        FONT[slideglance-font]
        PRS[slideglance-parser]
        MOD[slideglance-model]
    end

    CRX --> VW
    PG --> VW
    DV --> VW
    EMB --> VW
    VW --> CR
    CR --> WASM
    CLI --> UMB
    WASM --> UMB
    UMB --> PNG
    UMB --> REND
    REND --> FONT
    REND --> MOD
    PRS --> MOD

    style WASM fill:#c43e1c,color:#fff,stroke:#a32d10
    style UMB fill:#c43e1c,color:#fff,stroke:#a32d10
    style CR fill:#6b7280,color:#fff,stroke:#4b5563
```

For the full layer breakdown, data flow, and crate / package
responsibilities, see [`docs/architecture.md`](docs/architecture.md).

---

## Documentation

| Document                                          | What it covers                                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [`docs/architecture.md`](docs/architecture.md) | High-level component diagram, data flow, layer responsibilities, where each technology (Rust / WASM / npm / Tauri) fits.      |
| [`docs/fonts.md`](docs/fonts.md) | Font pipeline reference: priority chain, path vs. text mode, per-environment behavior (CLI / library / wasm / viewer), troubleshooting. |
| [`apps/chrome-extension/README.md`](apps/chrome-extension/README.md) | Chrome-extension entry flows, install steps, privacy policy.                                                                  |
| [`packages/viewer/README.md`](packages/viewer/README.md)            | `<PptxPresentation>` props, slot conventions, custom themes.                                                                  |
| [`testing/vrt/snapshot/README.md`](testing/vrt/snapshot/README.md)  | Visual regression fixture / snapshot conventions.                                                                             |

---

## Build from source

For contributors only — end users can install via the channels listed
in the table at the top.

```bash
git clone https://github.com/SlideGlance/slideglance.git
cd slideglance
pnpm install
pnpm build             # full pipeline: cargo + 3 wasm targets + every JS package
pnpm --filter @slideglance/web-playground dev   # http://localhost:5173
```

Prerequisites: Rust ≥ 1.75, Node ≥ 18, `pnpm` ≥ 8, `wasm-pack`. See
[`docs/architecture.md#build-pipeline`](docs/architecture.md#build-pipeline)
for the staged build sequence and what each step produces.

After every change under `crates/`, the JS layer gets the new
WebAssembly automatically — every JS package's `prebuild` hook calls
`scripts/build-wasm.sh`, which short-circuits when nothing changed.

```bash
cargo test --workspace --release         # ~1,100 unit + integration tests
pnpm vrt                                 # visual regression on 5 fixtures
cargo clippy --workspace -- -D warnings  # lint gate
```

---

## License

MIT — see [`LICENSE-MIT`](LICENSE-MIT). Copyright (c) 2026 SimpleCORE
Inc. Lead developer: Taehwan Kwag (contact via the
[GitHub issue tracker](https://github.com/SlideGlance/slideglance/issues)).

The metric-compatible OSS fonts bundled with the renderer (Cousine,
Caladea, Carlito, Liberation, Source Han Sans subsets) ship under
SIL Open Font License 1.1 — see [`LICENSE-OFL-1.1`](LICENSE-OFL-1.1)
and [`NOTICE`](NOTICE).
