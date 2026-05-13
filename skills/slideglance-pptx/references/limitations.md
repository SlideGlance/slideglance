# What's not in the medium

slideglance ports HTML-deck concepts to the PPTX medium. Some
HTML-deck features have no analog in PowerPoint's file format — the
correct response is to substitute, not to fake.

This page is the **authoritative limitations list**. If a user asks
for one of these, point them at the substitute or at the upstream
HTML skill.

## Slide transitions and animations

| Upstream HTML feature | slideglance answer |
| --- | --- |
| CSS keyframe entry (`data-anim="fade-up"`) | Not in the medium. Static layout only. |
| Canvas FX (particle-burst, knowledge-graph, matrix-rain, …) | Not in the medium. Replace with a static still that captures the same idea. |
| Slide-to-slide transitions (slide, fade, morph) | Not in the builder grammar. Add transitions in PowerPoint after export (Transitions tab) if needed. |
| Click-by-click element reveal | Not in the grammar. Author each reveal stage as a separate slide. |

Reasoning: PPTX *does* support transitions and entrance animations at
the file format level, but the slideglance grammar targets static
visual layout. If an interactive HTML-style deck is required, use the
upstream `lewislulu/html-ppt-skill` instead.

## Presenter / runtime features

| Upstream HTML feature | slideglance answer |
| --- | --- |
| `S` key → magnetic-card presenter window | PowerPoint's own presenter view does this. Speaker notes live in `<Notes>`. |
| `T` key → cycle themes live | Themes are baked into the `.sgx` at build time. Re-build with a different palette to swap. |
| `?preview=N` URL → single-slide preview | Use the **Slide Builder** VS Code extension; click any slide thumbnail to preview. |
| Drag / resize presenter cards | Native PowerPoint presenter view. |
| `BroadcastChannel` sync between windows | N/A — PowerPoint owns the presentation runtime. |

The compensating workflow:

1. Author `.sgx` with rich `<Notes>` (150–300 words per slide for talks).
2. Build → `.pptx`.
3. Open in PowerPoint / Keynote.
4. Use the host application's presenter view. Speaker notes appear as authored.

## Typography

| Upstream HTML feature | slideglance answer |
| --- | --- |
| True drop-caps (text flow around a large first letter) | **Lead-in idiom**: oversized accent-colored first sentence, body below. See `grammar.md` § Editorial idioms. |
| Mixed `vertical-align` on inline runs | `textVAlign="middle"` + `lineHeight="1.0"` idiom on every sibling. |
| `letter-spacing` per character | Not supported. Drop. See [`builder-feature-requests.md`](./builder-feature-requests.md). |
| Variable-font axes (`wght`, `wdth`, slant) | Only the bundled `bold` / `italic` axes. |
| Custom OpenType features (`ss01`, `cv03`, alternates) | Not exposed. Pick a font face that ships the desired glyphs as the default. |
| Source-newline preserved in `<Text>` body | Not preserved. XML whitespace collapse turns multi-line source into one paragraph. Stack multiple `<Text>` for explicit breaks. |

## Color

| Upstream HTML feature | slideglance answer |
| --- | --- |
| CSS theme variables (`var(--accent-1)`) | `<Styles>` named classes. |
| RGBA / `oklch` / HSL / named colors | 6-digit hex only. Convert beforehand. |
| Gradients on text (`background-clip: text`) | Not in the medium. Use a solid color, or render the gradient text as an `<Svg>` block (width capped at 1024). |
| Linear / radial / conic gradients on backgrounds | Not directly exposed on `<VStack>` etc. Wrap the gradient in an `<Svg>` block sized to the container, or use a pre-rendered PNG as `backgroundImage`. |
| PPTX theme tokens (`accent1`, `dk1`, …) | Not honored. 6-digit hex only. |
| Alpha (RGBA) on text | Not exposed. Use a flat mid-gray. |
| Alpha on shapes / backgrounds | `opacity` 0–1 on the element. |

## Layout / interaction

| Upstream HTML feature | slideglance answer |
| --- | --- |
| CSS Grid (`grid-template-areas`) | Flexbox via `<VStack>` / `<HStack>` and `<Layer>` for absolute positions. |
| `position: sticky` | N/A — PPTX has no scroll context. |
| Media queries / responsive layouts | One target slide size per deck. Re-export with a different `Document size` for a different aspect ratio. |
| `clip-path` / `mask` | Limited to `<Image sizing.type="crop">` (rectangular). For non-rectangular clipping, pre-process the asset. |
| Hover / interactive states | N/A — static medium. |
| Custom JS runtime (per-deck modules) | N/A — the builder runs at build time, not in the recipient's deck. |
| `flexGrow` / `flexShrink` / `flexBasis` | Not in the schema. Use `w="max"` / `h="max"` on the child that should fill remaining space. |
| `alignItems="baseline"` | Not in the runtime enum. Use the tight-lineHeight + textVAlign="middle" idiom on row siblings. |

## File format

| Upstream HTML feature | slideglance answer |
| --- | --- |
| `<iframe>` embed | Not in the medium. Take a screenshot, embed as `<Image>`. |
| Hyperlinks (`<a href>`) | `<A href="…">…</A>` on inline runs is supported. |
| Embedded video / audio | Not in the builder grammar. Add in PowerPoint after export. |
| Persistent state per deck (localStorage) | N/A. |

## When to escape to "build the HTML deck instead"

Use the upstream `lewislulu/html-ppt-skill` (or any HTML-deck family)
when:

- The deck must run live in a browser tab with smooth animations.
- Pixel-exact CSS layout matters more than recipient editability.
- The presenter wants the magnetic-card presenter window UI.
- Canvas-FX effects are part of the spec.
- The deck is a web artifact (landing page, marketing site, talk site).

Use slideglance when:

- The artifact must be a `.pptx` file (corporate review, executive
  share, email attachment, Google Slides import).
- Recipients will edit slides themselves.
- Deck must print to PDF crisply, or export to images for documentation.
- Static visual layout is fine; animations and runtime are not part of the brief.

## Asking the user when intent is ambiguous

When the user asks for "slides" or "a presentation" without
specifying medium, **ask once**:

> Two ways to go:
>
> 1. **`.pptx` file** (editable in PowerPoint / Keynote / Google
>    Slides, no animations). I'd use `slideglance-pptx`.
> 2. **HTML deck** (browser-based, smooth animations, presenter
>    window, but recipients can't edit slides in PowerPoint). I'd use
>    the upstream `html-ppt` skill.
>
> Which one fits the audience?
