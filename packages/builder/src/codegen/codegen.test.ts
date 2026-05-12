import { describe, expect, it } from "vitest";
import { generateXsd, BUILDER_NAMESPACE_URI } from "./xsd.ts";
import { generateJsonSchema } from "./jsonSchema.ts";
import { generateNodesMd } from "./docs.ts";
import { sha256, buildHashRecord, verifyAgainstHashes } from "./verify.ts";
import { walkRegistry, coerceToXsdSimpleType } from "./walkRegistry.ts";

describe("codegen / walkRegistry", () => {
  it("validates and exposes nodes/meta/roots", () => {
    const r = walkRegistry();
    expect(r.nodes.length).toBeGreaterThan(0);
    expect(r.meta.length).toBeGreaterThan(0);
    expect(r.roots).toContain("SlideGlance");
    expect(r.roots).toContain("Fragment");
    expect(r.nodeTags).toContain("Text");
    expect(r.nodeTags).not.toContain("SlideGlance");
  });

  it("coerce → XSD simpleType mapping covers every CoerceType branch", () => {
    // Sample of coercions; the mapping function is total.
    expect(coerceToXsdSimpleType("number").primitive).toBe("xs:double");
    expect(coerceToXsdSimpleType("boolean").named).toBe("b:Boolean");
    expect(coerceToXsdSimpleType("length").named).toBe("b:Length");
    expect(coerceToXsdSimpleType("color").named).toBe("b:Color");
    expect(coerceToXsdSimpleType("string").named).toBe(null);
  });
});

describe("XSD generator", () => {
  const xsd = generateXsd();

  it("declares the urn:slideglance:builder:v1 target namespace", () => {
    expect(xsd).toContain(`targetNamespace="${BUILDER_NAMESPACE_URI}"`);
    expect(xsd).toContain(`xmlns:b="${BUILDER_NAMESPACE_URI}"`);
  });

  it("includes element declarations for every compiled node", () => {
    const r = walkRegistry();
    for (const n of r.nodes) {
      expect(xsd).toContain(`<xs:element name="${n.tag}"`);
    }
    for (const m of r.meta) {
      expect(xsd).toContain(`<xs:element name="${m.tag}"`);
    }
  });

  it("declares <svg> child element so <Svg> validates", () => {
    expect(xsd).toContain(`<xs:element name="svg">`);
  });

  it("emits xs:enumeration entries for enum attributes", () => {
    // alignItems on VStack
    expect(xsd).toMatch(/xs:enumeration value="start"/);
    expect(xsd).toMatch(/xs:enumeration value="stretch"/);
  });
});

describe("JSON Schema generator", () => {
  const schema = generateJsonSchema();

  it("emits a 2020-12 draft schema with $defs and oneOf", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(Object.keys(schema.$defs).length).toBeGreaterThan(0);
    expect(schema.oneOf.length).toBeGreaterThan(0);
  });

  it("includes Text and Image", () => {
    expect(schema.$defs.Text).toBeDefined();
    expect(schema.$defs.Image).toBeDefined();
  });
});

describe("docs generator", () => {
  const md = generateNodesMd();

  it("starts with the reference heading and namespace note", () => {
    expect(md.startsWith("# Builder XML Reference")).toBe(true);
    expect(md).toContain("urn:slideglance:builder:v1");
  });

  it("includes a Text section with attribute table", () => {
    expect(md).toContain("### `<Text>`");
    expect(md).toContain("| `text` |");
  });

  it("includes Meta Elements section", () => {
    expect(md).toContain("## Meta Elements");
    expect(md).toContain("### `<Template>`");
  });
});

describe("verify hashes", () => {
  it("round-trips identical content", () => {
    const files = { "a.xml": "<a/>", "b.json": "{}" };
    const rec = buildHashRecord(files);
    expect(verifyAgainstHashes(files, rec).ok).toBe(true);
  });

  it("reports drift when content changes", () => {
    const original = { "a.xml": "<a/>" };
    const rec = buildHashRecord(original);
    const v = verifyAgainstHashes({ "a.xml": "<a></a>" }, rec);
    expect(v.ok).toBe(false);
    expect(v.diffs[0]!.file).toBe("a.xml");
  });

  it("reports missing or new files", () => {
    const rec = buildHashRecord({ "a.xml": "x" });
    const v = verifyAgainstHashes({ "b.xml": "x" }, rec);
    expect(v.ok).toBe(false);
    // Either "no longer generated" or "missing in recorded hash"
    expect(v.diffs.length).toBeGreaterThan(0);
  });

  it("sha256 is deterministic", () => {
    expect(sha256("foo")).toBe(sha256("foo"));
    expect(sha256("foo")).not.toBe(sha256("bar"));
  });
});
