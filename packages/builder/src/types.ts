import { z } from "zod";
import { ICON_DATA } from "./icons/iconData.ts";
import {
  alignItemsSchema,
  alignSelfSchema,
  backgroundImageSchema,
  borderDashSchema,
  borderStyleSchema,
  bulletNumberTypeSchema,
  fillStyleSchema,
  flexWrapSchema,
  justifyContentSchema,
  lengthSchema,
  paddingSchema,
  positionTypeSchema,
  shadowStyleSchema,
  shapeTypeSchema,
  underlineSchema,
  type AlignItems,
  type FlexWrap,
  type JustifyContent,
} from "./registry/shared/index.ts";

// Re-export shared schemas that other modules import from `./types.ts`
// (compiled registry, validation, dispatcher, document).
export { bulletNumberTypeSchema };
export type {
  AlignItems,
  AlignSelf,
  BulletNumberType,
  FlexWrap,
  JustifyContent,
  PositionType,
  Length,
  Padding,
  BorderDash,
  BorderStyle,
  FillStyle,
  ShadowStyle,
  UnderlineStyle,
  Underline,
  DefaultTextStyle,
  ShapeType,
  BackgroundImage,
  BackgroundImageSizing,
} from "./registry/shared/index.ts";

// ===== Base Node =====
const baseNodeSchema = z.object({
  w: lengthSchema.optional(),
  h: lengthSchema.optional(),
  minW: z.number().optional(),
  maxW: z.number().optional(),
  minH: z.number().optional(),
  maxH: z.number().optional(),
  padding: paddingSchema.optional(),
  margin: paddingSchema.optional(),
  backgroundColor: z.string().optional(),
  backgroundImage: backgroundImageSchema.optional(),
  border: borderStyleSchema.optional(),
  borderRadius: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  zIndex: z.number().optional(),
  position: positionTypeSchema.optional(),
  top: z.number().optional(),
  right: z.number().optional(),
  bottom: z.number().optional(),
  left: z.number().optional(),
  alignSelf: alignSelfSchema.optional(),
  shadow: shadowStyleSchema.optional(),
  master: z.string().optional(),
  notes: z.string().optional(),
  isDecorative: z.boolean().optional(),
  /**
   * Stable identifier assigned at parse time. Used to correlate a BuilderNode with
   * its originating source file + line via the parse result's `sourceMap`.
   * Propagated through calcYogaLayout/toPositioned and emitted as pptxgenjs
   * `objectName` during render. Internal; omitted from user-written XML.
   */
  __nodeId: z.number().optional(),
});

type BaseBuilderNode = z.infer<typeof baseNodeSchema>;

// ===== Inline text run (partial bold/italic within a text node) =====
const textRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  highlight: z.string().optional(),
  color: z.string().optional(),
  href: z.string().optional(),
  lang: z.string().optional(),
});

// ===== Non-recursive Node Types =====
export const textNodeSchema = baseNodeSchema.extend({
  type: z.literal("text"),
  text: z.string(),
  runs: z.array(textRunSchema).optional(),
  fontSize: z.number().optional(),
  color: z.string().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: underlineSchema.optional(),
  strike: z.boolean().optional(),
  highlight: z.string().optional(),
  fontFamily: z.string().optional(),
  lineHeight: z.number().optional(),
  noWrap: z.boolean().optional(),
  textVAlign: z.enum(["top", "middle", "bottom"]).optional(),
});

export const liNodeSchema = z.object({
  text: z.string(),
  runs: z.array(textRunSchema).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: underlineSchema.optional(),
  strike: z.boolean().optional(),
  highlight: z.string().optional(),
  color: z.string().optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
});

export const ulNodeSchema = baseNodeSchema.extend({
  type: z.literal("ul"),
  items: z.array(liNodeSchema),
  fontSize: z.number().optional(),
  color: z.string().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: underlineSchema.optional(),
  strike: z.boolean().optional(),
  highlight: z.string().optional(),
  fontFamily: z.string().optional(),
  lineHeight: z.number().optional(),
  bulletIndent: z.number().optional(),
  noWrap: z.boolean().optional(),
  textVAlign: z.enum(["top", "middle", "bottom"]).optional(),
});

export const olNodeSchema = baseNodeSchema.extend({
  type: z.literal("ol"),
  items: z.array(liNodeSchema),
  fontSize: z.number().optional(),
  color: z.string().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: underlineSchema.optional(),
  strike: z.boolean().optional(),
  highlight: z.string().optional(),
  fontFamily: z.string().optional(),
  lineHeight: z.number().optional(),
  numberType: bulletNumberTypeSchema.optional(),
  numberStartAt: z.number().optional(),
  bulletIndent: z.number().optional(),
  noWrap: z.boolean().optional(),
  textVAlign: z.enum(["top", "middle", "bottom"]).optional(),
});

