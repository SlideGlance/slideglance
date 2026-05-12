// Build script for the playground sample decks.
//
// Compiles every `<deck>/main.sgx` under this directory with
// `@slideglance/builder`, then copies the rendered `.pptx` files into
// `apps/web-playground/public/samples/` so the playground UI can fetch
// them at runtime.
//
// Run from the workspace root or this directory:
//   pnpm --filter @slideglance/playground-samples run build

import { promises as fs, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPptx, type ImportResolver } from "@slideglance/builder";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(
  here,
  "..",
  "..",
  "apps",
  "web-playground",
  "public",
  "samples",
);

interface DeckSpec {
  /** Folder name under this directory containing `main.sgx`. */
  slug: string;
  /** Slide canvas, in EMU-free pt (matches `buildPptx`'s slideSize). */
  size: { w: number; h: number };
  /** Output `.pptx` filename in the web-playground samples folder. */
  outputName: string;
}

const DECKS: DeckSpec[] = [
  { slug: "pitch", size: { w: 1280, h: 720 }, outputName: "01-pitch.pptx" },
  {
    slug: "editorial",
    size: { w: 793, h: 1122 },
    outputName: "02-editorial.pptx",
  },
  {
    slug: "tech-spec",
    size: { w: 1280, h: 720 },
    outputName: "03-tech-spec.pptx",
  },
  {
    slug: "workshop",
    size: { w: 1280, h: 720 },
    outputName: "04-workshop.pptx",
  },
];

const fsResolveImport: ImportResolver = (src, fromPath) => {
  const baseDir = fromPath ? path.dirname(fromPath) : here;
  const absolute = path.resolve(baseDir, src);
  return { content: readFileSync(absolute, "utf8"), path: absolute };
};

async function buildDeck(spec: DeckSpec): Promise<void> {
  const entry = path.join(here, spec.slug, "main.sgx");
  const rawEntry = await fs.readFile(entry, "utf8");
  const { pptx, diagnostics, lintReport } = await buildPptx(rawEntry, spec.size, {
    textMeasurement: "auto",
    resolveImport: fsResolveImport,
    sourcePath: entry,
    equalize: true,
    lint: { enabled: true, ruleset: "recommended" },
  });
  if (diagnostics.length > 0) {
    console.log(`  [${spec.slug}] diagnostics:`);
    for (const d of diagnostics) {
      console.log(`    [${d.severity ?? "warn"}] [${d.code}] ${d.message}`);
    }
  }
  if (lintReport) {
    const s = lintReport.summary;
    console.log(
      `  [${spec.slug}] lint: ${s.error} error · ${s.warn} warn · ${s.info} info`,
    );
  }
  const bytes = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  const outPath = path.join(outDir, spec.outputName);
  await fs.writeFile(outPath, bytes);
  console.log(
    `  [${spec.slug}] wrote ${path.relative(here, outPath)} (${bytes.byteLength} bytes)`,
  );
}

async function main(): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  console.log(`Building ${DECKS.length} sample decks…`);
  for (const spec of DECKS) {
    console.log(`\n→ ${spec.slug}`);
    await buildDeck(spec);
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
