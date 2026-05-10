import type { PositionedNode, ShadowStyle } from "../../types.ts";
import { getImageData } from "../../shared/measureImage.ts";
import type { RenderContext } from "../types.ts";
import { pxToIn, pxToPt } from "../units.ts";
import { validateImageSrc } from "../nodes/image.ts";

/**
 * Returns true when a text node's background/border/borderRadius/shadow should be
 * rendered as a single shape-with-text object (one PPTX object) instead of the
 * default two-object pattern (outer shape + separate text). backgroundImage still
 * requires the split path because the image must be layered between bg and border.
 */
export function shouldEmbedBackgroundInText(node: PositionedNode): boolean {
  if (node.type !== "text") return false;
  if (node.backgroundImage) return false;
  const hasBg = Boolean(node.backgroundColor);
  const hasBorder = Boolean(
    node.border &&
    (node.border.color !== undefined ||
      node.border.width !== undefined ||
      node.border.dashType !== undefined),
  );
  const hasRadius = node.borderRadius !== undefined;
  const hasShadow = Boolean(node.shadow);
  return hasBg || hasBorder || hasRadius || hasShadow;
}

function convertShadow(shadow: ShadowStyle) {
  return {
    type: shadow.type ?? ("outer" as const),
    opacity: shadow.opacity,
    blur: shadow.blur,
    angle: shadow.angle,
    offset: shadow.offset,
    color: shadow.color,
  };
}

/**
 * Draw the node's background color / background image / border / shadow.
 * Shared logic invoked first for every node type.
 *
 * Draw order: backgroundColor -> backgroundImage -> border.
 */
export function renderBackgroundAndBorder(
  node: PositionedNode,
  ctx: RenderContext,
): void {
  const { backgroundColor, backgroundImage, border, borderRadius, shadow } =
    node;
  const hasBackground = Boolean(backgroundColor);
  const hasBackgroundImage = Boolean(backgroundImage);
  const hasBorder = Boolean(
    border &&
    (border.color !== undefined ||
      border.width !== undefined ||
      border.dashType !== undefined),
  );
  const hasShadow = Boolean(shadow);

  if (!hasBackground && !hasBackgroundImage && !hasBorder && !hasShadow) {
    return;
  }

  // When borderRadius is set, use roundRect and compute rectRadius.
  const shapeType = borderRadius
    ? ctx.pptx.ShapeType.roundRect
    : ctx.pptx.ShapeType.rect;

  // Normalise px to a 0-1 value.
  const rectRadius = borderRadius
    ? Math.min((borderRadius / Math.min(node.w, node.h)) * 2, 1)
    : undefined;

  // Without backgroundImage, fall back to a single addShape call.
  if (!hasBackgroundImage) {
    const fill = hasBackground
      ? {
          color: backgroundColor,
          transparency:
            node.opacity !== undefined ? (1 - node.opacity) * 100 : undefined,
        }
      : { type: "none" as const };

    const line = hasBorder
      ? {
          color: border?.color ?? "000000",
          width: border?.width !== undefined ? pxToPt(border.width) : undefined,
          dashType: border?.dashType,
        }
      : { type: "none" as const };

    ctx.slide.addShape(shapeType, {
      x: pxToIn(node.x),
      y: pxToIn(node.y),
      w: pxToIn(node.w),
      h: pxToIn(node.h),
      fill,
      line,
      rectRadius,
      shadow: shadow ? convertShadow(shadow) : undefined,
    });
    return;
  }

  // When backgroundImage exists, draw in pieces: backgroundColor -> backgroundImage -> border.

  // 1. backgroundcolor
  if (hasBackground) {
    ctx.slide.addShape(shapeType, {
      x: pxToIn(node.x),
      y: pxToIn(node.y),
      w: pxToIn(node.w),
      h: pxToIn(node.h),
      fill: {
        color: backgroundColor,
        transparency:
          node.opacity !== undefined ? (1 - node.opacity) * 100 : undefined,
      },
      line: { type: "none" as const },
      rectRadius,
    });
  }

  // 2. backgroundimage
  if (backgroundImage) {
    const guard = ctx.buildContext.security.imageSrcGuard;
    // silent: prefetch already emitted the diagnostic for blocked srcs
    const allowedSrc = guard
      ? validateImageSrc(
          backgroundImage.src,
          guard,
          ctx.buildContext.diagnostics,
          {
            silent: true,
          },
        )
      : backgroundImage.src;

    if (allowedSrc !== undefined) {
      const sizing = backgroundImage.sizing ?? "cover";
      const imageOptions: Record<string, unknown> = {
        x: pxToIn(node.x),
        y: pxToIn(node.y),
        w: pxToIn(node.w),
        h: pxToIn(node.h),
        sizing: {
          type: sizing,
          w: pxToIn(node.w),
          h: pxToIn(node.h),
        },
      };

      const cachedData = getImageData(
        allowedSrc,
        ctx.buildContext.imageDataCache,
      );
      if (cachedData) {
        ctx.slide.addImage({ ...imageOptions, data: cachedData });
      } else {
        ctx.slide.addImage({ ...imageOptions, path: allowedSrc });
      }
    }
  }

  // 3. Border.
  if (hasBorder || hasShadow) {
    ctx.slide.addShape(shapeType, {
      x: pxToIn(node.x),
      y: pxToIn(node.y),
      w: pxToIn(node.w),
      h: pxToIn(node.h),
      fill: { type: "none" as const },
      line: hasBorder
        ? {
            color: border?.color ?? "000000",
            width:
              border?.width !== undefined ? pxToPt(border.width) : undefined,
            dashType: border?.dashType,
          }
        : { type: "none" as const },
      rectRadius,
      shadow: shadow ? convertShadow(shadow) : undefined,
    });
  }
}
