// Build script for the @slideglance/builder XML Reference deck.
//
// Usage (from repo root):
//   pnpm --filter @slideglance/builder exec tsx ../../examples/builder-reference/build.ts
//
// Or, simpler, from the example directory:
//   pnpm dlx tsx build.ts
//
// Reads main.sgx and resolves <Import src="..."/> on the fly. Builder's
// built-in equalize-dimensions preprocessor (`equalize: true`) resolves
// every `auto` / `auto:KEY` / `capbar:CLASS` sentinel into a concrete
// pixel value before parsing. Finally, calls buildPptx and writes
// output/reference.pptx.

import { promises as fs, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPptx, type ImportResolver } from "@slideglance/builder";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "main.sgx");
const outputDir = path.join(here, "output");
const outputPath = path.join(outputDir, "reference.pptx");

const fsResolveImport: ImportResolver = (src, fromPath) => {
  const baseDir = fromPath ? path.dirname(fromPath) : here;
  const absolute = path.resolve(baseDir, src);
  return { content: readFileSync(absolute, "utf8"), path: absolute };
};

async function main(): Promise<void> {
  console.log("Building deck…");
  const rawEntry = await fs.readFile(entry, "utf8");
  await fs.mkdir(outputDir, { recursive: true });

  const { pptx, diagnostics } = await buildPptx(
    rawEntry,
    { w: 793, h: 1122 },
    {
      textMeasurement: "auto",
      resolveImport: fsResolveImport,
      sourcePath: entry,
      equalize: true,
    },
  );

  if (diagnostics.length > 0) {
    console.log(`\nDiagnostics (${diagnostics.length}):`);
    for (const d of diagnostics) {
      console.log(`  [${d.code}] ${d.message}`);
    }
  }

  const bytes = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  await fs.writeFile(outputPath, bytes);
  console.log(`\nWrote ${outputPath} (${bytes.byteLength} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
