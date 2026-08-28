import type { BuilderNode, PositionedNode } from "../types.ts";
import type { BuildContext } from "../buildContext.ts";

/**
 * Decides whether a text frame may carry PowerPoint's "Resize shape to fit
 * text" (`<a:spAutoFit/>`).
 *
 * The property is a claim about the box: its height is a function of the
 * text inside it. Consumers act on that claim — LibreOffice recalculates
 * on load, PowerPoint on the first edit — so a frame whose height was
 * authored (`h="60"`, `h="50%"`, `minH`, `flexGrow`) or stretched by its
 * parent's cross-axis alignment collapses to one line the moment anything
 * touches it. Both conditions below must hold:
 *
 * 1. The author asked for no particular height.
 * 2. The height Yoga settled on equals the height the text measured to,
 *    which rules out a frame stretched to a taller sibling.
 *
 * The measured height comes from the leaf's own Yoga measure callback
 * ({@link recordMeasuredLeafHeight}), so this compares the same numbers the
 * layout used rather than re-deriving them.
 */
function heightFollowsContent(
  pom: BuilderNode,
  layoutHeight: number,
  ctx: BuildContext,
): boolean {
  const sized = pom as {
    h?: unknown;
    minH?: unknown;
    maxH?: unknown;
    flexGrow?: unknown;
  };
  if (
    sized.h !== undefined ||
    sized.minH !== undefined ||
    sized.maxH !== undefined ||
    sized.flexGrow !== undefined
  ) {
    return false;
  }

  const measured = ctx.measuredLeafHeights.get(pom);
  if (measured === undefined) return false;
  // The measure callback reports the text's own height; Yoga adds the
  // node's vertical padding on top of it to reach the box height.
  const contentHeight = layoutHeight - verticalPadding(pom);
  // Yoga rounds computed layout to the pixel grid, so an exact compare
  // would reject frames whose height did come from their own text.
  return Math.abs(contentHeight - measured) <= 1;
}

/** Sum of a node's top and bottom padding in px. */
function verticalPadding(pom: BuilderNode): number {
  const padding = (pom as { padding?: unknown }).padding;
  if (padding === undefined) return 0;
  if (typeof padding === "number") return padding * 2;
  const p = padding as { top?: number; bottom?: number };
  return (p.top ?? 0) + (p.bottom ?? 0);
}

/**
 * Records what a leaf's measure callback last reported, keyed by the node.
 * Called from the measure callback itself; a later stretch or explicit
 * height overwrites the layout result but never this value, which is what
 * makes the comparison above meaningful.
 */
export function recordMeasuredLeafHeight(
  node: BuilderNode,
  heightPx: number,
  ctx: BuildContext,
): void {
  ctx.measuredLeafHeights.set(node, heightPx);
}

/** Positioned leaf carrying the autofit decision for the renderer. */
export function positionTextFrame(
  pom: BuilderNode,
  absoluteX: number,
  absoluteY: number,
  layout: { width: number; height: number },
  ctx: BuildContext,
): PositionedNode {
  return {
    ...pom,
    x: absoluteX,
    y: absoluteY,
    w: layout.width,
    h: layout.height,
    heightFollowsContent: heightFollowsContent(pom, layout.height, ctx),
  } as PositionedNode;
}
