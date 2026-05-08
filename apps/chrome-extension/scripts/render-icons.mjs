// Convert public/icon.svg → public/icon-{16,32,48,128}.png using sharp.
// Run via `pnpm -F @slideglance/chrome-extension build`, which wraps this
// before `vite build`.
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(__dirname, "../public/icon.svg");
const sizes = [16, 32, 48, 128];

const svg = await readFile(svgPath);
for (const size of sizes) {
  const out = resolve(__dirname, `../public/icon-${size}.png`);
  await sharp(svg).resize(size, size).png().toFile(out);
  console.log(`wrote ${out}`);
}
