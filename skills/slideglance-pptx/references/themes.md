# Themes and palettes

slideglance uses **6-digit hex colors without `#`**. PPTX theme tokens
(`accent1`, `dk1`, `lt1`, …) are intentionally not supported — the
deterministic-hex constraint locks deck output to the values the
source specifies.

This page collects palette + font recipes you can drop into `<Styles>`.

## Building a palette into `<Styles>`

The recipe is the same for every theme:

```xml
<Styles>
  <Style name="page"   padding="80" padding.top="120" backgroundColor="F8FAFC" />
  <Style name="title"  fontSize="44" bold="true" color="0F172A" lineHeight="1.05" />
  <Style name="h2"     fontSize="28" bold="true" color="0F172A" />
  <Style name="body"   fontSize="18" color="1F2937" lineHeight="1.5" />
  <Style name="muted"  fontSize="14" color="64748B" />
  <Style name="th"     fontSize="11" color="FFFFFF" bold="true" backgroundColor="0F172A" textAlign="center" />
</Styles>
```

Promote any color literal that appears 4+ times across a deck to its
own `<Style>` (the lint rule `HARDCODED_COLOR` will flag it).

## Reference palettes

Each palette below is a **starting point**, not a fixed system. Pick
one, then iterate on the actual deck.

### Corporate clean (default business deck)

```text
Title       0F172A   slate-900
Body        1F2937   slate-800
Muted       64748B   slate-500
Primary     1D4ED8   blue-700
Success     16A34A   green-600
Warning     D97706   amber-600
Danger      DC2626   red-600
Info        0EA5E9   sky-500
Light bg    F8FAFC   slate-50
Border      CBD5E1   slate-300
```

### Dark technical (engineering / dev)

```text
Background  0B1020   near-black indigo
Surface     12172B   indigo-950
Title       E2E8F0   slate-200
Body        CBD5E1   slate-300
Muted       64748B   slate-500
Accent      7DD3FC   sky-300
Warm hl     FCA5A5   red-300
Mono        86EFAC   green-300
```

### Editorial cream (magazine / long-form)

```text
Paper       F8F3E8   warm cream
Surface     FFFEF8   pure cream
Ink         3A332B   coffee
Title       1B1410   espresso
Accent      9A2A1F   brick red
Soft        BFB59E   stone
Rule        D6CFB8   muted gold
```

Pair with a serif display family (`Georgia`, `Playfair Display`,
`Tiempos`) for titles and a sans family (`Inter`, `Pretendard`) for
body. The mixed-size row idiom in
[`grammar.md`](./grammar.md#editorial-idioms) is mandatory here.

### Macaron pastel (lifestyle / soft)

```text
Cream       FEF8F1
Peach       FFD8C2
Mint        CFEBD8
Sky         CBE2F0
Lilac       DAD0F0
Lemon       F4EAB8
Rose        F0CBD8
Ink         431407   warm brown
Sub         8B5A2B   sandstone
```

### Brutalist (high-contrast / poster)

```text
Bg          F2F0EA   raw paper
Ink         0A0908   true black
Hot         F35F1C   safety orange
Cool        1A2A6C   navy
Caution     FFD400   sign yellow
Rule        0A0908   true black (4px+)
```

Use heavy, narrow display fonts (`Inter Tight`, `Druk`, `Anton`),
oversize titles, and minimal padding.

### Safety / alert

```text
Bg          0A0908
Surface     1A1612
Hot         F35F1C
Caution     FFD400
Danger      DC2626
Ink         F8F3E8
Muted       9CA3AF
```

### Academic / blueprint

```text
Bg          0E2A47   deep blueprint blue
Ink         F8F3E8   cream
Hairline    7BA7CC   blueprint hairline
Accent      F4A261   ochre
Soft        D4E6F2   pale blueprint
```

### Coral / warm

```text
Bg          FFF1EA
Surface     FFE3D2
Coral       FF6B3D
Ink         2B1810
Sub         8B5A2B
Mint        CDE9D6   (accent secondary)
```

### Monochrome

```text
Paper       FFFFFF
Ink         0A0908
Mid         3F3F46
Soft        D4D4D8
Accent      0A0908   (the contrast itself is the accent)
```

Pair with a single typeface (Helvetica Now / Inter / GT America) and
heavy use of typographic hierarchy.

## Fonts

Bundled and measured exactly:

- **Pretendard** — Korean + Latin sans-serif. Recommended default.
- **Noto Sans JP** — Japanese sans-serif.

Anything else uses a heuristic measurer (CJK = 1em, alphanumeric =
0.5em) which can drift from PowerPoint's actual rendered width by a
few percent. PowerPoint resolves the actual font at render time on
the recipient's machine — so either install / embed your chosen
family, or stick to ubiquitous fallbacks (Arial, Helvetica, Georgia,
Times, Calibri).

When the deck must render byte-identically on recipients' machines,
embed the font via the master PPTX option (`masterPptx` in
`buildPptx`).

### Pairing recipes

| Mood | Display (titles) | Body |
| --- | --- | --- |
| Corporate clean | Pretendard / Inter | Pretendard / Inter |
| Editorial magazine | Playfair Display / Georgia | Inter / Pretendard |
| Tech / engineering | Inter / IBM Plex Sans | IBM Plex Mono (code) + Inter |
| Lifestyle / soft | Playfair Italic / Cormorant | Inter Light / Manrope |
| Brutalist / poster | Anton / Druk / Bebas Neue | Helvetica / Inter |
| Academic | Source Serif Pro / Crimson | Source Sans Pro / Inter |

Editorial decks should pair **exactly two** families (display + body).
The lint rule `INCONSISTENT_FONT` flags 3+.

## Anti-patterns

- **Don't use semi-transparent text colors for "muted" body.** Use a
  flat hex (e.g. `64748B`) instead of opacity. PowerPoint renders
  alpha-mixed text differently across versions.
- **Don't put real PPTX theme tokens (`accent1`, etc.) in `color="…"`.**
  They are not honored.
- **Don't pair three serif families.** Two is editorial; three is
  noise.
- **Don't hard-code colors in 10 places.** Lift to `<Styles>` after
  the third occurrence.
