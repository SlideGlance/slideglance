import type { BuilderNode, PositionedNode } from "./types.ts";

/**
 * Re-applies a previous build's layout to a freshly parsed slide.
 *
 * Laying a slide out is what a build spends its time on — the text
 * measurement and Yoga passes run per slide and dominate everything
 * else (a twenty-page deck spends thirteen seconds there and 160 ms
 * writing the zip). A slide whose source did not change lays out to the
 * same boxes, so the caller can hand back the boxes it already has.
 *
 * The one thing that must come from the fresh parse is `__nodeId`: the
 * source map is rebuilt every parse and the ids are positional, so a
 * cached tree's ids belong to the previous parse and would send
 * click-to-source to the wrong line. Everything else in the two trees is
 * identical by the caller's own precondition — it only reuses a slide
 * whose content hash matched.
 *
 * Returns undefined when the trees do not line up. That should not
 * happen for a matched hash; treating it as a cache miss rather than an
 * error means a wrong guess costs time, never a broken deck.
 */
export function reuseSlideLayout(
  fresh: BuilderNode,
  cached: PositionedNode,
): PositionedNode | undefined {
  if (fresh.type !== cached.type) return undefined;

  const freshChildren = childrenOf<BuilderNode>(fresh);
  const cachedChildren = childrenOf<PositionedNode>(cached);
  if (freshChildren.length !== cachedChildren.length) return undefined;

  const grafted: Record<string, unknown> = { ...cached };
  if (fresh.__nodeId !== undefined) {
    grafted.__nodeId = fresh.__nodeId;
  } else {
    delete grafted.__nodeId;
  }

  if (freshChildren.length > 0) {
    const children: PositionedNode[] = [];
    for (const [i, child] of freshChildren.entries()) {
      const cachedChild = cachedChildren[i];
      if (!cachedChild) return undefined;
      const graftedChild = reuseSlideLayout(child, cachedChild);
      if (!graftedChild) return undefined;
      children.push(graftedChild);
    }
    grafted.children = children;
  }

  return grafted as PositionedNode;
}

function childrenOf<T>(node: object): T[] {
  const children = (node as { children?: unknown }).children;
  return Array.isArray(children) ? (children as T[]) : [];
}
