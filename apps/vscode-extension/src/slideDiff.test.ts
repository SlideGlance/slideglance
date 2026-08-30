import { describe, expect, it } from "vitest";

import { changedByHash, diffSlides, maxNodeId } from "./slideDiff.js";

/** A three-page deck: page i owns ids [i*10+1 … i*10+9]. */
function build(hashes: string[], starts: number[], max: number) {
  return {
    commonHash: "deck",
    slideHashes: hashes,
    slideNodeIds: starts as (number | undefined)[],
    maxNodeId: max,
  };
}

describe("diffSlides", () => {
  it("repaints nothing when neither the source nor the ids moved", () => {
    const a = build(["a", "b", "c"], [1, 11, 21], 29);
    expect(diffSlides(a, a)).toEqual([]);
  });

  it("repaints the page whose source changed", () => {
    const prev = build(["a", "b", "c"], [1, 11, 21], 29);
    const next = build(["a", "B", "c"], [1, 11, 21], 29);
    expect(diffSlides(prev, next)).toEqual([2]);
  });

  it("repaints later pages when an earlier page gained a node", () => {
    // Page 1 grew by one element, so every id after it slid by one.
    // Pages 2 and 3 read the same as before, but the SVG they have
    // cached names shapes that now belong to somebody else's markup —
    // clicking one would open a different page in the editor.
    const prev = build(["a", "b", "c"], [1, 11, 21], 29);
    const next = build(["A", "b", "c"], [1, 12, 22], 30);
    expect(diffSlides(prev, next)).toEqual([1, 2, 3]);
  });

  it("leaves a page alone when an id shift lands after it", () => {
    // The last page grew; the pages before it keep their ranges.
    const prev = build(["a", "b", "c"], [1, 11, 21], 29);
    const next = build(["a", "b", "C"], [1, 11, 21], 30);
    expect(diffSlides(prev, next)).toEqual([3]);
  });

  it("gives up on a deck whose shape changed", () => {
    const prev = build(["a", "b", "c"], [1, 11, 21], 29);
    const next = build(["a", "b"], [1, 11], 19);
    expect(diffSlides(prev, next)).toBeUndefined();

    const otherMasters = { ...next, commonHash: "other" };
    expect(
      diffSlides(prev, { ...otherMasters, slideHashes: prev.slideHashes }),
    ).toBeUndefined();
  });

  it("ignores a page the parse gave no id to", () => {
    // Nothing on it can be clicked, so renumbering cannot mislead and
    // repainting it every build would be waste.
    const prev = build(["a", "b"], [undefined as unknown as number, 11], 19);
    const next = build(["a", "b"], [undefined as unknown as number, 11], 19);
    expect(diffSlides(prev, next)).toEqual([]);
  });

  it("returns the repaint list in page order without repeats", () => {
    const prev = build(["a", "b", "c"], [1, 11, 21], 29);
    const next = build(["A", "b", "c"], [1, 12, 22], 30);
    const out = diffSlides(prev, next) ?? [];
    expect(out).toEqual([...out].sort((x, y) => x - y));
    expect(new Set(out).size).toBe(out.length);
  });
});

describe("changedByHash", () => {
  it("reports only the pages whose hash moved", () => {
    expect(
      changedByHash({ slideHashes: ["a", "b"] }, { slideHashes: ["a", "B"] }),
    ).toEqual([2]);
  });
});

describe("maxNodeId", () => {
  it("is 0 without a source map", () => {
    expect(maxNodeId(undefined)).toBe(0);
  });

  it("is the highest id the parse allocated", () => {
    const map = new Map([
      [3, { file: undefined, line: 1 }],
      [17, { file: undefined, line: 2 }],
      [9, { file: undefined, line: 3 }],
    ]);
    expect(maxNodeId(map)).toBe(17);
  });
});
