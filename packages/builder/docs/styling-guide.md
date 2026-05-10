# Styling Guide

A practical guide to styling presentations built with `@slideglance/builder` — colors, fonts, backgrounds, borders, shadows, and more.

## Color Format

Colors are specified as **6-digit hex without the `#` prefix** (e.g., `FF0000`, `333333`). This is the recommended format for consistency.

```xml
<Text color="333333">Dark gray text</Text>
<Text color="FF0000">Red text</Text>
<VStack backgroundColor="F8F9FA"><Text>Light gray background</Text></VStack>
```

### Recommended Color Palette

A set of colors that work well for business presentations:

| Purpose    | Color       | Hex      |
| ---------- | ----------- | -------- |
| Title      | Near-black  | `1A1A2E` |
| Body text  | Dark gray   | `333333` |
| Subtitle   | Medium gray | `666666` |
| Muted text | Light gray  | `999999` |
| Primary    | Blue        | `1D4ED8` |
| Success    | Green       | `16A34A` |
| Warning    | Amber       | `D97706` |
| Danger     | Red         | `DC2626` |
| Info       | Sky blue    | `0EA5E9` |
| Light BG   | Off-white   | `F8F9FA` |
| Border     | Light gray  | `E5E7EB` |

## Font

The default font is **Noto Sans JP**, bundled with the builder for accurate text measurement in both Node.js and browser environments. **Pretendard** is also bundled and can be used as a document-wide default font.

### Specifying a Font

```xml
<Text fontFamily="Arial">English text in Arial</Text>
<Text fontFamily="Noto Sans JP">Japanese text (default)</Text>
<SlideGlance>
  <Document fontFamily="Pretendard" />
  <Slide>
    <VStack>
      <Text>문서 전체 기본 폰트를 Pretendard로 지정</Text>
    </VStack>
  </Slide>
</SlideGlance>
```

> **Note:** Custom fonts must be installed on the system where the PPTX is opened. `Noto Sans JP` and `Pretendard` have built-in measurement support.

### Font Size Guide

| Role    | Size (px) | Usage                       |
| ------- | --------- | --------------------------- |
| Title   | 28–40     | Slide titles                |
| Heading | 18–24     | Section headings            |
| Body    | 13–16     | Paragraphs and list items   |
| Caption | 10–12     | Footnotes, labels, captions |

```xml
<VStack gap="12" alignItems="start">
  <Text fontSize="36" bold="true" color="1A1A2E">Slide Title</Text>
  <Text fontSize="20" bold="true" color="333333">Section Heading</Text>
  <Text fontSize="14" color="333333">Body text with regular size.</Text>
  <Text fontSize="11" color="999999">Caption or footnote</Text>
</VStack>
```

### Line Height

Control line spacing with `lineHeight` (multiplier, default: `1.0`).

```xml
<Text lineHeight="1.5">Wider line spacing for readability</Text>
<Text lineHeight="1.0">Tight line spacing</Text>
```

## Text Decoration

### Bold, Italic, Strikethrough

```xml
<Text bold="true">Bold text</Text>
<Text italic="true">Italic text</Text>
<Text strike="true">Strikethrough text</Text>
<Text bold="true" italic="true">Bold italic</Text>
```

### Inline Formatting

Use `<B>`, `<I>`, `<U>`, `<S>`, `<Mark>`, and `<Span>` child elements to apply bold, italic, underline, strikethrough, highlight, or color to part of the text:

```xml
<Text fontSize="16">Normal <B>bold part</B> normal</Text>
<Text fontSize="16">Normal <I>italic part</I> normal</Text>
<Text fontSize="16"><B>bold</B> and <I>italic</I> mixed</Text>
<Text fontSize="16"><B><I>Bold italic (nested)</I></B></Text>
<Text fontSize="16">Normal <U>underline part</U> normal</Text>
<Text fontSize="16">Normal <S>strikethrough part</S> normal</Text>
<Text fontSize="16"><Mark color="FFFF00">highlighted part</Mark> normal</Text>
<Text fontSize="16"><B><U>Bold underline (nested)</U></B></Text>
<Text fontSize="16">Normal <Span color="FF0000">red part</Span> normal</Text>
<Text fontSize="16"><B><Span color="1D4ED8">bold blue</Span></B></Text>
```

This also works inside `<Li>` and `<Td>`:

```xml
<Ul fontSize="14">
  <Li>Normal <B>bold</B> item</Li>
  <Li>Normal <U>underline</U> item</Li>
</Ul>
```

### Underline

Simple underline:

```xml
<Text underline="true">Underlined text</Text>
```

Customized underline with style and color:

```xml
<Text underline.style="wavy" underline.color="FF0000">Wavy red underline</Text>
<Text underline.style="dbl">Double underline</Text>
<Text underline.style="dotted">Dotted underline</Text>
```

See the Text section in [Nodes](./nodes.md) for all available underline styles.

### Highlight

Apply a background highlight to text:

```xml
<Text highlight="FFFF00">Yellow highlighted text</Text>
<Text highlight="90EE90">Green highlighted text</Text>
```

### Text Alignment

```xml
<Text textAlign="left">Left aligned (default)</Text>
<Text textAlign="center">Center aligned</Text>
<Text textAlign="right">Right aligned</Text>
```

## Background

### Background Color

All nodes support `backgroundColor`:

