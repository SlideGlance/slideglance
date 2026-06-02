# Web Store Listing — SlideGlance PPTX Viewer

> Screenshot captures live in `screenshots/` and are referenced from
> this file in the order the Web Store presents them.

## Short description (≤132 chars)

Open .pptx presentations in your browser — fully local, no upload, no server.

## Detailed description

SlideGlance PPTX Viewer opens PowerPoint files (`.pptx`) directly in your browser.

- **Local-first.** Parsing and rendering use WebAssembly inside your tab.
  Files never leave your machine.
- **Three ways to open a file.** Navigate to a `.pptx` URL (it opens in
  the viewer instead of downloading), right-click any `.pptx` link, or
  click the toolbar icon for an empty tab that accepts drag-and-drop or
  a file picker.
- **Authenticated sources.** Cookies are forwarded when fetching a `.pptx`
  URL, so SharePoint / Drive / intranet links work the same as in the
  original tab.
- **No tracking.** No analytics, no error reporting, no third-party calls.

## Single-purpose declaration

View `.pptx` (PowerPoint) presentations inside the browser without uploading
them to any server.

## Permission justifications

- **Host access (`<all_urls>`):** redirect direct `.pptx` URL navigations
  to the viewer, and fetch the same URL with the user's cookies for
  authenticated sites. All processing local.
- **`declarativeNetRequest`:** registers the redirect rule.
- **`contextMenus`:** adds the "Open with SlideGlance" right-click item.

## Privacy URL

https://github.com/SlideGlance/slideglance/blob/main/apps/chrome-extension/PRIVACY.md

> GitHub renders the in-repo `PRIVACY.md` as a public, stable URL — no
> separate hosting required. If the project later publishes a Pages
> site with a dedicated `/privacy` route, swap this URL there.

## Screenshots

The Chrome Web Store accepts **at most 5 screenshots**, each **1280×800**
(or 640×400). All six captures in the repo are 1280×800. Upload the five
listed in this table, in order; the caption text is what we recommend for
the listing's screenshot-captions field. (`05-font-mapping-popover.png` is
kept in the repo for the README gallery and demonstrates the font-fallback
feature, but is omitted from the upload — it uses a different sample deck,
and the font feature is already covered in the detailed description.)

The five upload captures use the bundled "Flow that ships itself" pitch
sample (`apps/web-playground/public/samples/01-pitch.pptx`, authored in
this repo — no third-party attribution needed). The gallery-only
font-mapping capture uses a [_Business Infographic
Presentation_](https://www.slidescarnival.com/template/business-infographic-presentation/19319)
template by SlidesCarnival.

| #   | File                                                                               | Caption                                                                                                                |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | [`screenshots/04-presentation-viewer.png`](screenshots/04-presentation-viewer.png) | Thumbnails, ruler, slideshow, print, and PDF export — all client-side.                                                 |
| 2   | [`screenshots/01-empty-state.png`](screenshots/01-empty-state.png)                 | Drop a `.pptx` or click _Open file_ — the viewer is the same tab, no upload.                                           |
| 3   | [`screenshots/06-grid-view.png`](screenshots/06-grid-view.png)                     | Grid view scans large decks at a glance.                                                                               |
| 4   | [`screenshots/02-settings-appearance.png`](screenshots/02-settings-appearance.png) | Theme + 8 interface languages (Auto / English / 한국어 / 日本語 / 简体中文 / 繁體中文 / Español / Français / Deutsch). |
| 5   | [`screenshots/03-settings-about.png`](screenshots/03-settings-about.png)           | Browser-only · offline-capable WebAssembly engine. MIT-licensed.                                                       |

## Promotional images

| File                                               | Size    | Status                      | Where it shows                           |
| -------------------------------------------------- | ------- | --------------------------- | ---------------------------------------- |
| [`promo-tile-440x280.png`](promo-tile-440x280.png) | 440×280 | Required (small promo tile) | Home, category pages, and search results |

The marquee promo tile (1400×560) is optional — extensions without one
are simply ranked after those that have it — so it is not included. The
tile is generated from [`promo-tile.svg`](promo-tile.svg) via
`node scripts/render-promo.mjs`.
