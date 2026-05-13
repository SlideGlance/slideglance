---
name: slideglance-pptx
description: Author editable PowerPoint decks (.pptx) declaratively from a small XML grammar (.sgx). Use when the user asks for a presentation, ppt, slides, deck, keynote, pitch, weekly report, tech sharing, lecture deck, or any multi-slide artifact intended for offline review, sharing, or further editing in PowerPoint / Keynote / Google Slides. The build pipeline runs locally (no upload, no SaaS), the output is a real editable .pptx (not screenshot images), and layout decisions use OpenType-aware text measurement so the rendered file wraps the way PowerPoint would.
triggers:
  - "ppt"
  - "pptx"
  - "slides"
  - "deck"
  - "presentation"
  - "keynote"
  - "pitch deck"
  - "weekly report"
  - "tech sharing"
  - "investor deck"
  - "lecture slides"
  - "프레젠테이션"
  - "슬라이드"
  - "발표자료"
  - "powerpoint"
example_prompt: "Build a 10-slide pitch deck about <topic>. Use slideglance-pptx. Before I scaffold, confirm three things: (1) audience and slide count, (2) tone (corporate / editorial / technical / minimal), (3) whether you want a theme variant skill on top — I'll point you at the closest one."
---

# slideglance-pptx — declarative .pptx authoring

Author **editable PowerPoint files** by writing a small XML grammar called
`.sgx`. The build pipeline (`@slideglance/builder`) compiles the XML to a
real `.pptx` that opens in PowerPoint / Keynote / Google Slides and stays
fully editable by the recipient.

This skill covers the **slideglance authoring surface only** —
grammar, layout primitives, masters, styles, templates, control flow,
speaker notes, and the lint-driven feedback loop. Design / theme /
scenario picks (concrete color palettes, font pairings, slide
compositions) are out of scope here — the [`references/themes.md`](references/themes.md)
file collects reference palettes and font pairings; pick one and apply
it via `<Styles>`.

## Attribution

This skill's structure, scenario taxonomy (pitch-deck / weekly-report /
tech-sharing / xhs-post / course-module / presenter-mode-reveal / …),
and the reference palettes in
[`references/themes.md`](references/themes.md) are **informed by an
upstream HTML-based presentation skill suite** and re-imagined for the
slideglance medium. The original works:

