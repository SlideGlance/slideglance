/**
 * Which slides a rebuild has to repaint.
 *
 * Kept out of `preview.ts` because it is pure — no `vscode`, no panel
 * state — and because getting it wrong is silent: the preview looks
 * right and only misbehaves when something is clicked.
 */

import type { BuilderSourceMap } from "@slideglance/builder";

/** The parts of a build the id-range comparison needs. */
export interface SlideIdShape {
  /** Slide-root `__nodeId`s, deck order. */
  slideNodeIds: (number | undefined)[];
  /** Highest `__nodeId` the parse allocated. */
  maxNodeId: number;
}

/**
 * Compute the slide indices whose source XML changed between two
 * successful renders. Returns:
 *
 *  - `undefined`: deck-wide structure changed (slide count differed,
 *    masters changed, etc.) — caller sends a full reload, viewer
 *    flushes the entire cache.
 *  - `[]`: nothing changed (caller should not happen here — that case
 *    is `BuildNoop`, not a successful build with diff `[]`).
 *  - `[i, j, …]`: 1-based indices whose content hash differs. Caller
 *    forwards exactly these to the viewer for selective cache
 *    invalidation.
 */
export function diffSlides(
  prev: { commonHash: string; slideHashes: string[] } & SlideIdShape,
  next: { commonHash: string; slideHashes: string[] } & SlideIdShape,
): number[] | undefined {
  if (
    prev.commonHash !== next.commonHash ||
    prev.slideHashes.length !== next.slideHashes.length
  ) {
    return undefined;
  }
  const out = new Set<number>(changedByHash(prev, next));
  // A page whose own source did not change can still be holding a
  // stale picture.
  //
  // `node#N` — the name the renderer writes into every shape, and the
  // only handle a click has on the source — is allocated in document
  // order on each parse. Add one element to page 3 and every id after
  // it slides by one, while pages 4 onward keep the SVG they were
  // already showing. Their shapes then carry names that resolve, in the
  // new map, to somebody else's markup: a click lands in a different
  // chapter entirely, which is worse than landing nowhere.
  //
  // Ids run in deck order, so each page owns a contiguous range and a
  // page is safe exactly when its range did not move.
  for (const i of shiftedIdRanges(prev, next)) out.add(i);
  return [...out].sort((a, b) => a - b);
}

/**
 * 1-based indices whose source hash differs.
 *
 * Separate from [`diffSlides`] because the in-flight notice fires
 * before the build runs, and the node ids it also needs to compare do
 * not exist yet. Marking a page as rebuilding when it turns out only
 * to need renumbering costs a spinner; the reverse would leave a stale
 * page unmarked.
 */
export function changedByHash(
  prev: { slideHashes: string[] },
  next: { slideHashes: string[] },
): number[] {
  const out: number[] = [];
  for (let i = 0; i < next.slideHashes.length; i++) {
    if (prev.slideHashes[i] !== next.slideHashes[i]) out.push(i + 1);
  }
  return out;
}

/**
 * 1-based indices whose `node#N` range differs between two builds.
 * Both arguments must already be known to describe decks of the same
 * length.
 */
export function shiftedIdRanges(
  prev: SlideIdShape,
  next: SlideIdShape,
): number[] {
  const out: number[] = [];
  const count = next.slideNodeIds.length;
  const endOf = (snapshot: SlideIdShape, i: number): number | undefined =>
    i + 1 < count ? snapshot.slideNodeIds[i + 1] : snapshot.maxNodeId + 1;

  for (let i = 0; i < count; i++) {
    const prevStart = prev.slideNodeIds[i];
    const nextStart = next.slideNodeIds[i];
    // A page the parse gave no id to has no shapes to click; leaving it
    // out keeps an unclickable page from being repainted every build.
    if (prevStart === undefined && nextStart === undefined) continue;
    if (prevStart !== nextStart || endOf(prev, i) !== endOf(next, i)) {
      out.push(i + 1);
    }
  }
  return out;
}

/** Highest id the parse allocated, or 0 for a deck with no positions. */
export function maxNodeId(sourceMap: BuilderSourceMap | undefined): number {
  if (!sourceMap) return 0;
  let max = 0;
  for (const id of sourceMap.keys()) if (id > max) max = id;
  return max;
}
