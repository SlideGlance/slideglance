# Changelog

All notable changes to the **SlideGlance PPTX Viewer** extension are
documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] - 2026-05-15

Initial public release.

### Added

- **`.pptx` viewer** — open and browse PowerPoint decks in a custom
  editor inside VS Code, on any platform, without PowerPoint. Right-click
  a `.pptx` → **Open With…** → **SlideGlance PPTX Viewer**.
- **`.sgx` live preview** — render SlideGlance XML decks in a webview
  that re-renders on save, with incremental keystroke updates that
  preserve unchanged slides.
- **Click → reveal source** — click any rendered slide element to jump
  the editor to the originating XML, including across `<Import>`
  boundaries.
- **Export PPTX** — one command writes the current `.sgx` deck to a real
  editable `.pptx`.
- **Schema-aware editing** — bundles the builder XSD
  (`urn:slideglance:builder:v1`) and registers it with the
  [Red Hat XML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-xml)
  for `.sgx` autocomplete and on-save validation.

### Fixed

- The extension icon now renders correctly in the README on the
  Marketplace listing.

[0.1.3]: https://github.com/SlideGlance/slideglance/releases/tag/v0.1.3
