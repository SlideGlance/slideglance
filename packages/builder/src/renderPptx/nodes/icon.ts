import type { PositionedNode } from "../../types.ts";
import type { RenderContext } from "../types.ts";
import { pxToIn } from "../units.ts";
import { builderObjectName } from "../utils/objectName.ts";

type IconPositionedNode = Extract<PositionedNode, { type: "icon" }>;

export function renderIconNode(
  node: IconPositionedNode,
  ctx: RenderContext,
): void {
  const objectName = builderObjectName(node);
  // Draw background shape when variant is specified
  if (node.variant) {
    const isCircle = node.variant.startsWith("circle");
    const isFilled = node.variant.endsWith("-filled");
    const bgColor = node.backgroundColor ?? "#E0E0E0";
    const colorValue = bgColor.replace(/^#/, "");

    const shapeType = isCircle ? "ellipse" : "roundRect";
    const shapeOptions: Record<string, unknown> = {
      x: pxToIn(node.bgX ?? node.x),
      y: pxToIn(node.bgY ?? node.y),
      w: pxToIn(node.bgW ?? node.w),
      h: pxToIn(node.bgH ?? node.h),
      fill: isFilled ? { color: colorValue } : { type: "none" as const },
      line: isFilled ? undefined : { color: colorValue, width: 1.5 },
      rectRadius: isCircle ? undefined : 0.1,
      ...(objectName ? { objectName } : {}),
    };

    ctx.slide.addShape(shapeType, shapeOptions);
  }

  ctx.slide.addImage({
    data: node.iconImageData,
    x: pxToIn(node.iconX ?? node.x),
    y: pxToIn(node.iconY ?? node.y),
    w: pxToIn(node.iconW ?? node.w),
    h: pxToIn(node.iconH ?? node.h),
    ...(objectName ? { objectName } : {}),
    ...(node.isDecorative
      ? { altText: "" }
      : node.altText !== undefined
        ? { altText: node.altText }
        : {}),
  });
}