const imageSizingSchema = z.object({
  type: z.enum(["contain", "cover", "crop"]),
  w: z.number().optional(),
  h: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

export const imageNodeSchema = baseNodeSchema.extend({
  type: z.literal("image"),
  src: z.string(),
  sizing: imageSizingSchema.optional(),
  altText: z.string().optional(),
  rotate: z.number().optional(),
});

const iconNameSchema = z.enum(Object.keys(ICON_DATA) as [string, ...string[]]);

const iconColorSchema = z
  .string()
  .regex(/^#?[0-9a-fA-F]{3,8}$/)
  .optional();

const iconVariantSchema = z
  .enum([
    "circle-filled",
    "circle-outlined",
    "square-filled",
    "square-outlined",
  ])
  .optional();

export const iconNodeSchema = baseNodeSchema.extend({
  type: z.literal("icon"),
  name: iconNameSchema,
  size: z.number().positive().max(1024).optional(),
  color: iconColorSchema,
  variant: iconVariantSchema,
  backgroundColor: iconColorSchema,
  altText: z.string().optional(),
});

export type IconNode = z.infer<typeof iconNodeSchema>;

export const svgNodeSchema = baseNodeSchema.extend({
  type: z.literal("svg"),
  svgContent: z.string(),
  w: z.number().positive().max(1024).optional(),
  h: z.number().positive().max(1024).optional(),
  color: iconColorSchema,
  altText: z.string().optional(),
});

export type SvgNode = z.infer<typeof svgNodeSchema>;

const tableCellSchema = z.object({
  text: z.string(),
  runs: z.array(textRunSchema).optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
  color: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: underlineSchema.optional(),
  strike: z.boolean().optional(),
  highlight: z.string().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
  backgroundColor: z.string().optional(),
  colspan: z.number().int().min(1).optional(),
  rowspan: z.number().int().min(1).optional(),
  margin: paddingSchema.optional(),
});

const tableRowSchema = z.object({
  cells: z.array(tableCellSchema),
  height: z.number().optional(),
  h: lengthSchema.optional(),
});

const tableColumnSchema = z.object({
  width: lengthSchema.optional(),
  w: lengthSchema.optional(),
});

export const tableNodeSchema = baseNodeSchema.extend({
  type: z.literal("table"),
  columns: z.array(tableColumnSchema),
  rows: z.array(tableRowSchema),
  defaultRowHeight: z.number().optional(),
  cellBorder: borderStyleSchema.optional(),
  cellMargin: paddingSchema.optional(),
});

export const shapeNodeSchema = baseNodeSchema.extend({
  type: z.literal("shape"),
  shapeType: shapeTypeSchema,
  text: z.string().optional(),
  fill: fillStyleSchema.optional(),
  line: borderStyleSchema.optional(),
  fontSize: z.number().optional(),
  color: z.string().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: underlineSchema.optional(),
  strike: z.boolean().optional(),
  highlight: z.string().optional(),
  fontFamily: z.string().optional(),
  lineHeight: z.number().optional(),
  textVAlign: z.enum(["top", "middle", "bottom"]).optional(),
  rotate: z.number().optional(),
  noWrap: z.boolean().optional(),
});

const chartTypeSchema = z.enum([
  "bar",
  "line",
  "pie",
  "area",
  "doughnut",
  "radar",
]);

const radarStyleSchema = z.enum(["standard", "marker", "filled"]);

const chartDataSchema = z.object({
  name: z.string().optional(),
  labels: z.array(z.string()),
  values: z.array(z.number()),
});

export const chartNodeSchema = baseNodeSchema.extend({
  type: z.literal("chart"),
  chartType: chartTypeSchema,
  data: z.array(chartDataSchema),
  showLegend: z.boolean().optional(),
  showTitle: z.boolean().optional(),
  title: z.string().optional(),
  chartColors: z.array(z.string()).optional(),
  legendPos: z.enum(["t", "b", "l", "r", "tr"]).optional(),
  legendFontSize: z.number().optional(),
  catAxisLabelFontSize: z.number().optional(),
  valAxisLabelFontSize: z.number().optional(),
  barGapWidthPct: z.number().optional(),
  lineDataSymbolSize: z.number().optional(),
  // Radar-only options
  radarStyle: radarStyleSchema.optional(),
  altText: z.string().optional(),
  showValue: z.boolean().optional(),
  barGrouping: z.enum(["clustered", "stacked", "percentStacked"]).optional(),
  valAxisMinVal: z.number().optional(),
  valAxisMaxVal: z.number().optional(),
});

export type TextNode = z.infer<typeof textNodeSchema>;
export type LiNode = z.infer<typeof liNodeSchema>;
export type UlNode = z.infer<typeof ulNodeSchema>;
export type OlNode = z.infer<typeof olNodeSchema>;
export type ImageNode = z.infer<typeof imageNodeSchema>;
export type TableNode = z.infer<typeof tableNodeSchema>;
export type ShapeNode = z.infer<typeof shapeNodeSchema>;
export type ChartNode = z.infer<typeof chartNodeSchema>;

// ===== Line Node =====
const lineArrowTypeSchema = z.enum([
  "none",
  "arrow",
  "triangle",
  "diamond",
  "oval",
  "stealth",
]);

const lineArrowOptionsSchema = z.object({
  type: lineArrowTypeSchema.optional(),
});

export const lineArrowSchema = z.union([z.boolean(), lineArrowOptionsSchema]);

export const lineNodeSchema = baseNodeSchema.extend({
  type: z.literal("line"),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  color: z.string().optional(),
  lineWidth: z.number().optional(),
  dashType: borderDashSchema.optional(),
  beginArrow: lineArrowSchema.optional(),
  endArrow: lineArrowSchema.optional(),
});

export type LineArrow = z.infer<typeof lineArrowSchema>;
export type LineNode = z.infer<typeof lineNodeSchema>;

// ===== Layer Node =====
// LayerChild, LayerNode types are defined below after BuilderNode

// ===== Recursive Types with Explicit Type Definitions =====

// Define the types explicitly to avoid 'any' inference
export type VStackNode = BaseBuilderNode & {
  type: "vstack";
  children: BuilderNode[];
  gap?: number;
  alignItems?: AlignItems;
  justifyContent?: JustifyContent;
  flexWrap?: FlexWrap;
};

export type HStackNode = BaseBuilderNode & {
  type: "hstack";
  children: BuilderNode[];
  gap?: number;
  alignItems?: AlignItems;
  justifyContent?: JustifyContent;
  flexWrap?: FlexWrap;
};

// A Layer child requires explicit x and y.
type LayerChild = BuilderNode & {
  x: number;
  y: number;
};

export type LayerNode = BaseBuilderNode & {
  type: "layer";
  children: LayerChild[];
};

export type BuilderNode =
  | TextNode
  | UlNode
  | OlNode
  | ImageNode
  | TableNode
  | VStackNode
  | HStackNode
  | ShapeNode
  | ChartNode
  | LineNode
  | LayerNode
  | IconNode
  | SvgNode;

// Define schemas using passthrough to maintain type safety
const vStackNodeSchemaBase = baseNodeSchema.extend({
  type: z.literal("vstack"),
  children: z.array(z.lazy(() => nodeSchema)),
  gap: z.number().optional(),
  alignItems: alignItemsSchema.optional(),
  justifyContent: justifyContentSchema.optional(),
  flexWrap: flexWrapSchema.optional(),
});

const hStackNodeSchemaBase = baseNodeSchema.extend({
  type: z.literal("hstack"),
  children: z.array(z.lazy(() => nodeSchema)),
  gap: z.number().optional(),
  alignItems: alignItemsSchema.optional(),
  justifyContent: justifyContentSchema.optional(),
  flexWrap: flexWrapSchema.optional(),
});

const layerChildSchemaBase = z.lazy(() =>
  nodeSchema.and(
    z.object({
      x: z.number(),
      y: z.number(),
    }),
  ),
);

const layerNodeSchemaBase = baseNodeSchema.extend({
  type: z.literal("layer"),
  children: z.array(layerChildSchemaBase),
});

const nodeSchema: z.ZodType<BuilderNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    textNodeSchema,
    ulNodeSchema,
    olNodeSchema,
    imageNodeSchema,
    tableNodeSchema,
    vStackNodeSchemaBase,
    hStackNodeSchemaBase,
    shapeNodeSchema,
    chartNodeSchema,
    lineNodeSchema,
    layerNodeSchemaBase,
    iconNodeSchema,
    svgNodeSchema,
  ]),
);

