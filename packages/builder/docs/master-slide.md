# Slide Master

You can define a slide master with static objects (text, images, rectangles, lines) and automatic page numbers that appear on all slides.

## Basic Usage

```typescript
import { buildPptx } from "@slideglance/builder";

const xml = `
<VStack w="100%" h="max" padding="48">
  <Text fontSize="32" bold="true">Page 1</Text>
</VStack>
<VStack w="100%" h="max" padding="48">
  <Text fontSize="32" bold="true">Page 2</Text>
</VStack>
`;

const { pptx } = await buildPptx(
  xml,
  { w: 1280, h: 720 },
  {
    master: {
      title: "MY_MASTER",
      background: { color: "F8FAFC" },
      objects: [
        // Header background
        {
          type: "rect",
          x: 0,
          y: 0,
          w: 1280,
          h: 40,
          fill: { color: "0F172A" },
        },
        // Header text (left)
        {
          type: "text",
          text: "Company Name",
          x: 48,
          y: 12,
          w: 200,
          h: 28,
          fontSize: 14,
          color: "FFFFFF",
        },
        // Header text (right) - date
        {
          type: "text",
          text: "2025/01/01",
          x: 1032,
          y: 12,
          w: 200,
          h: 28,
          fontSize: 12,
          color: "E2E8F0",
          textAlign: "right",
        },
        // Footer text
        {
          type: "text",
          text: "Confidential",
          x: 48,
          y: 682,
          w: 200,
          h: 30,
          fontSize: 10,
          color: "1E293B",
        },
      ],
      // Page number (automatically inserted by pptxgenjs)
      slideNumber: {
        x: 1032,
        y: 682,
        w: 200,
        h: 30,
        fontSize: 10,
        color: "1E293B",
      },
    },
  },
);
```

## XML Document Format

When you want to keep slide settings and multiple masters inside the XML itself, wrap the slides in a `<SlideGlance>` root element.

```xml
<SlideGlance>
  <Document size="16:9" defaultMaster="PRIMARY" />
  <Master name="PRIMARY" backgroundColor="F8FAFC" margin="48">
    <MasterRect x="0" y="0" w="1280" h="40" fill.color="0F172A" />
    <MasterText x="48" y="12" w="220" h="28" fontSize="14" color="FFFFFF">
      Company Name
    </MasterText>
    <SlideNumber x="1032" y="682" w="200" h="30" fontSize="10" color="1E293B" />
  </Master>

  <Master name="ALT" backgroundColor="FFF7ED">
    <MasterLine x="0" y="48" w="1280" h="0" line.color="FDBA74" />
  </Master>

  <Slide>
    <VStack w="100%" h="max" padding="48">
      <Text fontSize="32" bold="true">Uses PRIMARY</Text>
    </VStack>
  </Slide>

  <Slide master="ALT">
    <VStack w="100%" h="max" padding="48">
      <Text fontSize="32" bold="true">Uses ALT</Text>
    </VStack>
  </Slide>
</SlideGlance>
```

### Presentation Attributes

| Attribute          | Type           | Description                                                          |
| ------------------ | -------------- | -------------------------------------------------------------------- |
| `size`             | `16:9` / `4:3` | Built-in slide size                                                  |
| `width` / `height` | number         | Custom slide size in px (use instead of `size`)                      |
| `defaultMaster`    | string         | Master name applied to slides without an explicit `master` attribute |
| `fontFamily`       | string         | Default font family for text descendants (overridden by node-level)  |
| `fontSize`         | number         | Default font size in pt                                              |
| `color`            | hex            | Default text color (6-digit hex)                                     |
| `bold`             | boolean        | Default bold state for text                                          |
| `italic`           | boolean        | Default italic state                                                 |
| `underline`        | object/boolean | Default underline configuration                                      |
| `strike`           | boolean        | Default strikethrough state                                          |
| `highlight`        | hex            | Default text highlight color (6-digit hex)                           |
| `lineHeight`       | number         | Default line height multiplier                                       |

Notes:

