<div align="center">
  <img src="https://github.com/SlideGlance/slideglance/raw/main/apps/vscode-extension/icon.png" alt="SlideGlance PPTX Viewer" width="128" height="128" />

# SlideGlance PPTX Viewer

**A PPTX viewer and SlideGlance authoring workbench, in your editor.**

Part of the [SlideGlance](https://slideglance.github.io/slideglance/) project.

</div>

---

## Two tools in one extension

SlideGlance PPTX Viewer unifies two distinct workflows behind a single live-preview surface:

| Mode                  | Input                    | Use it when…                                                                                                         |
| --------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **★ PPTX viewer**     | `.pptx`                  | You want to open / browse a deck without launching PowerPoint or Keynote — directly inside VS Code, on any platform. |
| **★ Slide authoring** | `.sgx` (SlideGlance XML) | You want to author slides as code: diff-friendly, Git-tracked, and exportable to a real editable `.pptx`.            |

Both modes share the same renderer, so what you see in preview is what your recipient opens in PowerPoint.

<p align="center">
  <img src="https://raw.githubusercontent.com/SlideGlance/slideglance/main/apps/vscode-extension/docs/assets/two-tools-flow.png" alt="Open a .pptx or write and save a .sgx — both render in the live SlideGlance PPTX Viewer, which exports an editable .pptx for PowerPoint, Keynote, or Google Slides." width="720" />
</p>

---

## Requirements

- **VS Code 1.85.0 or newer.**
- **[Red Hat XML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-xml)** — declared as an extension dependency, so VS Code installs it automatically alongside this one. It powers `.sgx` schema validation and autocomplete from the bundled XSD. No other setup is required.
- **No account, no network.** Rendering and PPTX export run entirely on your machine via WebAssembly — nothing is uploaded.

---

## Screenshots

Captures from the SlideGlance Chrome extension surface — the React viewer underneath is the same one this VS Code extension's preview pane uses, so deck fidelity, font handling, and the renderer's pixel output are identical.

|                                                                                                                                                                                                                                                                                                                             |                                                                                                                                                                                                                                                                                                                 |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
|                    [![Empty state](https://raw.githubusercontent.com/SlideGlance/slideglance/main/apps/chrome-extension/store-assets/screenshots/01-empty-state.png)](https://raw.githubusercontent.com/SlideGlance/slideglance/main/apps/chrome-extension/store-assets/screenshots/01-empty-state.png)                     |  [![Presentation viewer](https://raw.githubusercontent.com/SlideGlance/slideglance/main/apps/chrome-extension/store-assets/screenshots/04-presentation-viewer.png)](https://raw.githubusercontent.com/SlideGlance/slideglance/main/apps/chrome-extension/store-assets/screenshots/04-presentation-viewer.png)   |
|                                                                                                                    **Empty state** — drag a `.pptx` or open one explicitly. Nothing leaves your machine.                                                                                                                    |                                                                                                                   **Presentation viewer** — thumbnails, ruler, slideshow, print, PDF export.                                                                                                                    |
|                       [![Grid view](https://raw.githubusercontent.com/SlideGlance/slideglance/main/apps/chrome-extension/store-assets/screenshots/06-grid-view.png)](https://raw.githubusercontent.com/SlideGlance/slideglance/main/apps/chrome-extension/store-assets/screenshots/06-grid-view.png)                        | [![Font mapping popover](https://raw.githubusercontent.com/SlideGlance/slideglance/main/apps/chrome-extension/store-assets/screenshots/05-font-mapping-popover.png)](https://raw.githubusercontent.com/SlideGlance/slideglance/main/apps/chrome-extension/store-assets/screenshots/05-font-mapping-popover.png) |
|                                                                                                                                           **Grid view** for scanning large decks.                                                                                                                                           |                                                                                                              **Font mapping** popover surfaces every authored-font → installed-font substitution.                                                                                                               |
| [![Settings — appearance and language](https://raw.githubusercontent.com/SlideGlance/slideglance/main/apps/chrome-extension/store-assets/screenshots/02-settings-appearance.png)](https://raw.githubusercontent.com/SlideGlance/slideglance/main/apps/chrome-extension/store-assets/screenshots/02-settings-appearance.png) |         [![Settings — about](https://raw.githubusercontent.com/SlideGlance/slideglance/main/apps/chrome-extension/store-assets/screenshots/03-settings-about.png)](https://raw.githubusercontent.com/SlideGlance/slideglance/main/apps/chrome-extension/store-assets/screenshots/03-settings-about.png)         |
|                                                                                                                                **Settings** — theme + 8 interface languages, ruler / units.                                                                                                                                 |                                                                                                                       **About** — browser-only WebAssembly engine, offline-capable, MIT.                                                                                                                        |

> Sample deck used for the screenshots: [_Business Infographic Presentation_](https://www.slidescarnival.com/template/business-infographic-presentation/19319) by SlidesCarnival.

---

## ◆ As a PPTX viewer

Open any `.pptx` file directly inside VS Code through a custom editor.

- Drag-and-drop a `.pptx` into the editor area, or right-click → **Open With…** → **SlideGlance PPTX Viewer**.
- Browse all slides in a paginated webview without leaving the IDE.
- Same rendering pipeline used to author slides — no surprises between preview and final file.
- Works on any platform VS Code supports (macOS, Windows, Linux) without requiring PowerPoint.

> The custom editor priority is `option`, so `.pptx` files still open in the OS default by default. Use **Open With…** to pick SlideGlance PPTX Viewer explicitly.

---

## ◆ As a slide authoring tool

Write decks declaratively in `.sgx` — a small XML grammar — and watch them re-render on save.

- **Live preview** — re-renders on save, with incremental keystroke updates that preserve unchanged slides.
- **Click → reveal source** — click any rendered element to jump the editor to the originating XML, including across `<Import>` boundaries.
- **PPTX export** — one command writes the current deck to a real editable `.pptx`.
- **Schema-aware editing** — the bundled XSD (namespace `urn:slideglance:builder:v1`) powers autocomplete and on-save validation via the [Red Hat XML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-xml).
- **Inline diagnostics** — parse and schema errors surface in the editor as you type.

### A minimal `.sgx` deck

```xml
<?xml version="1.0" encoding="UTF-8"?>
<SlideGlance xmlns="urn:slideglance:builder:v1">
  <Document size="16:9" fontFamily="Pretendard" />

  <Styles>
    <Style name="page"  padding="80" />
    <Style name="title" fontSize="44" bold="true" color="0F172A" />
    <Style name="body"  fontSize="20" color="1F2937" lineHeight="1.5" />
  </Styles>

  <Slide>
    <VStack class="page" gap="20" justifyContent="center" h="max">
      <Text class="title">A minimal SlideGlance deck.</Text>
      <Text class="body">One file, one slide, one style block.</Text>
    </VStack>
  </Slide>
</SlideGlance>
```

Save it as `hello.sgx`, open the preview, and export to `.pptx`.

---

## ★ Author slides with an LLM (recommended)

Writing `.sgx` by hand is fast — but writing it with an LLM that **already knows the grammar, layout rules, and gotchas** is dramatically faster. The SlideGlance project ships an **agent skill** specifically for that.

### What the skill contains

[`slideglance-pptx`](https://github.com/SlideGlance/slideglance/tree/main/skills/slideglance-pptx) packages everything an AI assistant needs to author `.sgx` decks competently:

- `SKILL.md` — when to trigger, scenario taxonomy (pitch deck / weekly report / tech sharing / lecture / …), and the authoring loop.
- `references/grammar.md` — the full `.sgx` element / attribute reference.
- `references/composition.md` — layout primitives (`VStack`, `HStack`, `Grid`, `Connector`, masters / templates / imports).
- `references/themes.md` — curated color palettes and font pairings.
- `references/recipes.md` — copy-paste slide patterns.
- `references/lint.md`, `references/schema-gotchas.md`, `references/limitations.md` — failure modes and how to avoid them.
- `examples/` — runnable `.sgx` decks.

### Installing the skill

The skill follows the Anthropic Agent Skill format (frontmatter + Markdown). Install it into whichever AI workbench you use:

**For Claude Code / Claude Desktop:**

```sh
# Clone (or already have) the slideglance repo
git clone https://github.com/SlideGlance/slideglance.git

# Symlink the skill into your Claude skills directory
ln -s "$PWD/slideglance/skills/slideglance-pptx" ~/.claude/skills/slideglance-pptx
```

Then in any Claude session inside this VS Code workspace, ask for a deck — the skill auto-activates on triggers like _"pitch deck"_, _"weekly report"_, _"슬라이드"_, _"발표자료"_, etc.

**For other AI assistants (Cursor, Copilot, Cline, …):**

The skill is plain Markdown — drop `SKILL.md` and `references/` into your assistant's custom-instructions / rules / context directory, or paste the relevant reference file when starting a deck.

### Example prompt

```
Build a 10-slide pitch deck about <topic> using the slideglance-pptx skill.
Confirm three things before scaffolding:
  1. audience and slide count
  2. tone (corporate / editorial / technical / minimal)
  3. theme variant (or pick the closest from references/themes.md)
```

The LLM writes `.sgx`, you save the file, SlideGlance PPTX Viewer previews it live, and you export `.pptx` when the deck looks right. Round-trip in minutes, not hours.

> Why this works: `.sgx` is small, declarative, deterministic, and lint-checked. LLMs are good at writing it; the live preview gives you immediate visual feedback; the XSD catches schema mistakes; the lint catches layout overflow before export.

---

## Commands

All commands appear in the Command Palette (`Cmd/Ctrl + Shift + P`). The first two also appear in the editor title bar when a `.sgx` file is active.

| Command                       | Title                        | Effect                              |
| ----------------------------- | ---------------------------- | ----------------------------------- |
| `slideBuilder.openPreview`    | SlideGlance: Open Preview    | Open or focus the live preview pane |
| `slideBuilder.refreshPreview` | SlideGlance: Refresh Preview | Force a full rebuild                |
| `slideBuilder.exportPptx`     | SlideGlance: Export PPTX     | Write the current deck to `.pptx`   |

---

## Homepage and reference documentation

- **Homepage** — [slideglance.github.io/slideglance](https://slideglance.github.io/slideglance/) — overview, live in-browser playground, and links into the rest of the project.
- **Source repository** — [github.com/SlideGlance/slideglance](https://github.com/SlideGlance/slideglance) — workspace root with every crate, package, and app.
- **`.sgx` grammar and authoring** — [`skills/slideglance-pptx/`](https://github.com/SlideGlance/slideglance/tree/main/skills/slideglance-pptx) — the same skill you can install for LLM-assisted authoring; reading it directly also works as a human-facing reference.
- **`@slideglance/builder` package** — [`packages/builder/`](https://github.com/SlideGlance/slideglance/tree/main/packages/builder) — the `.sgx` → `.pptx` compiler that powers the export command.
- **`@slideglance/viewer` package** — [`packages/viewer/`](https://github.com/SlideGlance/slideglance/tree/main/packages/viewer) — the React renderer powering this extension's preview.
- **Builder reference deck** — [`examples/builder-reference/`](https://github.com/SlideGlance/slideglance/tree/main/examples/builder-reference) — a full deck exercising every grammar feature; pair with `slideglance-pptx` to see real-world usage.

---

## License

MIT — see [LICENSE](https://github.com/SlideGlance/slideglance/blob/main/apps/vscode-extension/LICENSE).