| Upstream                                                                                            | License        | Coverage                                                                                                                |
| --------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill)                           | MIT            | Master skill structure, scenario full-decks, themes, layouts, presenter / authoring rules                               |
| [`zarazhangrui/beautiful-html-templates`](https://github.com/zarazhangrui/beautiful-html-templates) | (see upstream) | Editorial template family (cobalt-grid, coral, vellum, mat, broadside, …) — informed the palette / typography reference |
| [`Leonxlnx/taste-skill`](https://github.com/Leonxlnx/taste-skill)                                   | (see upstream) | Brutalist / editorial "taste" recipes                                                                                   |

Citations point straight at the original authors — not at any
intermediate curation layer.

## Why slideglance vs. an HTML deck

The upstream skills produce **static HTML/CSS/JS** decks for browser
presentation. slideglance produces **`.pptx` files**. These media solve
different problems:

| Medium                  | Strength                                                                                                                  | Cost                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML deck               | Pixel-perfect CSS, live animations, presenter window, web-shareable                                                       | Recipients can't edit in PowerPoint, can't email as `.pptx`, no Keynote / Google Slides import                                                             |
| **slideglance (.pptx)** | Editable by anyone, lands in existing review workflows, prints / exports to PDF, plays in PowerPoint's own presenter mode | No CSS keyframe / canvas-FX animations, no custom JS runtime, color tokens are 6-digit hex (no `accent1` theme tokens), no drop-cap text-flow-around-shape |

Pick slideglance when the **artifact must be a .pptx**. If the user
wants a web-shareable interactive deck, point them at the upstream HTML
skill instead.

## When to use this skill

Triggers: any request for a presentation / ppt / slides / deck /
keynote / pitch / weekly report / tech sharing / lecture deck — **when
the deliverable should be a real editable `.pptx` file**, not an HTML
artifact.

Counter-triggers (do NOT use slideglance):

- "I want a web-shareable interactive presentation with animations" → use the upstream html-ppt skill family
- "I need a Google Slides file specifically" → slideglance produces `.pptx`; Google Slides will import it but lossily
- "I want canvas-FX particle effects on slide entry" → not in the slideglance medium

## Before you author anything — confirm three things

**Do not start writing slides until you understand:**

1. **Content & audience.** Topic, slide count, who is watching (execs / engineers / investors / students / general)?
2. **Tone / theme.** Corporate / editorial / minimal / brutalist / pastel / cyber / academic? Pick a reference palette + font pairing from [`references/themes.md`](references/themes.md) — _Corporate clean_, _Dark technical_, _Editorial cream_, _Macaron pastel_, _Brutalist_, _Safety / alert_, _Academic / blueprint_, _Coral / warm_, or _Monochrome_.
3. **Starting point.** Use [`examples/two-column.sgx`](examples/two-column.sgx) as the structural scaffold; replace content + swap the `<Styles>` block with the palette from step 2.

A good opening message:

> I can build this `.pptx` for you. Before I scaffold, three quick
> confirmations:
>
> 1. Topic / target slide count / audience?
> 2. Tone — clean corporate, magazine-soft editorial, technical dark,
>    pastel lifestyle, brutalist poster? Pick from
>    [`references/themes.md`](references/themes.md).
> 3. Want me to start from the two-column structural scaffold and
>    drop a palette on top, or hand-author from scratch?

Only after those are clear should you scaffold.

## The grammar in 60 seconds

```xml
<?xml version="1.0" encoding="UTF-8"?>
<SlideGlance xmlns="urn:slideglance:builder:v1">
  <Document size="16:9" defaultMaster="CORP" fontFamily="Pretendard" />

  <Master name="CORP" backgroundColor="F8FAFC">
    <MasterRect x="0" y="0" w="1280" h="48" fill.color="0F172A" />
    <MasterText x="48" y="14" w="400" h="24" text="ACME Corp" color="FFFFFF" fontSize="14" />
    <SlideNumber x="1180" y="690" w="60" h="20" fontSize="10" color="64748B" />
  </Master>

  <Styles>
    <Style name="page" padding="80" padding.top="120" />
    <Style name="title" fontSize="40" bold="true" color="0F172A" />
    <Style name="muted" fontSize="18" color="64748B" />
  </Styles>

  <Slide>
    <VStack class="page" gap="12">
      <Text class="title">Q4 Highlights</Text>
      <Text class="muted">Three things that mattered.</Text>
    </VStack>
    <Notes>Open with the why before the numbers. The audience has seen the dashboards.</Notes>
  </Slide>
</SlideGlance>
```

- **Root**: `<SlideGlance>`. Always one.
- **Document** sets slide size, default master, default font.
- **Master** is reusable backdrop chrome (header / footer / page numbers).
- **Styles** are named attribute presets (`class="title"`).
- **Slide** accepts exactly one root child, almost always `<VStack>`, `<HStack>`, or `<Layer>`.
- **Notes** is the speaker-notes drawer. Audience never sees it.

For the full attribute table and visual node reference, see
[`references/grammar.md`](references/grammar.md).

## Core authoring principles

These five principles apply to **every** slideglance deck. The master
skill enforces them in its grammar and lint catalog.

### 1 — Reusability first: split into files and import

When the deck reaches **2+ slides**, the default starting structure is
a multi-file layout, not one giant `.sgx`. Lift `<Styles>`, `<Templates>`,
`<Master>`, and each `<Slide>` into separate files and `<Import>` them
from a small `main.sgx`. This is not "for large decks only" — small decks
benefit from the discipline because the next deck reuses the parts.

```
deck/
├── main.sgx              # <SlideGlance>, <Document>, imports
├── _styles.xml           # <Fragment> with <Styles>
├── _templates.xml        # <Fragment> with <Templates>
├── _master.xml           # <Fragment> with <Master>
└── slides/
    ├── _01-cover.xml
    ├── _02-summary.xml
    └── _03-deep-dive.xml
```

A single-file `.sgx` is acceptable **only** for a true one-slide deck
or a quick sketch. Anything else: split.

### 2 — Master slides over per-slide chrome

Every deck declares at least one `<Master>` and uses `defaultMaster=`
on `<Document>`. Header bars, footer text, page numbers, watermarks,
brand chrome — **always** live in `<Master>`, never repeated on every
`<Slide>`. Multiple masters (LIGHT / DARK / COVER / SECTION) are
cheap; declare them when the deck has chapter dividers.

If the deck inherits from a corporate template, pass that template's
bytes as `masterPptx` to `buildPptx` — the builder extracts the
template's background and uses it. Don't re-implement corporate chrome
inline.

### 3 — Styles + Templates: name everything that repeats

- **`<Styles>`** for any color / size / padding that appears in 2+ places.
  Per-node literal attributes are acceptable for genuine one-offs; the
  lint rule `HARDCODED_COLOR` warns when a literal hex appears in 4+ places.
- **`<Templates>` + `<Use>`** for any subtree pattern that appears in 2+
  places — cards, timeline rows, KPI tiles, agenda items, section
  dividers. Pair with `<Foreach>` when iterating over data.
- **`<Slot>`** when a template needs paragraph-length or multi-element
  content; placeholder substitution is for short attribute values only.

### 4 — Let layout do the work: no hardcoded sizes or positions

Hardcoded `x` / `y` / `w` / `h` is the **last resort**, not the first move.

Preferred, in order:

1. **Flex containers** — `<VStack>` / `<HStack>` with `gap`, `padding`,
   `alignItems`, `justifyContent`. Children size themselves to content.
2. **Flex sizing primitives** — `w="50%"`, `flexGrow="1"`, `w="max"`.
   Percentages and grow-shares scale with the container.
3. **`<Master>` margins** — `<Master margin="48" margin.top="120">` defines
   the slide's content area inset; slide bodies render inside it.
4. **`<Layer>` with `x` / `y`** — only when you genuinely need overlapping
   elements at arbitrary positions: diagrams, infographics, freely composed
   scenes. Pixel-perfect numeric layout is acceptable here because the
   composition has no natural flow.

Anti-patterns:

- Fixed pixel widths (`w="240"`) on every column instead of `w="50%"` /
  `flexGrow`.
- Repeated `<Shape x="…" y="…">` rows that should be a `<Foreach>`.
- `<Layer>` used to "fix" a layout that Flex would handle.

### 5 — Trust autofit, then promote to a real overflow fix

Build with autofit enabled (default). If the deck overflows, the
builder shrinks in this order: row heights → font sizes → gaps /
padding → uniform scale down to 0.5×. Treat the resulting auto-fit
diagnostic (`AUTOFIT_OVERFLOW`) as a signal to **edit the source**, not
to disable autofit. Split the slide, trim the content, or promote a
single-column layout to two columns.

Disable autofit (`autoFit: false`) only when pixel-exact reproducibility
matters more than fit — typically for printable handouts where the
page count is fixed.

## Other authoring rules

1. **Start from `examples/two-column.sgx`, not blank.** It's the
   minimal scaffold with `<Master>` chrome + `<Styles>` palette +
   `<Templates>` macro patterns already wired up. Replace content,
   swap the palette block from
   [`references/themes.md`](references/themes.md), keep the file split.
2. **Speaker notes go in `<Notes>`, never on the slide.** Audience-facing
   slides contain only audience-facing content (titles, body, data,
   images). Anything that starts with "as you can see" / "what I want to
   highlight" / "during the demo I'll show" belongs in `<Notes>`.
3. **Run the linter.** Build with `lint: { enabled: true, ruleset: "recommended" }`
   and treat warnings as bugs. The lint catalog catches overflow, baseline
   misalignment, low contrast, and design-system regressions before they
   become "why does this look broken" review cycles.
4. **Colors are 6-digit hex without `#`.** `color="0F172A"`. No
   `#0F172A`, no `accent1`. PPTX theme tokens are not supported — this
   trade-off keeps output deterministic across editors.
5. **Run on real fonts.** `Pretendard` (Korean + Latin) and `Noto Sans JP`
   (Japanese) are bundled and measured exactly. Anything else uses a
   heuristic measurer — the deck will still render in PowerPoint with the
   recipient's installed font, but layout drift is possible. For pixel-
   exact decks, stick to the two bundled families or pin custom fonts via
   `<Master>` font embedding.
6. **Line breaks inside `<Text>` — `\n` or a stack, not `<Br>`.** Source
   newlines and indentation inside a `<Text>` body collapse to a single
   space. Same-line whitespace is preserved, and leading / trailing
   whitespace is trimmed. To force a deliberate break, use either a
   `\n` literal in the body (`<Text>line 1\nline 2</Text>` — escapes
   decode after the collapse so `\n` / `\t` / `\\` survive in body
   text) or a stack of single-line `<Text>` inside a `<VStack gap="0">`
   when each line needs its own style. `<Br>` is **not** in the
   grammar; authoring `<Br/>` is silently dropped. See
   [`references/grammar.md`](references/grammar.md) §"Multi-line
   headlines and line breaks" and
   [`references/schema-gotchas.md`](references/schema-gotchas.md).

## Build pipeline

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { buildPptx } from "@slideglance/builder";

const xml = readFileSync("./deck.sgx", "utf8");

const { pptx, diagnostics } = await buildPptx(
  xml,
  { w: 1280, h: 720 },
  {
    textMeasurement: "auto",
    resolveImport: (src, fromPath) => {
      const baseDir = fromPath ? path.dirname(fromPath) : process.cwd();
      const absolute = path.resolve(baseDir, src);
      return { content: readFileSync(absolute, "utf8"), path: absolute };
    },
    sourcePath: "./deck.sgx",
    equalize: true,
    lint: { enabled: true, ruleset: "recommended" },
  },
);

if (diagnostics.length > 0) {
  for (const d of diagnostics) {
    console.warn(
      `${d.severity ?? "info"} ${d.code}: ${d.message} @ ${d.path ?? "?"}`,
    );
  }
}

const bytes = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
writeFileSync("./deck.pptx", bytes);
```

## Post-write workflow — author → lint → render → review

The contract is: **a deck is not authored until you have a green PNG
in your hand**. The structural file count is not evidence.

```
┌─────────────┐   ┌──────────────┐   ┌─────────────┐   ┌──────────┐
│  Edit .sgx  │ → │  buildPptx + │ → │   render    │ → │  visual  │
│             │   │     lint     │   │   to PNG    │   │  review  │
└─────────────┘   └──────────────┘   └─────────────┘   └──────────┘
                       ↓ errors?           ↓ wrong?         ↓ wrong?
                       └──── back to .sgx ─┘                │
                                                            │
                              ↑─────────────────────────────┘
```

Treat **every** diagnostic as a bug. `lint.ruleset = "recommended"`
includes `error` + `warn`; `"strict"` adds `info`. The lint catalog
(see [`lint.md`](./lint.md)) catches overflow, baseline misalignment,
low contrast, font-family drift, and hardcoded-color repetition before
they become "why does this look broken" review cycles.

### Rendering to PNG for visual review

Build the `.pptx` (see the build pipeline above), then use the native
`slideglance` CLI to render every slide to PNG:

```sh
slideglance convert deck.pptx --output ./out --format png --width 1280
```

For accurate font metrics (especially CJK), pass system font files via
`--font /path/to/font.ttf`. Without that, the CLI substitutes whatever
system fonts the deck's named families resolve to — what you see in
the PNG is not what a PowerPoint recipient with the proper fonts
installed will see.

When working interactively, the **Slide Builder** VS Code extension
shows the same SVG render the CLI emits, refreshed on save.

### When the deck doesn't compile

Common reasons (`ParseXmlError: XML validation failed`):

| Error                                                | See                                                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Unknown attribute "letterSpacing"` etc.             | [`schema-gotchas.md`](./schema-gotchas.md) — attributes the docs claim exist but the runtime doesn't accept |
| `Did you mean "padding"?` (you wrote `paddingTop`)   | dot notation: `padding.top="…"`                                                                             |
| `readTagExp returned undefined`                      | `<Foreach items='…'>` JSON contains an unescaped `'` — use `&apos;` or rewrite the prose                    |
| `<Master>.<SlideNumber>: Unknown attribute "format"` | SlideNumber accepts only x/y/w/h/fontSize/fontFamily/color — see schema-gotchas                             |
| `Unknown attribute "x1"` on `<MasterLine>`           | endpoint-pair form not supported — use positioned-rect (`x, y, w, h, line.color, line.width`)               |

When a gap is genuine (the builder really doesn't support what the
upstream HTML did), log it in
[`builder-feature-requests.md`](./builder-feature-requests.md) and use
the documented workaround.

Slide size cheat sheet:

| Aspect                           | `w`  | `h`  |
| -------------------------------- | ---- | ---- |
| 16:9 (modern presentations)      | 1280 | 720  |
| 4:3 (legacy / projector)         | 1024 | 768  |
| A4 portrait (printable handout)  | 794  | 1123 |
| Letter portrait                  | 816  | 1056 |
| 9:16 (vertical / social)         | 720  | 1280 |
| 3:4 (xhs / 小红书 vertical card) | 960  | 1280 |

For multi-file decks, see [`references/composition.md`](references/composition.md)
on `<Import>` and the recommended folder structure.

## Live preview while authoring

Install the **Slide Builder** VS Code extension
(`slideglance.slide-builder`) and open any `.sgx` file. The preview pane
re-renders on save and on keystroke for unchanged-slide-preserving
incremental updates. Click any rendered element to jump to its source
line. One-command export writes the `.pptx`.

```sh
code --install-extension slideglance.slide-builder
```

The extension hard-depends on Red Hat XML for schema-aware editing and
on-save validation against the bundled XSD (namespace
`urn:slideglance:builder:v1`).

## Theme variants

> **Historical note.** An earlier iteration of this skill shipped 50
> companion `slideglance-theme-*` skills (lewislulu scenarios,
> zhangzara editorial family, taste brutalist / editorial). They were
> removed pending render-quality fixes — too many rendered with broken
> margins, collapsed line breaks, or font fallbacks that didn't match
> the upstream HTML originals' intent.
>
> The lessons from that pass are still useful: palettes are
> consolidated in [`references/themes.md`](references/themes.md),
> schema gotchas in [`references/schema-gotchas.md`](references/schema-gotchas.md),
> builder feature gaps in [`references/builder-feature-requests.md`](references/builder-feature-requests.md).
> If you want a specific design language, pick the palette + fonts
> from `themes.md` and apply them to a clean copy of
> [`examples/two-column.sgx`](examples/two-column.sgx).

## For contributors (working on the slideglance codebase itself)

This skill primarily teaches **authors** how to write `.sgx` and
build `.pptx`. If you are working on the slideglance source tree
(`packages/builder/`, `apps/vscode-extension/`, etc.) rather than
authoring decks, see [`references/development.md`](references/development.md)
for the contributor handbook — builder pipeline architecture, the
Feature Addition Checklist, key internal types, text-measurement
internals, PNG preview workflow, and the VS Code extension build
matrix. The project-level `CLAUDE.md` points contributors at this
same file.

## File structure

```
slideglance-pptx/
├── SKILL.md                  (this file)
├── references/
│   ├── grammar.md            (full XML reference: visual nodes, attributes, containers)
│   ├── composition.md        (Styles, Templates, Master, Import, If / Choose / Foreach)
│   ├── layouts.md            (idiomatic layout recipes — cover, title-body, two-column, KPI grid, timeline, etc.)
│   ├── recipes.md            (patterns, tips, idioms distilled from the runnable example decks)
│   ├── themes.md             (palette and font guidance for slideglance — companion theme skills are the place to actually pick these)
│   ├── limitations.md        (what is NOT in the medium and the recommended substitutes)
│   ├── lint.md               (lint rules + autofix patterns)
│   ├── schema-gotchas.md     (attributes that don't exist, dot-notation forms, master-child surfaces)
│   ├── builder-feature-requests.md  (gaps the builder schema doesn't cover yet, with workarounds)
│   └── development.md        (contributor reference for working on the builder / vscode-extension)
└── examples/
    ├── minimal.sgx           (single-slide hello world)
    └── two-column.sgx        (HStack 50/50 with title and body, a common layout starting point)
```

For richer end-to-end starting points beyond the two scaffolds above,
read the runnable decks in the workspace itself:

- [`examples/builder-reference/`](../../examples/builder-reference/) —
  every node type + every composition primitive across 17 chapters.
  Use as the source-of-truth when porting an idiom.
- [`examples/playground-samples/`](../../examples/playground-samples/) —
  four scenario decks (`pitch`, `editorial`, `tech-spec`, `workshop`),
  each with its own master chrome, palette, and template library. The
  fastest way to bootstrap a new deck is to copy one of these and
  swap content / palette.

[`references/recipes.md`](references/recipes.md) distils the recurring
patterns from both trees into a single cookbook.

## License & author

This skill is licensed MIT. It re-imagines structure and taxonomy from
upstream MIT works (`lewislulu/html-ppt-skill`, etc.). The slideglance
builder, viewer, and renderer are licensed MIT by SimpleCORE Inc.
