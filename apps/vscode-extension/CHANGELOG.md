# Changelog

All notable changes to the **SlideGlance PPTX Viewer** extension are
documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **A slow preview render is reported, not abandoned.** The render
  deadline used to surface as an error and discard the build; the build
  itself kept running, so a large deck or a loaded machine spent the CPU
  and showed nothing. The preview now keeps the deck and its diagnostics
  on screen, shows a corner badge while the build runs, and delivers the
  result when it finishes. `slideglance.preview.slowRenderNoticeMs`
  (default 15 s, `0` to hide) sets when the badge appears.
- **One preview build runs at a time.** Edits arriving during a build
  collapse into a single rebuild that starts when it ends, instead of
  starting builds that compete for the extension host's one thread.
- **The extension starts as soon as a `.sgx` file is opened.** It
  activates on `onLanguage:xml` rather than after a `workspaceContains`
  glob search, and `redhat.vscode-xml` is no longer an
  `extensionDependencies` entry — VS Code held activation until that
  extension's Java probe and language-server boot had finished. It is
  offered as a one-time install instead, and only `.sgx` schema
  validation depends on it.
- **The `.sgx` title-bar buttons no longer wait for activation.** Their
  menu condition now also matches the built-in `resourceExtname` context
  key.

### Fixed

- Go-to-definition no longer re-reads every `.sgx` / `.xml` in the
  workspace on each keystroke. The name index is cached per file, so an
  edit re-reads one file and only a create or delete rescans the
  workspace. That scan shared a thread with the preview build.
- The render deadline's timer is cleared when a build settles instead of
  being left to expire on its own.

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

[Unreleased]: https://github.com/SlideGlance/slideglance/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/SlideGlance/slideglance/releases/tag/v0.1.3
