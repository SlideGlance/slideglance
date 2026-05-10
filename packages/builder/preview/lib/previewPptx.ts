import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pptxToPng } from "../../vrt/lib/pptxToPng.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREVIEW_DIR = path.dirname(__dirname);
const OUTPUT_DIR = path.join(PREVIEW_DIR, "output");

async function main() {
  // Create the output directory.
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log("=== Preview: PPTX to PNG ===\n");

  // 1. Run main.ts to generate the PPTX.
  console.log("1. Running main.ts to generate PPTX...");
  const { execSync } = await import("child_process");
  const rootDir = path.join(PREVIEW_DIR, "..");
  execSync("npx tsx main.ts", { cwd: rootDir, stdio: "inherit" });

  // 2. Copy the generated sample.pptx into preview/output.
  const sourcePptx = path.join(rootDir, "sample.pptx");
  const targetPptx = path.join(OUTPUT_DIR, "sample.pptx");

  if (!fs.existsSync(sourcePptx)) {
    throw new Error(`PPTX file not generated: ${sourcePptx}`);
  }

  fs.copyFileSync(sourcePptx, targetPptx);
  console.log(`   PPTX copied to: ${targetPptx}`);

  // 3. Convert PPTX to PNG.
  console.log("2. Converting PPTX to PNG...");
  await pptxToPng(targetPptx, OUTPUT_DIR, ["sample"]);

  console.log(`\nPreview saved: ${path.join(OUTPUT_DIR, "sample.png")}`);
  console.log("\nClaude Code can now read this PNG file to check the layout.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
