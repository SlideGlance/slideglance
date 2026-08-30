# Changelog

All notable changes to the **SlideGlance PPTX Viewer** extension are
documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-08-30

### Added

- **Render buttons in the toolbar and the right-click menu.** `Render
  page` rebuilds the deck and repaints the page you are on; `Render all`
  repaints every page and keeps your place. Both build even when the
  source has not changed — pressing Render says the screen and the
  source have drifted, and the hashes are what you are disputing.
- **Right-click copies.** On a shape, `Copy text` takes the text inside
  it and `Copy edit prompt` takes where it is written: deck, page, file
  and line range, and the chain of templates it was drawn through, so
  an LLM can be pointed at the markup rather than the `<Use>` that
  called it. On a thumbnail the prompt answers about that page.

### Fixed

- **A broken save no longer takes the deck away.** Problems dock over
  the last build that succeeded instead of replacing it, so the page
  you were reading, the zoom, and the slide cache survive while you fix
  the XML — and the preview comes back on its own when you do.
- **Files written by a build script rebuild the preview.** Only editor
  events were watched, so a deck whose masters or fragments are
  generated sat on the state from before the script ran.
- **Clicking a shape opens the right file.** Shape ids are renumbered on
  every parse, so adding an element to an early page left later pages
  showing ids that resolved to another chapter's markup.
- **Refresh keeps your place** instead of returning to page 1.

## [0.3.0] - 2026-08-29

### Added

- **`<SlideNumber count="numbered">` numbers only the pages that carry a
  folio.** A deck whose cover, contents or appendix show no page number
  used to print the slide's position in the deck on its first numbered
  page — 6, where the contents sent the reader to 1. The new mode counts
  the pages that show a folio, starting at `startAt` (default 1), and
  writes the result as text. `count="all"` stays the default and keeps
  PowerPoint's live `slidenum` field.

### Fixed

- **A deck whose page numbering does not start at 1 renders the numbers
  PowerPoint shows.** `<p:presentation firstSlideNum>` was never read, so
  the preview counted from 1 no matter what the deck declared.

## [0.2.0] - 2026-08-28

### Added

- **The preview says which pages it is rebuilding.** Thumbnails of the
  slides a save touches carry an in-flight marker until the build lands;
  a change to something deck-wide marks every page.
- **Refresh confirms it ran**, stamped with the time. A rebuild that
  produces identical output leaves the screen untouched, which until now
  was indistinguishable from a dead button.
- **Failures say whose fault they are.** A parse failure lists one row
  per problem and each row opens that file at that line; anything else
  states plainly that the document is not at fault. Long lists collapse
  past 30 entries.

### Changed

- **A rebuild only re-measures the slides that changed.** Laying slides
  out is where a build spends nearly all of its time, so a one-word edit
  in a twenty-page deck went from re-measuring twenty pages to one.
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

[0.2.0]: https://github.com/SlideGlance/slideglance/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/SlideGlance/slideglance/releases/tag/v0.1.3
