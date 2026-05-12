import { describe, expect, it } from "vitest";
import { renderElementPage, renderIndexPage } from "./html.ts";
import { buildReferenceModel } from "./walkRegistry.ts";

describe("renderElementPage(Text)", () => {
  const model = buildReferenceModel();
  const text = model.nodes.find((n) => n.tag === "Text")!;
  const html = renderElementPage(text, model);

  it("has the correct <title>", () => {
    expect(html).toContain(
      "<title>&lt;Text&gt; · Builder XML Reference</title>",
    );
  });

  it("renders FOUC theme bootstrap script", () => {
    expect(html).toContain(`localStorage.getItem("sg-theme")`);
  });

  it("includes a skip-link as first focusable element", () => {
    const skipIdx = html.indexOf('class="skip-link"');
    const navIdx = html.indexOf("<nav");
    expect(skipIdx).toBeGreaterThan(-1);
    expect(skipIdx).toBeLessThan(navIdx);
  });

  it("wraps the sidebar in nav[aria-label]", () => {
    expect(html).toContain(
      `<nav class="ref-sidebar" aria-label="Builder elements">`,
    );
  });

  it("marks the current page with aria-current=page", () => {
    expect(html).toMatch(/href="\.\.\/text\/"\s+aria-current="page"/);
  });

  it("includes Visual nodes and Meta & composition group headers", () => {
    expect(html).toContain(">Visual nodes</h2>");
    expect(html).toContain(">Meta &amp; composition</h2>");
  });

  it("renders an attribute table with bold and color rows", () => {
    expect(html).toContain("<code>bold</code>");
    expect(html).toContain("<code>color</code>");
  });

  it("renders Used by section listing VStack", () => {
    expect(html).toContain(`href="../vstack/"`);
  });

  it("renders the Example heading exactly once (no synopsis duplication)", () => {
    const matches = html.match(/<h2[^>]*>Example<\/h2>/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("renders the xml-snippet exactly once (matches single Example block)", () => {
    const snippets = html.match(/<pre class="xml-snippet">/g) ?? [];
    expect(snippets).toHaveLength(1);
  });

  it("renders See also section with at least one link", () => {
    expect(html).toMatch(/<h2[^>]*>See also/);
  });

  it("renders Source section linking to compiled/index.ts", () => {
    expect(html).toMatch(
      /blob\/main\/packages\/builder\/src\/registry\/compiled\/index\.ts#L\d+/,
    );
  });
});

describe("renderElementPage(SlideGlance) — empty usedBy branch", () => {
  const model = buildReferenceModel();
  const node = model.nodes.find((n) => n.tag === "SlideGlance")!;
  const html = renderElementPage(node, model);

  it("renders top-level fallback for usedBy", () => {
    expect(html).toContain("Top-level");
  });

  it("omits See also section when no entry exists", () => {
    expect(html).not.toMatch(/<h2[^>]*>See also/);
  });
});

describe("renderIndexPage", () => {
  const model = buildReferenceModel();
  const html = renderIndexPage(model);

  it("renders 29 cards total (16 nodes + 13 meta)", () => {
    const cards = html.match(/class="ref-card"/g) ?? [];
    expect(cards).toHaveLength(29);
  });

  it("includes data-haystack on every card with lowercased content", () => {
    const matches = [...html.matchAll(/data-haystack="([^"]+)"/g)];
    expect(matches).toHaveLength(29);
    for (const m of matches) {
      const haystack = m[1];
      expect(haystack).toBe(haystack.toLowerCase());
    }
  });

  it("includes the filter input with id=ref-q", () => {
    expect(html).toContain('id="ref-q"');
  });

  it("renders empty-state region with aria-live=polite", () => {
    expect(html).toContain('aria-live="polite"');
  });

  it("includes both group headings", () => {
    expect(html).toContain(">Visual nodes</h2>");
    expect(html).toContain(">Meta &amp; composition</h2>");
  });
});
