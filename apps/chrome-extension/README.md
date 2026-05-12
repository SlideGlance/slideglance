# @slideglance/chrome-extension

Chrome extension that opens `.pptx` files in your browser using [`@slideglance/viewer`](../../packages/viewer). All parsing and rendering happen locally — no upload, no server.

Part of the [SlideGlance](https://github.com/SlideGlance/slideglance) project — to be published to the Chrome Web Store.

## What it does

Adds three entry points to Chromium-based browsers:

1. **URL intercept** — visiting any direct `.pptx` URL automatically opens it in the viewer.
2. **Right-click** — `.pptx` link → "Open with SlideGlance".
3. **Toolbar icon** — empty viewer tab that accepts a drag-dropped or `Open file…` selection.

The viewer is the same React shell the desktop app, web playground, embeddable component, and VS Code extension preview use. All processing stays in the tab.

## Screenshots

|                                                                                                                 |                                                                                                       |
| :-------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------: |
|                ![Empty state with Open file button](store-assets/screenshots/01-empty-state.png)                | ![Presentation viewer with thumbnails and ruler](store-assets/screenshots/04-presentation-viewer.png) |
|                           Drop a `.pptx` or pick from disk — nothing leaves the tab.                            |                Slide stage + thumbnail rail + ruler + slideshow / print / PDF export.                 |
|                      ![Grid view of all slides](store-assets/screenshots/06-grid-view.png)                      |             ![Font mapping popover](store-assets/screenshots/05-font-mapping-popover.png)             |
|                                 Grid view for scanning large decks at a glance.                                 |         Font fallback report shows which authored typeface resolved to which installed face.          |
|               ![Settings — theme + language](store-assets/screenshots/02-settings-appearance.png)               |                  ![Settings — about](store-assets/screenshots/03-settings-about.png)                  |
| Theme + 8 interface languages (English / 한국어 / 日本語 / 简体中文 / 繁體中文 / Español / Français / Deutsch). |                       Browser-only, offline-capable WebAssembly. MIT-licensed.                        |

> Sample deck used for the screenshots: [_Business Infographic Presentation_](https://www.slidescarnival.com/template/business-infographic-presentation/19319) by SlidesCarnival.

## Prerequisites

- Node ≥ 22 with `pnpm` ≥ 10 (`corepack enable` is the easiest way).
- Rust ≥ 1.88 with `wasm-pack` (the prebuild compiles `slideglance-wasm` before Vite picks it up).
- Chrome / Chromium / Edge / Brave — any Chromium-based browser with Manifest V3 support (Chrome 120+).

## Build

From the **workspace root** (`/Users/.../slideglance`):

```sh
pnpm install
pnpm -F @slideglance/chrome-extension build
```

The build runs the workspace's `prebuild` (compiles `slideglance-wasm`
via `wasm-pack`, syncs versions across every package), then Vite emits
the unpacked extension into `apps/chrome-extension/dist/`.

For a Chrome Web Store upload zip:

```sh
pnpm -F @slideglance/chrome-extension package
# writes apps/chrome-extension/slideglance-<version>.zip
```

## Install (load unpacked into Chrome)

1. Open `chrome://extensions` in your browser.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and pick `apps/chrome-extension/dist/`.
4. The SlideGlance icon appears in the toolbar — pin it for quick access via the puzzle-piece menu.

> **Updating after a code change** — re-run the build, then click the reload icon on the extension card. Service-worker / manifest changes occasionally require a full extension toggle off-and-on.

## Develop (live reload)

```sh
pnpm -F @slideglance/chrome-extension dev
```

The dev server watches the source tree and rebuilds `dist/` in place.
Combined with the loaded-unpacked install above, this gives HMR for
content scripts and the React UI; service-worker / manifest changes
still require a `chrome://extensions` reload.

## Verify it works

1. Click the toolbar icon — an empty viewer tab opens with the "Open file" prompt.
2. Drag any local `.pptx` onto the empty state, or click _Open file_. Slides should render with the toolbar / thumbnails / ruler.
3. Visit any direct `.pptx` URL (an academic course page or open conference site). The extension intercepts the navigation and re-opens it in the viewer.
4. Right-click a `.pptx` link → **Open with SlideGlance**.
5. Open Settings (gear icon, top-right of the empty state) and toggle the language / theme — the UI re-renders without reload.

## Permissions

| Permission              | Why                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `<all_urls>` host       | Redirect any direct `.pptx` URL to the viewer; fetch the same URL with the user's cookies for authenticated sites. All processing local. |
| `declarativeNetRequest` | Dynamic redirect rule, registered on install.                                                                                            |
| `contextMenus`          | Adds the "Open with SlideGlance" right-click item.                                                                                       |

## Privacy

See [PRIVACY.md](./PRIVACY.md). Short version: no data leaves your browser.

## License

MIT — see [LICENSE](./LICENSE).
