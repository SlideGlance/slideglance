# Privacy Policy — SlideGlance PPTX Viewer (Chrome extension)

Effective date: 2026-05-06

## What data we collect

**None.**

The SlideGlance PPTX Viewer Chrome extension parses and renders PowerPoint
(`.pptx`) files entirely in your browser using WebAssembly. No file content, URL, or
usage telemetry is transmitted to any server operated by us or any third
party.

## How permissions are used

- **Host access (`<all_urls>`)** — used to (1) redirect navigations that end
  in `.pptx` to the in-browser viewer page, and (2) fetch the same URL from
  the viewer page with your cookies, so authenticated `.pptx` links continue
  to work. The fetched bytes are processed locally and never forwarded.
- **`declarativeNetRequest`** — registers the redirect rule. This API does
  not give the extension visibility into your browsing history.
- **`contextMenus`** — adds the right-click menu entry on `.pptx` links.

## Third-party services

None. The extension does not call analytics, error reporting, or any other
third-party endpoint.

## Contact

Issues: https://github.com/SlideGlance/slideglance/issues
