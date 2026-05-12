import { describe, expect, it } from "vitest";
import { escapeHtml, highlightXml } from "./htmlTemplates.ts";

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml('& < > " \'')).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  it("double-encodes already-escaped entities (input must be raw text)", () => {
    // intentional: re-running escape would double-encode, which is correct.
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  it("passes plain text through unchanged", () => {
    expect(escapeHtml("Hello, world.")).toBe("Hello, world.");
  });
});

describe("highlightXml", () => {
  it("wraps tag names in tk-tag spans", () => {
    const out = highlightXml(`<Text>hello</Text>`);
    expect(out).toContain(`<span class="tk-tag">Text</span>`);
  });

  it("wraps attribute names + string values", () => {
    const out = highlightXml(`<Foo bar="baz" />`);
    expect(out).toContain(`<span class="tk-attr">bar</span>`);
    expect(out).toContain(`<span class="tk-str">&quot;baz&quot;</span>`);
  });

  it("wraps {placeholder} interpolations", () => {
    const out = highlightXml(`<Text>{name}</Text>`);
    expect(out).toContain(`<span class="tk-interp">{name}</span>`);
  });

  it("leaves no raw < or > in output text content", () => {
    const out = highlightXml(`<Foo a="b">x</Foo>`);
    expect(out).not.toMatch(/<[A-Za-z][^>]*?>(?![^<]*<\/span)/);
  });

  it("escapes hostile content in attribute values", () => {
    const out = highlightXml(`<Foo a="&lt;evil&gt;" />`);
    expect(out).toContain(`&amp;lt;evil&amp;gt;`);
  });
});
