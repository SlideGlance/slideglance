# Web Store Listing — SlideGlance

> Fill in `<TODO>` markers before submitting. Screenshot captures live
> in `screenshots/` and are referenced from this file in the order the
> Web Store presents them.

## Short description (≤132 chars)

Open .pptx presentations in your browser — fully local, no upload, no server.

## Detailed description

SlideGlance opens PowerPoint files (`.pptx`) directly in your browser.

- **Local-first.** Parsing and rendering use WebAssembly inside your tab.
  Files never leave your machine.
- **Four ways to open a file.** Click a `.pptx` link, right-click any
  `.pptx` link, click the toolbar icon, or drag-and-drop into an empty
  viewer tab.
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

<TODO: GitHub Pages URL or similar host of PRIVACY.md>

## Screenshots

Captured at 1280×800 (Web Store size). Upload in this order; the
caption text is what we recommend for the listing's screenshot
captions field.

Sample deck used for the captures: [_Business Infographic
Presentation_](https://www.slidescarnival.com/template/business-infographic-presentation/19319)
by SlidesCarnival.

| File                                                                                 | Caption                                                                                                                |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [`screenshots/01-empty-state.png`](screenshots/01-empty-state.png)                   | Drop a `.pptx` or click _Open file_ — the viewer is the same tab, no upload.                                           |
| [`screenshots/02-settings-appearance.png`](screenshots/02-settings-appearance.png)   | Theme + 8 interface languages (Auto / English / 한국어 / 日本語 / 简体中文 / 繁體中文 / Español / Français / Deutsch). |
| [`screenshots/03-settings-about.png`](screenshots/03-settings-about.png)             | Browser-only · offline-capable WebAssembly. MIT-licensed.                                                              |
| [`screenshots/04-presentation-viewer.png`](screenshots/04-presentation-viewer.png)   | Thumbnails, ruler, slideshow, print, and PDF export — all client-side.                                                 |
| [`screenshots/05-font-mapping-popover.png`](screenshots/05-font-mapping-popover.png) | Font fallback report shows exactly which authored typeface resolved to which installed face.                           |
| [`screenshots/06-grid-view.png`](screenshots/06-grid-view.png)                       | Grid view scans large decks at a glance.                                                                               |
