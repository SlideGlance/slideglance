import { describe, expect, it } from "vitest";

import { injectSourceAttrs } from "./sourceInjection.ts";

/** `__sourceLine` / `__sourceEndLine` of the first tag on a 1-based line. */
function span(
  injected: string,
  line: number,
): { start: number; end: number | undefined } {
  const text = injected.split("\n")[line - 1] ?? "";
  const m = /__sourceLine="(\d+)"(?: __sourceEndLine="(\d+)")?/.exec(text);
  if (!m) throw new Error(`no injected attributes on line ${line}: ${text}`);
  return {
    start: Number(m[1]),
    end: m[2] === undefined ? undefined : Number(m[2]),
  };
}

describe("injectSourceAttrs", () => {
  it("records the line an element opens and closes on", () => {
    const xml = ["<Root>", "  <A>", "    text", "  </A>", "</Root>"].join("\n");
    const out = injectSourceAttrs(xml, undefined);
    expect(span(out, 1)).toEqual({ start: 1, end: 5 });
    expect(span(out, 2)).toEqual({ start: 2, end: 4 });
  });

  it("closes a self-closing element on its own line", () => {
    const out = injectSourceAttrs(
      ["<Root>", "  <A/>", "</Root>"].join("\n"),
      undefined,
    );
    expect(span(out, 2)).toEqual({ start: 2, end: 2 });
  });

  it("keeps line numbers past a multi-line comment", () => {
    // The comment is masked before the tags are scanned so a `>` inside
    // it cannot close a tag. Masking it away with spaces would also
    // remove its newlines, and every line after it would then be
    // counted short — which put an element's closing line before its
    // opening one.
    const xml = [
      "<Root>",
      "  <!-- one",
      "       two",
      "       three -->",
      "  <A>",
      "    text",
      "  </A>",
      "</Root>",
    ].join("\n");
    const out = injectSourceAttrs(xml, undefined);
    expect(span(out, 5)).toEqual({ start: 5, end: 7 });
    expect(span(out, 1)).toEqual({ start: 1, end: 8 });
  });

  it("does not read a tag out of a comment", () => {
    const xml = [
      "<Root>",
      "  <!-- <A> not markup -->",
      "  <B/>",
      "</Root>",
    ].join("\n");
    const out = injectSourceAttrs(xml, undefined);
    expect(out).not.toContain("<!-- <A __sourceLine");
    expect(span(out, 3)).toEqual({ start: 3, end: 3 });
  });

  it("leaves an unclosed element without an end line rather than guessing", () => {
    const out = injectSourceAttrs(
      ["<Root>", "  <A>", "</Root>"].join("\n"),
      undefined,
    );
    expect(span(out, 2).end).toBeUndefined();
  });
});
