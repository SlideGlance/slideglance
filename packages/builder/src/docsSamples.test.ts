import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildPptx } from "./buildPptx.ts";
import type { Diagnostic } from "./diagnostics.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_MD_PATH = resolve(__dirname, "../docs/nodes.md");

type Sample = { index: number; section: string; xml: string };

function extractXmlSamples(md: string): Sample[] {
  const lines = md.split("\n");
  const samples: Sample[] = [];
  let currentSection = "(top)";
  let inBlock = false;
  let buf: string[] = [];
  let index = 0;
  for (const line of lines) {
    const heading = line.match(/^###\s+(?:\d+\.\s+)?(.+)$/);
    if (heading && !inBlock) {
      currentSection = heading[1].trim();
      continue;
    }
    if (!inBlock && line.trim() === "```xml") {
      inBlock = true;
      buf = [];
      continue;
    }
    if (inBlock && line.trim() === "```") {
      inBlock = false;
      samples.push({
        index: index++,
        section: currentSection,
        xml: buf.join("\n"),
      });
      continue;
    }
    if (inBlock) buf.push(line);
  }
  return samples;
}

// Icon: requires @resvg/resvg-wasm which is not resolvable under tsx/vitest
//       (the dist build path covers it; see issue #646 — out of scope).
// Image: the sample fetches a real URL via prefetchImageSize, which would make
//        the test depend on network availability. Skip to keep the test hermetic.
// Slots for long or structured content / Conditionals & Iteration / File format:
//        xml snippets here are intentionally partial (showing syntax only, not
//        standalone docs). End-to-end coverage for the directives lives in
//        `parseXml/templates.test.ts`.
const SKIP_SECTIONS = new Set([
  "Icon",
  "Image",
  "Slots for long or structured content",
  "Conditionals & Iteration (`<If>`, `<Choose>`, `<Foreach>`)",
  "File format",
]);

// Samples that use <Import src="..."/> require a caller-supplied resolver that
// the test has no way to mock; skip them.
// Samples rooted at <Fragment> are import-file snippets, not standalone documents.
function usesImport(xml: string): boolean {
  return /<Import\b/.test(xml) || /^\s*<Fragment\b/.test(xml);
}

const md = readFileSync(NODES_MD_PATH, "utf8");
const samples = extractXmlSamples(md);

describe("docs/nodes.md xml samples", () => {
  it("には少なくとも 1 つの xml サンプルが含まれる", () => {
    expect(samples.length).toBeGreaterThan(0);
  });

  for (const sample of samples) {
    const skip = SKIP_SECTIONS.has(sample.section) || usesImport(sample.xml);
    const title = `[${sample.index}] ${sample.section} の xml サンプルが diagnostics なしで buildPptx できる`;
    (skip ? it.skip : it)(title, async () => {
      const { diagnostics } = await buildPptx(sample.xml, { w: 1280, h: 720 });
      // Deprecation warnings from legacy attribute forms in samples are allowed.
      // Filter them so that only hard errors (parse failures, schema violations) cause test failure.
      const hardErrors = (diagnostics as Diagnostic[]).filter(
        (d) => d.code !== "DEPRECATED_ATTRIBUTE",
      );
      expect(hardErrors).toEqual([]);
    });
  }
});