// ===== Positioned Node Types =====
const positionedBaseSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

type PositionedBase = z.infer<typeof positionedBaseSchema>;

// Positioned variant of a Layer child (carries resolved x, y).
export type PositionedLayerChild = PositionedNode & {
  x: number;
  y: number;
};

export type PositionedNode =
  | (TextNode & PositionedBase)
  | (UlNode & PositionedBase)
  | (OlNode & PositionedBase)
  | (ImageNode & PositionedBase & { imageData?: string })
  | (TableNode & PositionedBase)
  | (VStackNode & PositionedBase & { children: PositionedNode[] })
  | (HStackNode & PositionedBase & { children: PositionedNode[] })
  | (ShapeNode & PositionedBase)
  | (ChartNode & PositionedBase)
  | (LineNode & PositionedBase)
  | (LayerNode & PositionedBase & { children: PositionedLayerChild[] })
  | (IconNode &
      PositionedBase & {
        iconImageData: string;
        bgX?: number;
        bgY?: number;
        bgW?: number;
        bgH?: number;
        iconX?: number;
        iconY?: number;
        iconW?: number;
        iconH?: number;
      })
  | (SvgNode & PositionedBase & { iconImageData: string });

const positionedLayerChildSchema: z.ZodType<PositionedLayerChild> = z.lazy(() =>
  positionedNodeSchema.and(
    z.object({
      x: z.number(),
      y: z.number(),
    }),
  ),
);