- `<Styles>` can also be declared under `<SlideGlance>` and reused from both slides and `<Master>` content via `class="..."` (see [Styles in Master Content](#styles-in-master-content)).
- `<Slide>` is the recommended slide container inside `<SlideGlance>` and can accept `master="..."`.
- `<Slide>` can also contain speaker notes via a `<Notes>` child (see [Speaker Notes](#speaker-notes)). The `notes="..."` attribute is deprecated — use `<Notes>` child instead.

### Master Attributes

- `name`: Required master name.
- `backgroundColor` / `backgroundPath` / `backgroundData`: Background source. Mutually exclusive — set exactly one.
- `margin`: Number or directional margin via dot notation such as `margin.top="48"`.

### Master Child Elements

- Normal slide-like nodes such as `<Text>`, `<Image>`, `<Shape>`, `<Line>`, `<VStack>`, `<HStack>`, and `<Layer>` are allowed inside `<Master>`. These are laid out first and then converted into true pptx master objects via `pptxgenjs.defineSlideMaster()`.
- `<MasterText>`: static text object
- `<MasterImage>`: static image object
- `<MasterRect>`: static rectangle object
- `<MasterLine>`: static line object
- `<SlideNumber>`: built-in page number position

`<Slide master="ALT">` selects a master for that slide. For backward compatibility, direct root slide nodes under `<SlideGlance>` can still use `master="ALT"`.

> **Security**: `<Master backgroundPath>` is forwarded to pptxgenjs for image loading. The same security considerations as [`<Image src>`](nodes.md#4-image) apply: untrusted file system paths can read arbitrary server files, and untrusted HTTP(S) URLs can trigger SSRF. Validate paths and URLs from untrusted sources against an allowlist before passing them to pom.

### Styles in Master Content

> **Note**: `<Styles>` defined in `<SlideGlance><Styles>` apply to **both** slide content and `<Master>` content. Styles defined in `<Fragment>` files apply only after the file is imported into a `<SlideGlance>` with `<Styles>` defined or imported. Reference styles from master content using the same `class="..."` attribute as in regular slide content.

## Page-like Master Example

You can also author a master with regular layout nodes instead of only `MasterText` / `MasterRect` style objects.

```xml
<SlideGlance>
  <Document size="16:9" defaultMaster="PRIMARY" />
  <Master name="PRIMARY">
    <Layer w="1280" h="720">
      <Shape
        x="0"
        y="0"
        w="1280"
        h="52"
        shapeType="rect"
        fill.color="0F172A"
      />
      <Text
        x="48"
        y="14"
        w="260"
        h="24"
        fontSize="14"
        color="FFFFFF"
      >
        Company Name
      </Text>
      <Shape
        x="1040"
        y="666"
        w="160"
        h="28"
        shapeType="roundRect"
        text="Internal"
        fontSize="10"
        color="FFFFFF"
        fill.color="1D4ED8"
      />
    </Layer>
    <SlideNumber x="1208" y="680" w="32" h="20" fontSize="10" color="334155" />
  </Master>

  <VStack w="100%" h="max" padding="48">
    <Text fontSize="32" bold="true">Hello</Text>
  </VStack>
</SlideGlance>
```

This still produces a true PowerPoint master. Internally, pom lays out the regular nodes first and then converts the result into the `defineSlideMaster()` object model that `pptxgenjs` supports.

### Current Limitations

- `<Table>` inside `<Master>` is not supported when generating a true PowerPoint master and will throw an error
- `<Chart>` inside `<Master>` is currently not supported
- For the most predictable output, prefer text, image, shape, line, and layout container nodes inside `<Master>`

> **Limitation (slide layout tier)**: Each `<Master>` maps to a single slide layout. PPTX's three-tier hierarchy (Slide Master → Slide Layout → Slide) is flattened into the single `<Master>` concept. Multiple layouts under one master (e.g., "Title Slide" vs "Title and Content" sharing a master) are not currently expressible. Authors who require multiple PowerPoint-selectable layouts per master must wait for `<Layout>` tag support (planned, no schedule).

> **Limitation (placeholders)**: Builder-generated masters define background and static decoration only. The OOXML placeholder concept (`<a:ph type="title"/>`, `body`, `sldNum`, `dt`, `ftr`) is not modeled. All slide content is placed as absolute or flex-positioned objects independent of placeholder binding. Implications:
>
> - PowerPoint's "Outline View" cannot extract slide titles from generated content.
> - Screen readers cannot announce a structured slide title.
> - The PowerPoint Accessibility Checker will report missing slide titles unless an explicit title is bundled in the master decoration.
>
> See [Accessibility Tracking](#accessibility-tracking) below for planned `<Slide title="...">` support.

### Accessibility Tracking

A future enhancement to expose at least the title placeholder via `<Slide title="...">` is tracked separately. Until that lands, accessibility-sensitive deployments should add an explicit text shape with the slide title and avoid relying on PowerPoint's outline extraction.

## Master Resolution Priority

When both XML `<Master>` definitions and programmatic `BuildPptxOptions.master` / `masters` are provided, the builder resolves which masters to use according to a fixed three-tier priority:

| Priority    | Source                                         | Wins when                                                           |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| 1 (highest) | `options.masters` (array)                      | Always wins if provided                                             |
| 2           | XML `<Master>` elements within `<SlideGlance>` | Wins when `options.masters` is absent                               |
| 3 (lowest)  | `options.master` (single)                      | Used only when both `options.masters` and XML `<Master>` are absent |

Behavior matrix:

| XML `<Master>` present | `options.masters` provided | `options.master` provided | Effective masters                 |
| ---------------------- | -------------------------- | ------------------------- | --------------------------------- |
| Yes                    | Yes                        | —                         | `options.masters` (XML ignored)   |
| Yes                    | No                         | Yes                       | XML `<Master>` (singular ignored) |
| Yes                    | No                         | No                        | XML `<Master>`                    |
| No                     | Yes                        | —                         | `options.masters`                 |
| No                     | No                         | Yes                       | `[options.master]`                |
| No                     | No                         | No                        | (default empty master)            |

> **Note**: When both XML `<Master>` definitions and a singular `options.master` are supplied, the XML wins. To override masters programmatically while still allowing XML authoring, pass `options.masters` (plural array) — that always wins.

> **Note**: This priority concerns master _selection_ only. The default master (which master is applied to slides without an explicit `master="..."` reference) is resolved separately as `options.defaultMaster ?? document.defaultMaster ?? masters[0]?.title`.

> **Note**: This precedence is distinct from the [`masterPptx` vs `master.background`](#priority-rules) precedence under "Using an Existing PPTX as Master", which is a separate concept.

## Slide Master Options

```typescript
type SlideMasterOptions = {
  title?: string; // Master slide name (auto-generated if omitted)
  background?:
    | { color: string }
    | { path: string }
    | { data: string }
    | { image: string };
  margin?:
    | number
    | { top?: number; right?: number; bottom?: number; left?: number };
  objects?: MasterObject[]; // Static objects (absolute coordinates in px)
  slideNumber?: SlideNumberOptions; // Page number using pptxgenjs built-in feature
};

type MasterObject =
  | MasterTextObject
  | MasterImageObject
  | MasterRectObject
  | MasterLineObject;

type MasterTextObject = {
  type: "text";
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  bold?: boolean;
  textAlign?: "left" | "center" | "right";
};

type MasterImageObject = {
  type: "image";
  src: string; // Path or data URI
  x: number;
  y: number;
  w: number;
  h: number;
};

type MasterRectObject = {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: { color?: string; transparency?: number };
  border?: { color?: string; width?: number; dashType?: string };
};

type MasterLineObject = {
  type: "line";
  x: number;
  y: number;
  w: number;
  h: number;
  line?: { color?: string; width?: number; dashType?: string };
};

type SlideNumberOptions = {
  x: number;
  y: number;
  w?: number;
  h?: number;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
};
```

## Features

- **True PowerPoint Master**: Uses pptxgenjs's `defineSlideMaster` to create a real master slide that is editable in PowerPoint
- **Static Objects**: Define text, images, rectangles, and lines with absolute coordinates (in pixels)
- **Page-like Master Authoring**: `<Master>` can also contain regular pom layout nodes, which are converted into master objects where pptxgenjs supports them
- **Background**: Set solid color, image path, or base64-encoded image as the slide background
- **Page Number**: Automatic page numbering using pptxgenjs built-in feature
- **Margin**: Define content margins in pixels

## Background Options

```typescript
// Solid color
background: {
  color: "F8FAFC";
}

// Image from file path
background: {
  path: "./images/background.png";
}

// Base64-encoded image
background: {
  data: "data:image/png;base64,...";
}

// Image from URL or file path
background: {
  image: "https://example.com/cover.jpg";
}
```

## Using an Existing PPTX as Master

You can pass an existing PPTX file as a master template via the `masterPptx` option. The background (solid color or image) from the slide master or slide layout will be extracted and applied to the output.

```typescript
import fs from "fs";
import { buildPptx } from "@slideglance/builder";

const { pptx } = await buildPptx(
  xml,
  { w: 1280, h: 720 },
  {
    masterPptx: fs.readFileSync("template.pptx"),
  },
);
```

### Priority Rules

- If both `masterPptx` and `master.background` are specified, `master.background` takes priority
- `masterPptx` only extracts the background; other master settings (objects, margin, slideNumber) are not affected

### Supported Backgrounds

- Solid color fills (`a:solidFill` / `a:srgbClr`)
- Image fills (`a:blipFill` / `a:blip`)

### Lookup Order

1. Slide master (`ppt/slideMasters/slideMaster1.xml`)
2. Slide layouts (`ppt/slideLayouts/slideLayoutN.xml`)

### Not Supported

- Theme colors (`a:schemeClr`)
- Gradient fills (`a:gradFill`)
- Static objects (logos, decorations)
- Slide size inheritance
- Font/theme/placeholder inheritance

## Notes

- All coordinates and dimensions are specified in **pixels** (px)
- Coordinates are converted internally to inches (96 DPI)
- The `slideNumber` option uses pptxgenjs's built-in page number feature

## Speaker Notes

Speaker notes can be attached to a `<Slide>` in two ways:

```xml
<Slide>
  <Notes>This slide introduces the quarterly results...</Notes>
  <VStack>...</VStack>
</Slide>
```

> **Note**: The `<Notes>` child element accepts multi-line content. Speaker notes are added per slide as a single `<Notes>` child.
