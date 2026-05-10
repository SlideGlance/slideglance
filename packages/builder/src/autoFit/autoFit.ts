
import type { BuilderNode } from "../types.ts";
import type { BuildContext } from "../buildContext.ts";
import type { YogaNodeMap } from "../calcYogaLayout/types.ts";
import { calcYogaLayout } from "../calcYogaLayout/calcYogaLayout.ts";
import { freeYogaTree } from "../shared/freeYogaTree.ts";
import { reduceTableRowHeight } from "./strategies/reduceTableRowHeight.ts";
import { reduceFontSize } from "./strategies/reduceFontSize.ts";
import { reduceGapAndPadding } from "./strategies/reduceGapAndPadding.ts";
import { uniformScale } from "./strategies/uniformScale.ts";

/** Overflow tolerance margin (0.5%). */
const OVERFLOW_TOLERANCE = 1.005;

type Strategy = (node: BuilderNode, targetRatio: number) => boolean;

const strategies: Strategy[] = [
  reduceTableRowHeight,
  reduceFontSize,
  reduceGapAndPadding,
  uniformScale,
];

/** Overflow measurement result. */
interface OverflowResult {
  contentHeight: number;
  isOverflowing: boolean;
  /** slideHeight / contentHeight ( < 1 when overflowing). */
  targetRatio: number;
  map: YogaNodeMap;
}

/**
 * Run a layout pass and report whether the content overflows the slide.
 */
async function measureOverflow(
  node: BuilderNode,
  slideSize: { w: number; h: number },
  ctx: BuildContext,
): Promise<OverflowResult> {
  const map = await calcYogaLayout(node, slideSize, ctx);
  const contentHeight = calcContentHeight(map, node);
  const isOverflowing = contentHeight > slideSize.h * OVERFLOW_TOLERANCE;
  const targetRatio = isOverflowing ? slideSize.h / contentHeight : 1;
  return { contentHeight, isOverflowing, targetRatio, map };
}

/**
 * Compute the content occupancy height from the yoga layout result.
 *
 * Reduces the root's children to `max(top + height)` and adds the
 * root's `paddingBottom`. This sidesteps `h="max"` / `flexGrow` and
 * returns the precise content height.
 */
function calcContentHeight(map: YogaNodeMap, node: BuilderNode): number {
  const rootYoga = map.get(node);
  if (!rootYoga) {
    throw new Error("YogaNode not found in map for root node");
  }

  const childCount = rootYoga.getChildCount();
  if (childCount === 0) {
    return rootYoga.getComputedHeight();
  }

  let maxBottom = 0;
  for (let i = 0; i < childCount; i++) {
    const child = rootYoga.getChild(i);
    const childLayout = child.getComputedLayout();
    const bottom = childLayout.top + childLayout.height;
    if (bottom > maxBottom) {
      maxBottom = bottom;
    }
  }

  // Add the root's paddingBottom.
  const paddingBottom = rootYoga.getComputedPadding(2); // EDGE_BOTTOM = 2
  return maxBottom + paddingBottom;
}

/**
 * Detect slide overflow and shrink content step-by-step until it fits.
 *
 * Adjustment priority:
 *   1. Shrink table row heights
 *   2. Shrink font sizes
 *   3. Shrink gap / padding
 *   4. Uniform downscale (fallback)
 */
export async function autoFitSlide(
  node: BuilderNode,
  slideSize: { w: number; h: number },
  ctx: BuildContext,
): Promise<YogaNodeMap> {
  // Phase 1: apply strategies in order until the slide fits.
  for (const strategy of strategies) {
    const result = await measureOverflow(node, slideSize, ctx);
    freeYogaTree(result.map);

    if (!result.isOverflowing) {
      break;
    }

    const changed = strategy(node, result.targetRatio);
    if (!changed) {
      continue;
    }
  }

  // Phase 2: produce the final layout and verify overflow.
  return finalizeLayout(node, slideSize, ctx);
}

/**
 * Compute the final layout. Emit a warning diagnostic if overflow
 * remains after all adjustment strategies.
 */
async function finalizeLayout(
  node: BuilderNode,
  slideSize: { w: number; h: number },
  ctx: BuildContext,
): Promise<YogaNodeMap> {
  const result = await measureOverflow(node, slideSize, ctx);
  if (result.isOverflowing) {
    ctx.diagnostics.add(
      "AUTOFIT_OVERFLOW",
      `autoFit: content height (${Math.round(result.contentHeight)}px) exceeds slide height (${slideSize.h}px) after all adjustments.`,
    );
  }
  freeYogaTree(result.map);

  return calcYogaLayout(node, slideSize, ctx);
}