```xml
<Text backgroundColor="F8F9FA" padding="16">Content on a light gray background</Text>
```

### Background Image

Set a background image with `backgroundImage.src` and control sizing with `backgroundImage.sizing`:

```xml
<Text backgroundImage.src="./photo.jpg" backgroundImage.sizing="cover" w="400" h="300" color="FFFFFF">Text over image</Text>
```

| Property                 | Values                   | Description                                         |
| ------------------------ | ------------------------ | --------------------------------------------------- |
| `backgroundImage.src`    | URL / file path / base64 | Image source                                        |
| `backgroundImage.sizing` | `cover` / `contain`      | `cover` fills area (default), `contain` fits within |

## Border

Add borders to any node with dot notation:

```xml
<Text border.color="E5E7EB" border.width="1" padding="16">Container with a light border</Text>
```

### Border Properties

| Property          | Type   | Description            |
| ----------------- | ------ | ---------------------- |
| `border.color`    | hex    | Border color           |
| `border.width`    | number | Border width (px)      |
| `border.dashType` | string | Line style (see below) |

### Border Dash Types

See Common Properties in [Nodes](./nodes.md) for available dash types.

```xml
<Text border.color="333333" border.width="2" border.dashType="dash" padding="16">Dashed border</Text>
```

### Border Radius

Round corners with `borderRadius`:

```xml
<Text backgroundColor="1D4ED8" borderRadius="8" padding="16" color="FFFFFF">Rounded box</Text>
```

## Shadow

Add drop shadows to any node (except Line):

```xml
<VStack shadow.type="outer" shadow.blur="4" shadow.offset="2" shadow.color="000000" shadow.opacity="0.3" padding="16">
  <Text>Card with shadow</Text>
</VStack>
```

### Shadow Properties

| Property         | Type   | Description                 |
| ---------------- | ------ | --------------------------- |
| `shadow.type`    | string | `outer` (default) / `inner` |
| `shadow.blur`    | number | Blur radius                 |
| `shadow.offset`  | number | Offset distance             |
| `shadow.angle`   | number | Angle in degrees            |
| `shadow.color`   | hex    | Shadow color                |
| `shadow.opacity` | 0–1    | Shadow opacity              |

## Opacity

Control background transparency with `opacity` (0 = fully transparent, 1 = fully opaque):

```xml
<Text backgroundColor="1D4ED8" opacity="0.5" padding="16">Semi-transparent blue background</Text>
```

### Overlay Pattern with Layer

Combine `opacity` with Layer for overlay effects:

```xml
<Layer w="800" h="400">
  <Image src="./photo.jpg" w="800" h="400" />
  <Shape shapeType="rect" w="800" h="400" fill.color="000000" fill.transparency="0.6" />
  <VStack w="800" h="400" justifyContent="center" alignItems="center">
    <Text fontSize="36" bold="true" color="FFFFFF">Overlay Title</Text>
  </VStack>
</Layer>
```

## Shape Fill and Line

Shape nodes use `fill` for background and `line` for outline (separate from the common `border` property):

```xml
<Shape shapeType="rect" w="200" h="100"
  fill.color="1D4ED8" fill.transparency="0"
  line.color="0F3B8E" line.width="2">
  Styled shape
</Shape>
```

### Fill Properties

| Property            | Type | Description                    |
| ------------------- | ---- | ------------------------------ |
| `fill.color`        | hex  | Fill color                     |
| `fill.transparency` | 0–1  | Fill transparency (0 = opaque) |

> **Note**: `fill.transparency` accepts a value in the **0–1** range, where `0` is opaque and `1` is fully transparent. This matches the [`opacity` convention](#opacity) used elsewhere in the builder.

### Line Properties

| Property        | Type   | Description               |
| --------------- | ------ | ------------------------- |
| `line.color`    | hex    | Outline color             |
| `line.width`    | number | Outline width (px)        |
| `line.dashType` | string | Same dash types as border |

## Combining Styles

A practical example combining multiple styling techniques:

```xml
<VStack w="max" h="max" padding="48" gap="24" backgroundColor="F8F9FA">
  <!-- Title area -->
  <Text fontSize="36" bold="true" color="1A1A2E">Quarterly Report</Text>
  <Text fontSize="16" color="666666">Q4 2025 Results</Text>

  <!-- Card with shadow and border -->
  <HStack gap="16" w="max">
    <VStack backgroundColor="FFFFFF" borderRadius="8" padding="24" gap="8"
      border.color="E5E7EB" border.width="1"
      shadow.blur="4" shadow.offset="2" shadow.color="000000" shadow.opacity="0.1">
      <Text fontSize="12" color="999999">Revenue</Text>
      <Text fontSize="28" bold="true" color="16A34A">$1.2M</Text>
    </VStack>
    <VStack backgroundColor="FFFFFF" borderRadius="8" padding="24" gap="8"
      border.color="E5E7EB" border.width="1"
      shadow.blur="4" shadow.offset="2" shadow.color="000000" shadow.opacity="0.1">
      <Text fontSize="12" color="999999">Growth</Text>
      <Text fontSize="28" bold="true" color="1D4ED8">+24%</Text>
    </VStack>
  </HStack>

  <!-- Highlighted note -->
  <Text fontSize="13" color="666666" highlight="FEF3C7">
    Note: Figures are preliminary and subject to final audit.
  </Text>
</VStack>
```
