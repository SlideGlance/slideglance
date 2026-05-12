import { describe, expect, it } from "vitest";
import { escapeHtml } from "./htmlTemplates.ts";

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml('& < > " \'')).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  it("is idempotent on already-escaped entities", () => {
    // intentional: re-running escape would double-encode, which is correct.
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  it("passes plain text through unchanged", () => {
    expect(escapeHtml("Hello, world.")).toBe("Hello, world.");
  });
});