const positionedNodeSchema: z.ZodType<PositionedNode> = z.lazy(() =>
  z.union([
    textNodeSchema.merge(positionedBaseSchema),
    ulNodeSchema.merge(positionedBaseSchema),
    olNodeSchema.merge(positionedBaseSchema),
    imageNodeSchema.merge(positionedBaseSchema).extend({
      imageData: z.string().optional(),
    }),
    tableNodeSchema.merge(positionedBaseSchema),
    vStackNodeSchemaBase.merge(positionedBaseSchema).extend({
      children: z.array(z.lazy(() => positionedNodeSchema)),
    }),
    hStackNodeSchemaBase.merge(positionedBaseSchema).extend({
      children: z.array(z.lazy(() => positionedNodeSchema)),
    }),
    shapeNodeSchema.merge(positionedBaseSchema),
    chartNodeSchema.merge(positionedBaseSchema),
    lineNodeSchema.merge(positionedBaseSchema),
    layerNodeSchemaBase.merge(positionedBaseSchema).extend({
      children: z.array(positionedLayerChildSchema),
    }),
    iconNodeSchema.merge(positionedBaseSchema).extend({
      iconImageData: z.string(),
    }),
    svgNodeSchema.merge(positionedBaseSchema).extend({
      iconImageData: z.string(),
    }),
  ]),
);

// ===== Slide Master Options =====
const masterTextObjectSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
  color: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: underlineSchema.optional(),
  strike: z.boolean().optional(),
  highlight: z.string().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
});

const masterImageObjectSchema = z.object({
  type: z.literal("image"),
  src: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

const masterRectObjectSchema = z.object({
  type: z.literal("rect"),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  fill: fillStyleSchema.optional(),
  border: borderStyleSchema.optional(),
});

const masterLineObjectSchema = z.object({
  type: z.literal("line"),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  line: borderStyleSchema.optional(),
});

export const masterObjectSchema = z.discriminatedUnion("type", [
  masterTextObjectSchema,
  masterImageObjectSchema,
  masterRectObjectSchema,
  masterLineObjectSchema,
]);

export const slideNumberOptionsSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().optional(),
  h: z.number().optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
  color: z.string().optional(),
});

const slideMasterBackgroundSchema = z.union([
  z.object({ color: z.string() }),
  z.object({ path: z.string() }),
  z.object({ data: z.string() }),
]);

const slideMasterMarginSchema = z.union([
  z.number(),
  z.object({
    top: z.number().optional(),
    right: z.number().optional(),
    bottom: z.number().optional(),
    left: z.number().optional(),
  }),
]);

export const slideMasterOptionsSchema = z.object({
  title: z.string().optional(),
  background: slideMasterBackgroundSchema.optional(),
  margin: slideMasterMarginSchema.optional(),
  objects: z.array(masterObjectSchema).optional(),
  slideNumber: slideNumberOptionsSchema.optional(),
});

export type MasterTextObject = z.infer<typeof masterTextObjectSchema>;
export type MasterImageObject = z.infer<typeof masterImageObjectSchema>;
export type MasterRectObject = z.infer<typeof masterRectObjectSchema>;
export type MasterLineObject = z.infer<typeof masterLineObjectSchema>;
export type MasterObject = z.infer<typeof masterObjectSchema>;
export type SlideNumberOptions = z.infer<typeof slideNumberOptionsSchema>;
export type SlideMasterBackground = z.infer<typeof slideMasterBackgroundSchema>;
export type SlideMasterMargin = z.infer<typeof slideMasterMarginSchema>;
export type SlideMasterOptions = z.infer<typeof slideMasterOptionsSchema>;
